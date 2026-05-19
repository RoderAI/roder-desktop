import { existsSync } from "node:fs";
import { isAbsolute, normalize, resolve, sep } from "node:path";
import type { JsonSchema, RoderExtensionActivationEvent, RoderExtensionCapability, RoderPreferenceType, RoderThemeScheme } from "@roderai/extension-api";

export type RoderExtensionManifest = {
  id: string;
  name: string;
  displayName: string;
  publisher: string;
  version: string;
  description: string;
  engines: {
    roder: string;
  };
  main: string;
  activationEvents: RoderExtensionActivationEvent[];
  contributes: RoderExtensionContributions;
  capabilities: RoderExtensionCapability[];
  icon?: string;
  repository?: string | { type?: string; url: string };
  homepage?: string;
  license?: string;
  keywords: string[];
  categories: string[];
};

export type RoderExtensionContributions = {
  commands: RoderCommandContribution[];
  tools: RoderToolContribution[];
  configuration: RoderConfigurationContribution[];
  themes: RoderThemeContribution[];
  views: {
    panels: RoderPanelContribution[];
  };
};

export type RoderCommandContribution = {
  id: string;
  title: string;
  category?: string;
  icon?: string;
};

export type RoderToolContribution = {
  id: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
};

export type RoderConfigurationContribution = {
  key: string;
  title: string;
  description?: string;
  type: RoderPreferenceType;
  required?: boolean;
  default?: string | boolean | null;
  options?: Array<{ label: string; value: string }>;
};

export type RoderPanelContribution = {
  id: string;
  title: string;
  html?: string;
  icon?: string;
};

export type RoderThemeContribution = {
  id: string;
  label: string;
  path: string;
  scheme: RoderThemeScheme;
};

export type ManifestValidationOptions = {
  packageRoot?: string;
  appVersion?: string;
};

export type ManifestValidationIssue = {
  path: string;
  message: string;
};

export class ManifestValidationError extends Error {
  readonly issues: ManifestValidationIssue[];

  constructor(issues: ManifestValidationIssue[]) {
    super(`Invalid Roder extension manifest: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
    this.name = "ManifestValidationError";
    this.issues = issues;
  }
}

const capabilities = new Set<RoderExtensionCapability>([
  "fs.read.workspace",
  "fs.write.workspace",
  "process.spawn.shell",
  "network.web",
  "secret.read",
  "desktop.notification",
  "appserver.request",
  "ui.panel",
]);

const preferenceTypes = new Set<RoderPreferenceType>(["text", "password", "checkbox", "dropdown", "file", "directory"]);
const activationEventPattern = /^(onStartupFinished|onWorkspace|onCommand:[A-Za-z0-9_.-]+|onTool:[A-Za-z0-9_.-]+|onView:[A-Za-z0-9_.-]+)$/;
const contributionIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const namePattern = /^(?:@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/;
const publisherPattern = /^[a-z0-9][a-z0-9-]*$/;
const semverPattern = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;

export function validateExtensionManifest(packageJson: unknown, options: ManifestValidationOptions = {}): RoderExtensionManifest {
  const issues: ManifestValidationIssue[] = [];
  const root = asRecord(packageJson);
  if (!root) {
    throw new ManifestValidationError([{ path: "package.json", message: "must be an object" }]);
  }
  const roder = asRecord(root.roder);
  if (!roder) {
    throw new ManifestValidationError([{ path: "roder", message: "must define Roder extension metadata" }]);
  }

  const name = requiredString(root.name, "name", issues);
  const displayName = requiredString(roder.displayName, "roder.displayName", issues);
  const publisher = requiredString(roder.publisher, "roder.publisher", issues);
  const version = requiredString(root.version, "version", issues);
  const description = requiredString(root.description, "description", issues);
  const main = requiredString(roder.main, "roder.main", issues);
  const roderEngines = asRecord(roder.engines);
  const engineRange = requiredString(roderEngines?.roder, "roder.engines.roder", issues);

  if (name && !namePattern.test(name)) {
    issues.push({ path: "name", message: "must be a valid npm package name" });
  }
  if (publisher && !publisherPattern.test(publisher)) {
    issues.push({ path: "roder.publisher", message: "must contain only lowercase letters, numbers, and dashes" });
  }
  if (version && !semverPattern.test(version)) {
    issues.push({ path: "version", message: "must be a semantic version" });
  }
  if (main) {
    validateRelativePackagePath(main, "roder.main", options.packageRoot, true, issues);
  }
  if (engineRange && !supportsRoderEngineRange(engineRange, options.appVersion ?? "0.0.0")) {
    issues.push({ path: "roder.engines.roder", message: `does not support Roder ${options.appVersion ?? "0.0.0"}` });
  }

  const activationEvents = validateStringArray(roder.activationEvents, "roder.activationEvents", issues, activationEventPattern);
  const extensionCapabilities = validateCapabilities(roder.capabilities, issues);
  const contributes = validateContributions(roder.contributes, issues);
  validateActivationTargets(activationEvents, contributes, issues);

  const manifest: RoderExtensionManifest = {
    id: `${publisher}.${stripScope(name)}`,
    name,
    displayName,
    publisher,
    version,
    description,
    engines: { roder: engineRange },
    main,
    activationEvents,
    contributes,
    capabilities: extensionCapabilities,
    keywords: validateOptionalStringArray(root.keywords, "keywords", issues),
    categories: validateOptionalStringArray(roder.categories, "roder.categories", issues),
  };

  optionalString(root.license, "license", issues, (value) => {
    manifest.license = value;
  });
  optionalString(root.homepage, "homepage", issues, (value) => {
    manifest.homepage = value;
  });
  optionalString(roder.icon, "roder.icon", issues, (value) => {
    validateRelativePackagePath(value, "roder.icon", options.packageRoot, false, issues);
    manifest.icon = value;
  });
  if (root.repository !== undefined) {
    if (typeof root.repository === "string") {
      manifest.repository = root.repository;
    } else {
      const repository = asRecord(root.repository);
      const repositoryUrl = optionalStringValue(repository?.url);
      if (!repository || !repositoryUrl) {
        issues.push({ path: "repository", message: "must be a string or object with a url" });
      } else {
        manifest.repository = { type: optionalStringValue(repository.type), url: repositoryUrl };
      }
    }
  }

  if (issues.length > 0) {
    throw new ManifestValidationError(issues);
  }
  return manifest;
}

export function manifestFromPackageJson(packageJson: unknown, options?: ManifestValidationOptions): RoderExtensionManifest {
  return validateExtensionManifest(packageJson, options);
}

function validateContributions(value: unknown, issues: ManifestValidationIssue[]): RoderExtensionContributions {
  const contributes = asRecord(value) ?? {};
  const views = asRecord(contributes.views) ?? {};
  return {
    commands: validateCommands(contributes.commands, issues),
    tools: validateTools(contributes.tools, issues),
    configuration: validateConfiguration(contributes.configuration, issues),
    themes: validateThemes(contributes.themes, issues),
    views: {
      panels: validatePanels(views.panels, issues),
    },
  };
}

function validateCommands(value: unknown, issues: ManifestValidationIssue[]): RoderCommandContribution[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    issues.push({ path: "roder.contributes.commands", message: "must be an array" });
    return [];
  }
  return value.map((item, index) => {
    const record = asRecord(item);
    const id = requiredString(record?.id, `roder.contributes.commands[${index}].id`, issues);
    const title = requiredString(record?.title, `roder.contributes.commands[${index}].title`, issues);
    validateContributionId(id, `roder.contributes.commands[${index}].id`, issues);
    return {
      id,
      title,
      category: optionalStringValue(record?.category),
      icon: optionalStringValue(record?.icon),
    };
  });
}

function validateTools(value: unknown, issues: ManifestValidationIssue[]): RoderToolContribution[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    issues.push({ path: "roder.contributes.tools", message: "must be an array" });
    return [];
  }
  return value.map((item, index) => {
    const record = asRecord(item);
    const id = requiredString(record?.id, `roder.contributes.tools[${index}].id`, issues);
    const title = requiredString(record?.title, `roder.contributes.tools[${index}].title`, issues);
    const description = requiredString(record?.description, `roder.contributes.tools[${index}].description`, issues);
    validateContributionId(id, `roder.contributes.tools[${index}].id`, issues);
    if (!asRecord(record?.inputSchema)) {
      issues.push({ path: `roder.contributes.tools[${index}].inputSchema`, message: "must be a JSON Schema object" });
    }
    return {
      id,
      title,
      description,
      inputSchema: (record?.inputSchema as JsonSchema | undefined) ?? { type: "object" },
    };
  });
}

function validateConfiguration(value: unknown, issues: ManifestValidationIssue[]): RoderConfigurationContribution[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    issues.push({ path: "roder.contributes.configuration", message: "must be an array" });
    return [];
  }
  return value.map((item, index) => {
    const record = asRecord(item);
    const key = requiredString(record?.key, `roder.contributes.configuration[${index}].key`, issues);
    const title = requiredString(record?.title, `roder.contributes.configuration[${index}].title`, issues);
    const type = requiredString(record?.type, `roder.contributes.configuration[${index}].type`, issues) as RoderPreferenceType;
    validateContributionId(key, `roder.contributes.configuration[${index}].key`, issues);
    if (type && !preferenceTypes.has(type)) {
      issues.push({ path: `roder.contributes.configuration[${index}].type`, message: "must be a supported preference type" });
    }
    return {
      key,
      title,
      type,
      description: optionalStringValue(record?.description),
      required: typeof record?.required === "boolean" ? record.required : undefined,
      default: defaultPreferenceValue(record?.default),
      options: validatePreferenceOptions(record?.options, `roder.contributes.configuration[${index}].options`, issues),
    };
  });
}

function validatePanels(value: unknown, issues: ManifestValidationIssue[]): RoderPanelContribution[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    issues.push({ path: "roder.contributes.views.panels", message: "must be an array" });
    return [];
  }
  return value.map((item, index) => {
    const record = asRecord(item);
    const id = requiredString(record?.id, `roder.contributes.views.panels[${index}].id`, issues);
    const title = requiredString(record?.title, `roder.contributes.views.panels[${index}].title`, issues);
    validateContributionId(id, `roder.contributes.views.panels[${index}].id`, issues);
    const html = optionalStringValue(record?.html);
    if (html) {
      validateRelativePackagePath(html, `roder.contributes.views.panels[${index}].html`, undefined, false, issues);
    }
    return {
      id,
      title,
      html,
      icon: optionalStringValue(record?.icon),
    };
  });
}

function validateThemes(value: unknown, issues: ManifestValidationIssue[]): RoderThemeContribution[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    issues.push({ path: "roder.contributes.themes", message: "must be an array" });
    return [];
  }
  return value.map((item, index) => {
    const record = asRecord(item);
    const id = requiredString(record?.id, `roder.contributes.themes[${index}].id`, issues);
    const label = requiredString(record?.label, `roder.contributes.themes[${index}].label`, issues);
    const path = requiredString(record?.path, `roder.contributes.themes[${index}].path`, issues);
    const scheme = requiredString(record?.scheme, `roder.contributes.themes[${index}].scheme`, issues) as RoderThemeScheme;
    validateContributionId(id, `roder.contributes.themes[${index}].id`, issues);
    if (scheme !== "light" && scheme !== "dark") {
      issues.push({ path: `roder.contributes.themes[${index}].scheme`, message: "must be light or dark" });
    }
    if (path) {
      validateRelativePackagePath(path, `roder.contributes.themes[${index}].path`, undefined, false, issues);
    }
    return {
      id,
      label,
      path,
      scheme,
    };
  });
}

function validateActivationTargets(
  activationEvents: RoderExtensionActivationEvent[],
  contributes: RoderExtensionContributions,
  issues: ManifestValidationIssue[],
): void {
  const commands = new Set(contributes.commands.map((command) => command.id));
  const tools = new Set(contributes.tools.map((tool) => tool.id));
  const panels = new Set(contributes.views.panels.map((panel) => panel.id));
  for (const event of activationEvents) {
    const [kind, id] = event.split(":");
    if (kind === "onCommand" && id && !commands.has(id)) {
      issues.push({ path: "roder.activationEvents", message: `references undeclared command ${id}` });
    }
    if (kind === "onTool" && id && !tools.has(id)) {
      issues.push({ path: "roder.activationEvents", message: `references undeclared tool ${id}` });
    }
    if (kind === "onView" && id && !panels.has(id)) {
      issues.push({ path: "roder.activationEvents", message: `references undeclared panel ${id}` });
    }
  }
}

function validateStringArray(value: unknown, path: string, issues: ManifestValidationIssue[], pattern?: RegExp): RoderExtensionActivationEvent[] {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "must be an array of strings" });
    return [];
  }
  const result: string[] = [];
  value.forEach((item, index) => {
    if (typeof item !== "string" || item.trim() === "") {
      issues.push({ path: `${path}[${index}]`, message: "must be a non-empty string" });
      return;
    }
    if (pattern && !pattern.test(item)) {
      issues.push({ path: `${path}[${index}]`, message: "is not a supported activation event" });
      return;
    }
    result.push(item);
  });
  return result as RoderExtensionActivationEvent[];
}

function validateCapabilities(value: unknown, issues: ManifestValidationIssue[]): RoderExtensionCapability[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    issues.push({ path: "roder.capabilities", message: "must be an array" });
    return [];
  }
  const result: RoderExtensionCapability[] = [];
  value.forEach((item, index) => {
    if (!capabilities.has(item as RoderExtensionCapability)) {
      issues.push({ path: `roder.capabilities[${index}]`, message: "is not a supported capability" });
      return;
    }
    result.push(item as RoderExtensionCapability);
  });
  return [...new Set(result)];
}

function validateOptionalStringArray(value: unknown, path: string, issues: ManifestValidationIssue[]): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    issues.push({ path, message: "must be an array of strings" });
    return [];
  }
  return value.filter((item, index) => {
    if (typeof item === "string") {
      return true;
    }
    issues.push({ path: `${path}[${index}]`, message: "must be a string" });
    return false;
  }) as string[];
}

function validatePreferenceOptions(value: unknown, path: string, issues: ManifestValidationIssue[]): Array<{ label: string; value: string }> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    issues.push({ path, message: "must be an array" });
    return undefined;
  }
  return value.map((item, index) => {
    const record = asRecord(item);
    return {
      label: requiredString(record?.label, `${path}[${index}].label`, issues),
      value: requiredString(record?.value, `${path}[${index}].value`, issues),
    };
  });
}

function validateContributionId(value: string, path: string, issues: ManifestValidationIssue[]): void {
  if (value && !contributionIdPattern.test(value)) {
    issues.push({ path, message: "must start with a letter or number and contain only letters, numbers, dots, dashes, and underscores" });
  }
}

function validateRelativePackagePath(
  value: string,
  path: string,
  packageRoot: string | undefined,
  requireExistingFile: boolean,
  issues: ManifestValidationIssue[],
): void {
  const normalized = normalize(value);
  if (isAbsolute(value) || normalized === ".." || normalized.startsWith(`..${sep}`)) {
    issues.push({ path, message: "must be a relative path inside the extension package" });
    return;
  }
  if (requireExistingFile && packageRoot && !existsSync(resolve(packageRoot, normalized))) {
    issues.push({ path, message: "must point to an existing file" });
  }
}

function supportsRoderEngineRange(range: string, appVersion: string): boolean {
  const trimmed = range.trim();
  if (trimmed === "*" || trimmed === "") {
    return true;
  }
  const appMajor = major(appVersion);
  if (trimmed.startsWith(">=")) {
    return appMajor >= major(trimmed.slice(2).trim());
  }
  if (trimmed.startsWith("^")) {
    return appMajor === major(trimmed.slice(1).trim());
  }
  return major(trimmed) === appMajor;
}

function major(version: string): number {
  const parsed = Number.parseInt(version.split(".")[0] ?? "0", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function requiredString(value: unknown, path: string, issues: ManifestValidationIssue[]): string {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push({ path, message: "must be a non-empty string" });
    return "";
  }
  return value.trim();
}

function optionalString(value: unknown, path: string, issues: ManifestValidationIssue[], assign: (value: string) => void): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "string") {
    issues.push({ path, message: "must be a string" });
    return;
  }
  assign(value);
}

function optionalStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function defaultPreferenceValue(value: unknown): string | boolean | null | undefined {
  return typeof value === "string" || typeof value === "boolean" || value === null ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stripScope(name: string): string {
  return name.includes("/") ? name.split("/").pop() ?? name : name;
}

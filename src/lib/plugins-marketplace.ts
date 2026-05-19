import type {
  DedupedMarketplacePlugin,
  DefaultMarketplaceSelection,
  InstalledPluginRecord,
  MarketplaceDescriptor,
  MarketplaceSource,
  MarketplaceState,
  MarketplacePluginRisk,
  MarketplacePluginVariant,
  PluginComponentHints,
  PluginSource,
} from "@/types/plugins";

const componentHintLabels: Array<[keyof PluginComponentHints, string]> = [
  ["skills", "Skills"],
  ["commands", "Commands"],
  ["agents", "Agents"],
  ["mcpServers", "MCP"],
  ["hooks", "Hooks"],
  ["apps", "Apps"],
  ["lspServers", "LSP"],
  ["rules", "Rules"],
  ["assets", "Assets"],
];

export function pluginVariantKey(variant: Pick<MarketplacePluginVariant, "marketplaceId" | "pluginId">): string {
  return pluginVariantKeyFromParts(variant.marketplaceId, variant.pluginId);
}

export function pluginVariantKeyFromParts(marketplaceId: string, pluginId: string): string {
  return `${marketplaceId}:${pluginId}`;
}

export function recommendedVariant(plugin: DedupedMarketplacePlugin): MarketplacePluginVariant | undefined {
  if (plugin.recommendedVariantKey) {
    const match = plugin.variants.find((variant) => pluginVariantKey(variant) === plugin.recommendedVariantKey);
    if (match) {
      return match;
    }
  }
  return plugin.variants[0];
}

export function installedVariantSet(plugin: DedupedMarketplacePlugin, installed: InstalledPluginRecord[]): Set<string> {
  const keys = new Set(plugin.installedVariants);
  for (const record of installed) {
    keys.add(record.variantKey);
  }
  return keys;
}

export function defaultSelectionForMarketplace(
  marketplace: Pick<MarketplaceDescriptor, "id" | "isDefault">,
): DefaultMarketplaceSelection | undefined {
  if (!marketplace.isDefault) {
    return undefined;
  }
  switch (marketplace.id) {
    case "claude-plugins-official":
      return "anthropic";
    case "cursor-plugins":
      return "cursor";
    case "codex-plugins":
      return "codex";
    default:
      return undefined;
  }
}

export function marketplaceIsActive(marketplace: Pick<MarketplaceDescriptor, "enabled" | "state">): boolean {
  return marketplace.enabled && marketplace.state !== "bakedIn" && marketplace.state !== "removedByUser" && marketplace.state !== "disabled";
}

export function marketplaceNeedsEnable(
  marketplace: Pick<MarketplaceDescriptor, "id" | "isDefault" | "enabled" | "state">,
): boolean {
  return Boolean(defaultSelectionForMarketplace(marketplace)) && !marketplaceIsActive(marketplace);
}

export function marketplaceStateLabel(state: MarketplaceState): string {
  switch (state) {
    case "bakedIn":
      return "Baked in";
    case "removedByUser":
      return "Disabled";
    case "installed":
      return "Installed";
    case "refreshed":
      return "Refreshed";
    case "disabled":
      return "Disabled";
  }
}

export function activeComponentLabels(hints: PluginComponentHints): string[] {
  return componentHintLabels.filter(([key]) => hints[key]).map(([, label]) => label);
}

export function riskLabel(risk: MarketplacePluginRisk): string {
  switch (risk) {
    case "readsWorkspace":
      return "Reads workspace";
    case "startsProcess":
      return "Starts process";
    case "runsHook":
      return "Runs hook";
    case "unknown":
      return "Unknown risk";
    case "passive":
    default:
      return "Passive";
  }
}

export function sourceLabel(source: PluginSource): string {
  switch (source.kind) {
    case "marketplacePath":
      return `${source.marketplaceId ?? source.marketplace_id ?? "marketplace"} / ${source.path}`;
    case "git":
      return source.path ? `${source.url} / ${source.path}` : source.url;
    case "http":
      return source.url;
    case "npm":
      return source.version ? `${source.package}@${source.version}` : source.package;
    case "localPath":
      return source.path;
    case "unsupported":
      return "Unsupported source";
  }
}

export function sourceCodeUrl(
  source: PluginSource,
  marketplaces: Array<Pick<MarketplaceDescriptor, "id" | "source">>,
): string | undefined {
  switch (source.kind) {
    case "marketplacePath": {
      const marketplaceId = source.marketplaceId ?? source.marketplace_id;
      const marketplace = marketplaces.find((candidate) => candidate.id === marketplaceId);
      return marketplace ? marketplaceSourceCodeUrl(marketplace.source, source.path) : undefined;
    }
    case "git":
      return gitSourceCodeUrl(source.url, source.path ?? undefined, source.refName ?? source.sha ?? undefined);
    case "http":
      return webUrl(source.url);
    case "npm":
      return `https://www.npmjs.com/package/${encodeURIComponent(source.package)}`;
    case "localPath":
      return fileUrlForPath(source.path);
    case "unsupported":
      return undefined;
  }
}

function marketplaceSourceCodeUrl(source: MarketplaceSource, pluginPath: string): string | undefined {
  switch (source.kind) {
    case "github":
      return githubSourceCodeUrl(source.repo, joinedPluginPath(source.pluginRoot ?? undefined, pluginPath), source.refName ?? undefined);
    case "git":
      return gitSourceCodeUrl(source.url, pluginPath, source.refName ?? undefined);
    case "httpJson":
      return webUrl(source.url);
    case "localPath":
      return fileUrlForPath(joinedLocalPath(source.path, pluginPath));
  }
}

function githubSourceCodeUrl(repo: string, path?: string, refName?: string | null): string | undefined {
  const parsedRepoUrl = githubRepoUrl(repo);
  if (parsedRepoUrl) {
    return appendRepoPath(parsedRepoUrl, path, refName);
  }
  const normalizedRepo = normalizeRelativePath(trimGitSuffix(repo));
  if (!normalizedRepo) {
    return undefined;
  }
  return appendRepoPath(`https://github.com/${normalizedRepo}`, path, refName);
}

function gitSourceCodeUrl(url: string, path?: string, refName?: string | null): string | undefined {
  const githubUrl = githubRepoUrl(url);
  if (!githubUrl) {
    return webUrl(url);
  }
  return appendRepoPath(githubUrl, path, refName) ?? githubUrl;
}

function githubRepoUrl(value: string): string | undefined {
  const trimmed = value.trim();
  const sshMatch = /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/u.exec(trimmed);
  if (sshMatch) {
    return `https://github.com/${trimGitSuffix(sshMatch[1])}`;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") {
      return undefined;
    }
    const [owner, repo] = parsed.pathname.replace(/^\/+/u, "").split("/");
    if (!owner || !repo) {
      return undefined;
    }
    return `https://github.com/${owner}/${trimGitSuffix(repo)}`;
  } catch {
    return undefined;
  }
}

function appendRepoPath(baseUrl: string, path?: string, refName?: string | null): string | undefined {
  const normalizedPath = normalizeRelativePath(path);
  if (!normalizedPath) {
    return baseUrl;
  }
  const ref = refName?.trim() || "main";
  return `${baseUrl}/tree/${encodeURIComponent(ref)}/${encodePathSegments(normalizedPath)}`;
}

function joinedPluginPath(pluginRoot: string | undefined, pluginPath: string): string | undefined {
  const normalizedPath = normalizeRelativePath(pluginPath);
  const normalizedRoot = normalizeRelativePath(pluginRoot);
  if (!normalizedPath) {
    return normalizedRoot;
  }
  if (!normalizedRoot || normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath;
  }
  return `${normalizedRoot}/${normalizedPath}`;
}

function joinedLocalPath(root: string, pluginPath: string): string | undefined {
  const normalizedRoot = root.trim().replace(/\/+$/u, "");
  if (!normalizedRoot.startsWith("/")) {
    return undefined;
  }
  if (pluginPath.startsWith(normalizedRoot)) {
    return pluginPath;
  }
  const normalizedPath = normalizeRelativePath(pluginPath);
  return normalizedPath ? `${normalizedRoot}/${normalizedPath}` : normalizedRoot;
}

function fileUrlForPath(path?: string): string | undefined {
  if (!path) {
    return undefined;
  }
  const trimmed = path.trim();
  if (!trimmed.startsWith("/")) {
    return undefined;
  }
  return `file://${encodePathSegments(trimmed)}`;
}

function webUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function normalizeRelativePath(path?: string | null): string | undefined {
  const normalized = path
    ?.trim()
    .replace(/\\/gu, "/")
    .replace(/^\/+/u, "")
    .split("/")
    .filter((part) => part && part !== ".")
    .join("/");
  return normalized || undefined;
}

function encodePathSegments(path: string): string {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function trimGitSuffix(value: string): string {
  return value.endsWith(".git") ? value.slice(0, -4) : value;
}

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

export type MarketplaceProviderSelection = "all" | "anthropic" | "cursor" | "codex" | "local";

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
  const pluginVariantKeys = new Set([...plugin.variants, ...plugin.relatedCandidates].map(pluginVariantKey));
  for (const record of installed) {
    if (
      record.state !== "uninstalled" &&
      (record.identityKey.canonicalSlug === plugin.identityKey.canonicalSlug || pluginVariantKeys.has(record.variantKey))
    ) {
      keys.add(record.variantKey);
    }
  }
  return keys;
}

export type PluginInstallStatus = {
  installedKeys: Set<string>;
  pluginInstalled: boolean;
  variantInstalled: boolean;
  variantKey: string;
};

export type MarketplacePluginMatch = {
  plugin: DedupedMarketplacePlugin;
  variant: MarketplacePluginVariant;
};

export type MarketplacePluginLookups = {
  installedByVariantKey: Map<string, InstalledPluginRecord>;
  installedByCanonicalSlug: Map<string, InstalledPluginRecord[]>;
  marketplaceMatchByVariantKey: Map<string, MarketplacePluginMatch>;
  marketplaceMatchesByCanonicalSlug: Map<string, MarketplacePluginMatch[]>;
};

export function pluginInstallStatus(
  plugin: DedupedMarketplacePlugin,
  variant: Pick<MarketplacePluginVariant, "marketplaceId" | "pluginId">,
  installed: InstalledPluginRecord[],
): PluginInstallStatus {
  const installedKeys = installedVariantSet(plugin, installed);
  const variantKey = pluginVariantKey(variant);
  return {
    installedKeys,
    pluginInstalled: installedKeys.size > 0,
    variantInstalled: installedKeys.has(variantKey),
    variantKey,
  };
}

export function buildMarketplacePluginLookups(
  plugins: DedupedMarketplacePlugin[],
  installed: InstalledPluginRecord[],
): MarketplacePluginLookups {
  const installedByVariantKey = new Map<string, InstalledPluginRecord>();
  const installedByCanonicalSlug = new Map<string, InstalledPluginRecord[]>();
  const marketplaceMatchByVariantKey = new Map<string, MarketplacePluginMatch>();
  const marketplaceMatchesByCanonicalSlug = new Map<string, MarketplacePluginMatch[]>();

  for (const record of visibleInstalledPlugins(installed)) {
    installedByVariantKey.set(record.variantKey, record);
    appendMapValue(installedByCanonicalSlug, record.identityKey.canonicalSlug, record);
  }

  for (const plugin of plugins) {
    for (const variant of [...plugin.variants, ...plugin.relatedCandidates]) {
      const match = { plugin, variant };
      marketplaceMatchByVariantKey.set(pluginVariantKey(variant), match);
      appendMapValue(marketplaceMatchesByCanonicalSlug, plugin.identityKey.canonicalSlug, match);
    }
  }

  return {
    installedByVariantKey,
    installedByCanonicalSlug,
    marketplaceMatchByVariantKey,
    marketplaceMatchesByCanonicalSlug,
  };
}

export function pluginInstallStatusFromLookups(
  plugin: DedupedMarketplacePlugin,
  variant: Pick<MarketplacePluginVariant, "marketplaceId" | "pluginId">,
  lookups: MarketplacePluginLookups,
): PluginInstallStatus {
  const installedKeys = installedVariantSetFromLookups(plugin, lookups);
  const variantKey = pluginVariantKey(variant);
  return {
    installedKeys,
    pluginInstalled: installedKeys.size > 0,
    variantInstalled: installedKeys.has(variantKey),
    variantKey,
  };
}

export function marketplacePluginForInstalled(
  installedPlugin: InstalledPluginRecord,
  lookups: MarketplacePluginLookups,
): MarketplacePluginMatch | undefined {
  const exactMatch = lookups.marketplaceMatchByVariantKey.get(installedPlugin.variantKey);
  if (exactMatch) {
    return exactMatch;
  }

  const [fallbackMatch] = lookups.marketplaceMatchesByCanonicalSlug.get(installedPlugin.identityKey.canonicalSlug) ?? [];
  const fallbackVariant = fallbackMatch ? recommendedVariant(fallbackMatch.plugin) : undefined;
  return fallbackMatch && fallbackVariant ? { plugin: fallbackMatch.plugin, variant: fallbackVariant } : undefined;
}

export function pluginSearchRowKey(plugin: DedupedMarketplacePlugin): string {
  const variantKeys = plugin.variants.map(pluginVariantKey).toSorted().join("|") || plugin.recommendedVariantKey || "no-variants";
  return `${plugin.identityKey.canonicalSlug}:${variantKeys}`;
}

export function visibleInstalledPlugins(installed: InstalledPluginRecord[]): InstalledPluginRecord[] {
  return installed
    .filter((record) => record.state !== "uninstalled")
    .toSorted((left, right) => {
      const nameComparison = left.identityKey.normalizedName.localeCompare(right.identityKey.normalizedName);
      return nameComparison || left.variantKey.localeCompare(right.variantKey);
    });
}

export function categoryOptionsForPlugins(plugins: DedupedMarketplacePlugin[]): string[] {
  const categories = new Set<string>();
  for (const plugin of plugins) {
    for (const variant of plugin.variants) {
      const category = normalizeCategory(variant.category);
      if (category) {
        categories.add(category);
      }
    }
  }
  return Array.from(categories).sort((left, right) => left.localeCompare(right));
}

export function pluginMatchesCategories(plugin: DedupedMarketplacePlugin, categories: string[]): boolean {
  if (categories.length === 0) {
    return true;
  }
  const selected = new Set(categories.map(normalizeCategory).filter((category): category is string => Boolean(category)));
  return plugin.variants.some((variant) => {
    const category = normalizeCategory(variant.category);
    return category ? selected.has(category) : false;
  });
}

export function categoryLabel(category: string): string {
  return category
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeCategory(category: string | null | undefined): string | undefined {
  const normalized = category?.trim().toLowerCase();
  return normalized || undefined;
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

export function defaultSelectionForProvider(provider: MarketplaceProviderSelection): DefaultMarketplaceSelection | undefined {
  switch (provider) {
    case "anthropic":
    case "cursor":
    case "codex":
      return provider;
    case "all":
      return "all";
    case "local":
      return undefined;
  }
}

export function pluginForProvider(
  plugin: DedupedMarketplacePlugin,
  provider: MarketplaceProviderSelection,
  marketplaces: MarketplaceDescriptor[],
): DedupedMarketplacePlugin | undefined {
  if (provider === "all") {
    return plugin;
  }
  const variants = plugin.variants.filter((variant) => pluginVariantMatchesProvider(variant, provider, marketplaces));
  if (variants.length === 0) {
    return undefined;
  }
  const variantKeys = new Set(variants.map(pluginVariantKey));
  const relatedCandidates = plugin.relatedCandidates.filter((variant) => pluginVariantMatchesProvider(variant, provider, marketplaces));
  return {
    ...plugin,
    variants,
    relatedCandidates,
    recommendedVariantKey: plugin.recommendedVariantKey && variantKeys.has(plugin.recommendedVariantKey)
      ? plugin.recommendedVariantKey
      : pluginVariantKey(variants[0]!),
    installedVariants: plugin.installedVariants.filter((variantKey) => variantKeys.has(variantKey)),
  };
}

function pluginVariantMatchesProvider(
  variant: Pick<MarketplacePluginVariant, "kind" | "marketplaceId">,
  provider: MarketplaceProviderSelection,
  marketplaces: MarketplaceDescriptor[],
): boolean {
  if (provider === "all") {
    return true;
  }
  const marketplace = marketplaces.find((candidate) => candidate.id === variant.marketplaceId);
  if (provider === "local") {
    return marketplace ? marketplace.source.kind === "localPath" || !marketplace.isDefault : false;
  }
  const providerKind = provider === "anthropic" ? "claude" : provider;
  return variant.kind === providerKind || defaultSelectionForMarketplace({ id: variant.marketplaceId, isDefault: marketplace?.isDefault ?? true }) === provider;
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

export function variantLabel(variant: Pick<MarketplacePluginVariant, "pluginId" | "source">): string {
  if (variant.source.kind === "marketplacePath") {
    return variant.source.path.split("/")[0]?.trim() || variant.pluginId;
  }
  return variant.pluginId;
}

export function homepageIconUrl(homepage: string | null | undefined): string | undefined {
  if (!homepage?.trim()) {
    return undefined;
  }
  try {
    const url = new URL(homepage);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return undefined;
    }
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=64`;
  } catch {
    return undefined;
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

function installedVariantSetFromLookups(
  plugin: DedupedMarketplacePlugin,
  lookups: MarketplacePluginLookups,
): Set<string> {
  const keys = new Set(plugin.installedVariants);
  const pluginVariantKeys = new Set([...plugin.variants, ...plugin.relatedCandidates].map(pluginVariantKey));

  for (const variantKey of pluginVariantKeys) {
    if (lookups.installedByVariantKey.has(variantKey)) {
      keys.add(variantKey);
    }
  }

  for (const record of lookups.installedByCanonicalSlug.get(plugin.identityKey.canonicalSlug) ?? []) {
    keys.add(record.variantKey);
  }

  return keys;
}

function appendMapValue<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key);
  if (values) {
    values.push(value);
    return;
  }
  map.set(key, [value]);
}

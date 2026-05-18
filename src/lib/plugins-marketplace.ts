import type {
  DedupedMarketplacePlugin,
  InstalledPluginRecord,
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

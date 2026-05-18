export type MarketplaceKind = "claude" | "cursor" | "codex" | "roder" | "custom";

export type DefaultMarketplaceSelection = "none" | "anthropic" | "cursor" | "codex" | "all";

export type MarketplaceSource =
  | {
      kind: "github";
      repo: string;
      refName?: string | null;
      catalogPath?: string | null;
      pluginRoot?: string | null;
    }
  | {
      kind: "git";
      url: string;
      refName?: string | null;
      catalogPath?: string | null;
    }
  | {
      kind: "httpJson";
      url: string;
    }
  | {
      kind: "localPath";
      path: string;
    };

export type MarketplaceState = "bakedIn" | "installed" | "refreshed" | "disabled" | "removedByUser";

export type MarketplaceDescriptor = {
  id: string;
  kind: MarketplaceKind;
  displayName: string;
  source: MarketplaceSource;
  homepage?: string | null;
  ownerName?: string | null;
  ownerEmail?: string | null;
  description?: string | null;
  isDefault: boolean;
  enabled: boolean;
  state: MarketplaceState;
  lastRefreshedAt?: string | null;
  contentHash?: string | null;
};

export type PluginSource =
  | {
      kind: "marketplacePath";
      marketplaceId?: string;
      marketplace_id?: string;
      path: string;
    }
  | {
      kind: "git";
      url: string;
      path?: string | null;
      refName?: string | null;
      sha?: string | null;
    }
  | {
      kind: "http";
      url: string;
      sha?: string | null;
    }
  | {
      kind: "npm";
      package: string;
      version?: string | null;
    }
  | {
      kind: "localPath";
      path: string;
    }
  | {
      kind: "unsupported";
      value: unknown;
    };

export type PluginComponentHints = {
  skills: boolean;
  commands: boolean;
  agents: boolean;
  mcpServers: boolean;
  hooks: boolean;
  apps: boolean;
  lspServers: boolean;
  rules: boolean;
  assets: boolean;
};

export type MarketplacePluginRisk = "passive" | "readsWorkspace" | "startsProcess" | "runsHook" | "unknown";

export type PluginIdentityKey = {
  canonicalSlug: string;
  normalizedName: string;
  repository?: string | null;
  homepageDomain?: string | null;
  authorName?: string | null;
};

export type MarketplacePluginEntry = {
  marketplaceId: string;
  pluginId: string;
  identityKey: PluginIdentityKey;
  displayName: string;
  description?: string | null;
  kind: MarketplaceKind;
  version?: string | null;
  source: PluginSource;
  homepage?: string | null;
  repository?: string | null;
  authorName?: string | null;
  category?: string | null;
  tags: string[];
  componentHints: PluginComponentHints;
  capabilityHints: string[];
  risk: MarketplacePluginRisk;
  rawManifest: unknown;
};

export type MarketplacePluginVariant = {
  marketplaceId: string;
  pluginId: string;
  kind: MarketplaceKind;
  source: PluginSource;
  componentHints: PluginComponentHints;
  capabilityHints: string[];
  version?: string | null;
  contentHash?: string | null;
  risk: MarketplacePluginRisk;
};

export type DedupedMarketplacePlugin = {
  identityKey: PluginIdentityKey;
  displayName: string;
  description?: string | null;
  variants: MarketplacePluginVariant[];
  relatedCandidates: MarketplacePluginVariant[];
  recommendedVariantKey?: string | null;
  installedVariants: string[];
};

export type MarketplaceInstallState = "previewed" | "installed" | "disabled" | "uninstalled";

export type InstalledPluginRecord = {
  marketplaceId: string;
  pluginId: string;
  identityKey: PluginIdentityKey;
  variantKey: string;
  installPath: string;
  version?: string | null;
  contentHash?: string | null;
  state: MarketplaceInstallState;
  installedAt: string;
};

export type PluginInstallPreview = {
  marketplaceId?: string;
  pluginId?: string;
  displayName?: string;
  identityKey?: PluginIdentityKey;
  source?: PluginSource;
  componentHints?: PluginComponentHints;
  capabilityHints?: string[];
  risk?: MarketplacePluginRisk;
  rawManifest?: unknown;
  [key: string]: unknown;
};

export type MarketplacesListResult = {
  marketplaces: MarketplaceDescriptor[];
};

export type MarketplacesInstallDefaultResult = {
  marketplaces: MarketplaceDescriptor[];
};

export type MarketplacesAddParams = {
  id: string;
  kind?: MarketplaceKind;
  displayName: string;
  source: MarketplaceSource;
};

export type MarketplacesAddResult = {
  marketplace: MarketplaceDescriptor;
};

export type MarketplacesRemoveResult = {
  removed: boolean;
};

export type MarketplacesRefreshResult = {
  marketplace: MarketplaceDescriptor;
  plugins: MarketplacePluginEntry[];
};

export type MarketplacesSearchResult = {
  plugins: DedupedMarketplacePlugin[];
};

export type MarketplacePluginResult = {
  plugin: MarketplacePluginEntry | null;
};

export type PluginPreviewInstallResult = {
  preview: PluginInstallPreview;
};

export type PluginInstallResult = {
  plugin: InstalledPluginRecord;
};

export type PluginInstallAllVariantsResult = {
  plugins: InstalledPluginRecord[];
};

export type PluginListInstalledResult = {
  plugins: InstalledPluginRecord[];
};

export type PluginDisableResult = {
  plugin: InstalledPluginRecord | null;
};

export type PluginUninstallResult = {
  removed: boolean;
};

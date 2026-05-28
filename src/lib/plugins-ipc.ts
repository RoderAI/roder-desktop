import type {
  DefaultMarketplaceSelection,
  MarketplaceKind,
  MarketplacePluginResult,
  MarketplaceSource,
  MarketplacesAddResult,
  MarketplacesInstallDefaultResult,
  MarketplacesListResult,
  MarketplacesRefreshResult,
  MarketplacesRemoveResult,
  MarketplacesSearchResult,
  PluginDisableResult,
  PluginInstallAllVariantsResult,
  PluginInstallResult,
  PluginListInstalledResult,
  PluginPreviewInstallResult,
  PluginUninstallResult,
} from "@/types/plugins";

export const pluginsIpc = {
  listMarketplaces: () => window.roderDesktop.request("marketplaces/list", {}) as Promise<MarketplacesListResult>,
  installDefaultMarketplaces: (selection: DefaultMarketplaceSelection) =>
    window.roderDesktop.request("marketplaces/install_default", {
      selection,
    }) as Promise<MarketplacesInstallDefaultResult>,
  addMarketplace: (params: { id: string; kind?: MarketplaceKind; displayName: string; source: MarketplaceSource }) =>
    window.roderDesktop.request("marketplaces/add", params) as Promise<MarketplacesAddResult>,
  removeMarketplace: (marketplaceId: string) =>
    window.roderDesktop.request("marketplaces/remove", { marketplaceId }) as Promise<MarketplacesRemoveResult>,
  refreshMarketplace: (marketplaceId: string) =>
    window.roderDesktop.request("marketplaces/refresh", { marketplaceId }) as Promise<MarketplacesRefreshResult>,
  searchMarketplacePlugins: (query?: string) => {
    const trimmed = query?.trim();
    return window.roderDesktop.request(
      "marketplaces/search",
      trimmed ? { query: trimmed } : {},
    ) as Promise<MarketplacesSearchResult>;
  },
  getMarketplacePlugin: (marketplaceId: string, pluginId: string) =>
    window.roderDesktop.request("marketplaces/plugin", { marketplaceId, pluginId }) as Promise<MarketplacePluginResult>,
  previewInstallPlugin: (marketplaceId: string, pluginId: string) =>
    window.roderDesktop.request("plugins/preview_install", {
      marketplaceId,
      pluginId,
    }) as Promise<PluginPreviewInstallResult>,
  installPlugin: (marketplaceId: string, pluginId: string) =>
    window.roderDesktop.request("plugins/install", { marketplaceId, pluginId }) as Promise<PluginInstallResult>,
  installAllPluginVariants: (marketplaceId: string, pluginId: string) =>
    window.roderDesktop.request("plugins/install_all_variants", {
      marketplaceId,
      pluginId,
    }) as Promise<PluginInstallAllVariantsResult>,
  listInstalledPlugins: () =>
    window.roderDesktop.request("plugins/list_installed", {}) as Promise<PluginListInstalledResult>,
  disablePlugin: (variantKey: string) =>
    window.roderDesktop.request("plugins/disable", { variantKey }) as Promise<PluginDisableResult>,
  uninstallPlugin: (variantKey: string) =>
    window.roderDesktop.request("plugins/uninstall", { variantKey }) as Promise<PluginUninstallResult>,
};

export type PluginsIpc = typeof pluginsIpc;

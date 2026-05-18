import { create } from "zustand";
import { pluginVariantKeyFromParts } from "@/lib/plugins-marketplace";
import { pluginsIpc } from "@/lib/plugins-ipc";
import type {
  DedupedMarketplacePlugin,
  DefaultMarketplaceSelection,
  InstalledPluginRecord,
  MarketplaceDescriptor,
  MarketplaceKind,
  PluginInstallPreview,
} from "@/types/plugins";

type PluginsStore = {
  marketplaces: MarketplaceDescriptor[];
  plugins: DedupedMarketplacePlugin[];
  installedPlugins: InstalledPluginRecord[];
  previewsByVariant: Record<string, PluginInstallPreview>;
  query: string;
  loading: boolean;
  error: string | null;
  lastResult: string | null;
  load: () => Promise<void>;
  setQuery: (query: string) => void;
  search: (query?: string) => Promise<void>;
  installDefaults: (selection: DefaultMarketplaceSelection) => Promise<void>;
  addLocalMarketplace: (params: { id: string; displayName: string; path: string; kind?: MarketplaceKind }) => Promise<void>;
  removeMarketplace: (marketplaceId: string) => Promise<void>;
  refreshMarketplace: (marketplaceId: string) => Promise<void>;
  previewPlugin: (marketplaceId: string, pluginId: string) => Promise<void>;
  installPlugin: (marketplaceId: string, pluginId: string) => Promise<void>;
  installAllVariants: (marketplaceId: string, pluginId: string) => Promise<void>;
  disablePlugin: (variantKey: string) => Promise<void>;
  uninstallPlugin: (variantKey: string) => Promise<void>;
  clearError: () => void;
};

type StoreSet = (partial: Partial<PluginsStore> | ((state: PluginsStore) => Partial<PluginsStore>)) => void;
type StoreGet = () => PluginsStore;

export const usePluginsStore = create<PluginsStore>()((set, get) => ({
  marketplaces: [],
  plugins: [],
  installedPlugins: [],
  previewsByVariant: {},
  query: "",
  loading: false,
  error: null,
  lastResult: null,
  load: () => reloadSnapshot(set, get),
  setQuery: (query) => set({ query }),
  search: async (query) => {
    const nextQuery = query ?? get().query;
    set({ query: nextQuery });
    await withAction(set, async () => {
      const [searchResult, installedResult] = await Promise.all([
        pluginsIpc.searchMarketplacePlugins(nextQuery),
        pluginsIpc.listInstalledPlugins(),
      ]);
      set({ plugins: searchResult.plugins, installedPlugins: installedResult.plugins });
    });
  },
  installDefaults: (selection) =>
    withAction(set, async () => {
      const result = await pluginsIpc.installDefaultMarketplaces(selection);
      set({ lastResult: `${result.marketplaces.length} default marketplace${result.marketplaces.length === 1 ? "" : "s"} installed` });
      await reloadSnapshot(set, get, false);
    }),
  addLocalMarketplace: ({ id, displayName, path, kind }) =>
    withAction(set, async () => {
      const result = await pluginsIpc.addMarketplace({
        id,
        displayName,
        kind,
        source: { kind: "localPath", path },
      });
      set({ lastResult: `Added ${result.marketplace.displayName}` });
      await reloadSnapshot(set, get, false);
    }),
  removeMarketplace: (marketplaceId) =>
    withAction(set, async () => {
      const result = await pluginsIpc.removeMarketplace(marketplaceId);
      set({ lastResult: result.removed ? `Removed ${marketplaceId}` : `${marketplaceId} was not configured` });
      await reloadSnapshot(set, get, false);
    }),
  refreshMarketplace: (marketplaceId) =>
    withAction(set, async () => {
      const result = await pluginsIpc.refreshMarketplace(marketplaceId);
      set({ lastResult: `Refreshed ${result.marketplace.displayName}: ${result.plugins.length} plugin${result.plugins.length === 1 ? "" : "s"}` });
      await reloadSnapshot(set, get, false);
    }),
  previewPlugin: (marketplaceId, pluginId) =>
    withAction(set, async () => {
      const result = await pluginsIpc.previewInstallPlugin(marketplaceId, pluginId);
      const key = pluginVariantKeyFromParts(marketplaceId, pluginId);
      set((state) => ({
        previewsByVariant: { ...state.previewsByVariant, [key]: result.preview },
        lastResult: `Previewed ${pluginId}`,
      }));
    }),
  installPlugin: (marketplaceId, pluginId) =>
    withAction(set, async () => {
      const result = await pluginsIpc.installPlugin(marketplaceId, pluginId);
      set({ lastResult: `Installed ${result.plugin.variantKey}` });
      await reloadSnapshot(set, get, false);
    }),
  installAllVariants: (marketplaceId, pluginId) =>
    withAction(set, async () => {
      const result = await pluginsIpc.installAllPluginVariants(marketplaceId, pluginId);
      set({ lastResult: `Installed ${result.plugins.length} variant${result.plugins.length === 1 ? "" : "s"}` });
      await reloadSnapshot(set, get, false);
    }),
  disablePlugin: (variantKey) =>
    withAction(set, async () => {
      const result = await pluginsIpc.disablePlugin(variantKey);
      set({ lastResult: result.plugin ? `Disabled ${result.plugin.variantKey}` : `${variantKey} is not installed` });
      await reloadSnapshot(set, get, false);
    }),
  uninstallPlugin: (variantKey) =>
    withAction(set, async () => {
      const result = await pluginsIpc.uninstallPlugin(variantKey);
      set({ lastResult: result.removed ? `Uninstalled ${variantKey}` : `${variantKey} is not installed` });
      await reloadSnapshot(set, get, false);
    }),
  clearError: () => set({ error: null }),
}));

async function reloadSnapshot(set: StoreSet, get: StoreGet, markLoading = true): Promise<void> {
  await withAction(
    set,
    async () => {
      const [marketplacesResult, searchResult, installedResult] = await Promise.all([
        pluginsIpc.listMarketplaces(),
        pluginsIpc.searchMarketplacePlugins(get().query),
        pluginsIpc.listInstalledPlugins(),
      ]);
      set({
        marketplaces: marketplacesResult.marketplaces,
        plugins: searchResult.plugins,
        installedPlugins: installedResult.plugins,
      });
    },
    markLoading,
  );
}

async function withAction(set: StoreSet, action: () => Promise<void>, markLoading = true): Promise<void> {
  if (markLoading) {
    set({ loading: true, error: null });
  } else {
    set({ error: null });
  }
  try {
    await action();
  } catch (error) {
    set({ error: (error as Error).message });
  } finally {
    if (markLoading) {
      set({ loading: false });
    }
  }
}

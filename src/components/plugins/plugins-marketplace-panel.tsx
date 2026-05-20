import * as React from "react";
import { Compass, PackageCheck, Search, Store } from "lucide-react";
import {
  CategoryFilterDropdown,
  InstalledPluginsTab,
  MarketplaceSettingsDialog,
  PanelEmpty,
  PluginSearchRow,
} from "@/components/plugins/plugin-marketplace-views";
import { Button } from "@/components/ui/button";
import {
  buildMarketplacePluginLookups,
  categoryOptionsForPlugins,
  defaultSelectionForProvider,
  pluginForProvider,
  pluginInstallStatusFromLookups,
  pluginMatchesCategories,
  pluginSearchRowKey,
  pluginVariantKey,
  pluginVariantKeyFromParts,
  recommendedVariant,
  visibleInstalledPlugins,
} from "@/lib/plugins-marketplace";
import type {
  MarketplaceProviderSelection,
  PluginInstallStatus,
} from "@/lib/plugins-marketplace";
import { cn } from "@/lib/utils";
import { usePluginsStore } from "@/stores/plugins-store";
import type { DedupedMarketplacePlugin } from "@/types/plugins";

export function PluginsMarketplacePanel(): React.JSX.Element {
  const marketplaces = usePluginsStore((state) => state.marketplaces);
  const plugins = usePluginsStore((state) => state.plugins);
  const installedPlugins = usePluginsStore((state) => state.installedPlugins);
  const previewsByVariant = usePluginsStore((state) => state.previewsByVariant);
  const query = usePluginsStore((state) => state.query);
  const loading = usePluginsStore((state) => state.loading);
  const error = usePluginsStore((state) => state.error);
  const initializeMarketplaces = usePluginsStore((state) => state.initializeMarketplaces);
  const setQuery = usePluginsStore((state) => state.setQuery);
  const search = usePluginsStore((state) => state.search);
  const ensureDefaultMarketplaces = usePluginsStore((state) => state.ensureDefaultMarketplaces);
  const addLocalMarketplace = usePluginsStore((state) => state.addLocalMarketplace);
  const previewPlugin = usePluginsStore((state) => state.previewPlugin);
  const installPlugin = usePluginsStore((state) => state.installPlugin);
  const uninstallPlugin = usePluginsStore((state) => state.uninstallPlugin);
  const [activeTab, setActiveTab] = React.useState<"installed" | "explore">("installed");
  const [provider, setProvider] = React.useState<MarketplaceProviderSelection>("all");
  const [selectedCategories, setSelectedCategories] = React.useState<string[]>([]);
  const [installingVariants, setInstallingVariants] = React.useState<Set<string>>(() => new Set());
  const [uninstallingVariants, setUninstallingVariants] = React.useState<Set<string>>(() => new Set());

  const visibleInstalled = React.useMemo(() => visibleInstalledPlugins(installedPlugins), [installedPlugins]);
  const lookups = React.useMemo(
    () => buildMarketplacePluginLookups(plugins, installedPlugins),
    [installedPlugins, plugins],
  );
  const providerPlugins = React.useMemo(
    () => plugins.map((plugin) => pluginForProvider(plugin, provider, marketplaces)).filter((plugin): plugin is DedupedMarketplacePlugin => Boolean(plugin)),
    [marketplaces, plugins, provider],
  );
  const categoryOptions = React.useMemo(() => categoryOptionsForPlugins(providerPlugins), [providerPlugins]);
  const visiblePlugins = React.useMemo(
    () => providerPlugins.filter((plugin) => pluginMatchesCategories(plugin, selectedCategories)),
    [providerPlugins, selectedCategories],
  );
  const installStatusByVariant = React.useMemo(
    () => buildRecommendedInstallStatuses(providerPlugins, lookups),
    [lookups, providerPlugins],
  );

  React.useEffect(() => {
    void initializeMarketplaces("all");
  }, [initializeMarketplaces]);

  React.useEffect(() => {
    setSelectedCategories((current) => current.filter((category) => categoryOptions.includes(category)));
  }, [categoryOptions]);

  function submitSearch(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void ensureProvider(provider).then((changed) => {
      if (!changed) {
        void search(query);
      }
    });
  }

  function changeProvider(nextProvider: MarketplaceProviderSelection): void {
    setProvider(nextProvider);
    void ensureProvider(nextProvider);
  }

  async function ensureProvider(nextProvider: MarketplaceProviderSelection): Promise<boolean> {
    const selection = defaultSelectionForProvider(nextProvider);
    return selection ? ensureDefaultMarketplaces(selection) : false;
  }

  function openSourceCode(url: string): void {
    void window.roderDesktop.openExternal(url);
  }

  async function refreshProvider(): Promise<void> {
    await initializeMarketplaces(defaultSelectionForProvider(provider) ?? "none");
  }

  async function installPluginWithPending(marketplaceId: string, pluginId: string): Promise<void> {
    const variantKey = pluginVariantKeyFromParts(marketplaceId, pluginId);
    setInstallingVariants((current) => new Set(current).add(variantKey));
    try {
      await installPlugin(marketplaceId, pluginId);
    } finally {
      setInstallingVariants((current) => {
        const next = new Set(current);
        next.delete(variantKey);
        return next;
      });
    }
  }

  async function uninstallPluginWithPending(variantKey: string): Promise<void> {
    setUninstallingVariants((current) => new Set(current).add(variantKey));
    try {
      await uninstallPlugin(variantKey);
    } finally {
      setUninstallingVariants((current) => {
        const next = new Set(current);
        next.delete(variantKey);
        return next;
      });
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <header className="drag-region flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Store className="size-4 text-muted-foreground" />
            <h1 className="truncate text-base font-medium">Plugins</h1>
          </div>
        </div>
        <div className="no-drag flex flex-wrap items-center justify-end gap-2">
          <div className="flex items-center gap-1" role="tablist" aria-label="Plugins sections">
            <PluginsTabButton active={activeTab === "installed"} onClick={() => setActiveTab("installed")}>
              <PackageCheck className="size-3.5" />
              Installed
              <span className="text-muted-foreground">{visibleInstalled.length}</span>
            </PluginsTabButton>
            <PluginsTabButton active={activeTab === "explore"} onClick={() => setActiveTab("explore")}>
              <Compass className="size-3.5" />
              Explore
            </PluginsTabButton>
          </div>
          <MarketplaceSettingsDialog
            loading={loading}
            onAdd={addLocalMarketplace}
            onRefresh={refreshProvider}
          />
        </div>
      </header>

      {error && <div className="border-b border-border bg-destructive/10 px-4 py-2 text-base text-destructive">{error}</div>}

      {activeTab === "installed" ? (
        <InstalledPluginsTab
          plugins={visibleInstalled}
          lookups={lookups}
          marketplaces={marketplaces}
          previewsByVariant={previewsByVariant}
          loading={loading}
          uninstallingVariants={uninstallingVariants}
          onExplore={() => setActiveTab("explore")}
          onPreview={previewPlugin}
          onUninstall={uninstallPluginWithPending}
          onOpenSource={openSourceCode}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto" role="tabpanel" aria-label="Explore plugins">
          <div className="mx-auto grid w-full max-w-screen-2xl gap-5 px-4 py-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            <form
              className="sticky top-0 z-10 col-span-full flex flex-wrap items-center justify-between gap-3 bg-background/95 py-3 backdrop-blur"
              onSubmit={submitSearch}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <label className="relative w-80 max-w-full">
                  <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                  <input
                    className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-base text-foreground outline-none focus:ring-2 focus:ring-ring"
                    value={query}
                    placeholder="Search plugins"
                    onChange={(event) => setQuery(event.currentTarget.value)}
                  />
                </label>
                <Button type="submit" size="compact" disabled={loading}>
                  Search
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="h-9 min-w-40 rounded-md border border-border bg-background px-2 text-base text-foreground outline-none focus:ring-2 focus:ring-ring"
                  value={provider}
                  onChange={(event) => changeProvider(event.currentTarget.value as MarketplaceProviderSelection)}
                  aria-label="Plugin provider"
                >
                  <option value="all">All providers</option>
                  <option value="anthropic">Claude</option>
                  <option value="cursor">Cursor</option>
                  <option value="codex">Codex</option>
                  <option value="local">Local</option>
                </select>
                <CategoryFilterDropdown
                  categories={categoryOptions}
                  selectedCategories={selectedCategories}
                  onChange={setSelectedCategories}
                />
              </div>
            </form>

            {visiblePlugins.length === 0 ? (
              <div className="col-span-full">
                <PanelEmpty>No plugins found for this provider.</PanelEmpty>
              </div>
            ) : (
              visiblePlugins.map((plugin) => (
                <PluginSearchRow
                  key={pluginSearchRowKey(plugin)}
                  plugin={plugin}
                  marketplaces={marketplaces}
                  installStatus={recommendedInstallStatus(plugin, installStatusByVariant)}
                  installingVariants={installingVariants}
                  uninstallingVariants={uninstallingVariants}
                  previewsByVariant={previewsByVariant}
                  onPreview={previewPlugin}
                  onInstall={installPluginWithPending}
                  onUninstall={uninstallPluginWithPending}
                  onOpenSource={openSourceCode}
                />
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function PluginsTabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full px-3 text-base font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-muted/50 text-foreground"
          : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function buildRecommendedInstallStatuses(
  plugins: DedupedMarketplacePlugin[],
  lookups: ReturnType<typeof buildMarketplacePluginLookups>,
): Map<string, PluginInstallStatus> {
  const statuses = new Map<string, PluginInstallStatus>();
  for (const plugin of plugins) {
    const variant = recommendedVariant(plugin);
    if (variant) {
      statuses.set(pluginVariantKey(variant), pluginInstallStatusFromLookups(plugin, variant, lookups));
    }
  }
  return statuses;
}

function recommendedInstallStatus(
  plugin: DedupedMarketplacePlugin,
  statuses: Map<string, PluginInstallStatus>,
): PluginInstallStatus | undefined {
  const variant = recommendedVariant(plugin);
  return variant ? statuses.get(pluginVariantKey(variant)) : undefined;
}

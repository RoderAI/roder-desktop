import { Ban, Download, PackageCheck, PackagePlus, Plus, RefreshCw, Search, Store, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  activeComponentLabels,
  installedVariantSet,
  pluginVariantKey,
  recommendedVariant,
  riskLabel,
  sourceLabel,
} from "@/lib/plugins-marketplace";
import { cn } from "@/lib/utils";
import { usePluginsStore } from "@/stores/plugins-store";
import type {
  DedupedMarketplacePlugin,
  DefaultMarketplaceSelection,
  InstalledPluginRecord,
  MarketplaceDescriptor,
  MarketplaceKind,
  MarketplacePluginVariant,
  PluginInstallPreview,
} from "@/types/plugins";

export function PluginsMarketplacePanel(): React.JSX.Element {
  const marketplaces = usePluginsStore((state) => state.marketplaces);
  const plugins = usePluginsStore((state) => state.plugins);
  const installedPlugins = usePluginsStore((state) => state.installedPlugins);
  const previewsByVariant = usePluginsStore((state) => state.previewsByVariant);
  const query = usePluginsStore((state) => state.query);
  const loading = usePluginsStore((state) => state.loading);
  const error = usePluginsStore((state) => state.error);
  const lastResult = usePluginsStore((state) => state.lastResult);
  const load = usePluginsStore((state) => state.load);
  const setQuery = usePluginsStore((state) => state.setQuery);
  const search = usePluginsStore((state) => state.search);
  const installDefaults = usePluginsStore((state) => state.installDefaults);
  const addLocalMarketplace = usePluginsStore((state) => state.addLocalMarketplace);
  const removeMarketplace = usePluginsStore((state) => state.removeMarketplace);
  const refreshMarketplace = usePluginsStore((state) => state.refreshMarketplace);
  const previewPlugin = usePluginsStore((state) => state.previewPlugin);
  const installPlugin = usePluginsStore((state) => state.installPlugin);
  const installAllVariants = usePluginsStore((state) => state.installAllVariants);
  const disablePlugin = usePluginsStore((state) => state.disablePlugin);
  const uninstallPlugin = usePluginsStore((state) => state.uninstallPlugin);
  const [defaultSelection, setDefaultSelection] = useState<DefaultMarketplaceSelection>("all");

  useEffect(() => {
    void load();
  }, [load]);

  function submitSearch(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void search(query);
  }

  return (
    <section className="rounded-xl border border-border bg-card shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <h1 className="text-[16px] font-medium">Plugins</h1>
          <p className="mt-1 text-[14px] text-muted-foreground">
            {installedPlugins.length} installed variants, {marketplaces.length} marketplaces
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load()}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <select
            className="h-8 rounded-md border border-border bg-muted px-2 text-[13px] text-foreground outline-none"
            value={defaultSelection}
            onChange={(event) => setDefaultSelection(event.currentTarget.value as DefaultMarketplaceSelection)}
          >
            <option value="all">All defaults</option>
            <option value="anthropic">Claude</option>
            <option value="cursor">Cursor</option>
            <option value="codex">Codex</option>
            <option value="none">None</option>
          </select>
          <Button variant="secondary" size="sm" disabled={loading} onClick={() => void installDefaults(defaultSelection)}>
            <Download className="size-3.5" />
            Install defaults
          </Button>
        </div>
      </header>

      {error && <div className="border-b border-border px-5 py-3 text-[13px] text-destructive">{error}</div>}
      {lastResult && <div className="border-b border-border px-5 py-3 text-[13px] text-muted-foreground">{lastResult}</div>}

      <div className="grid gap-0 lg:grid-cols-3">
        <div className="border-b border-border lg:col-span-2 lg:border-b-0 lg:border-r">
          <form className="flex gap-2 border-b border-border px-5 py-4" onSubmit={submitSearch}>
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <input
                className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-[14px] text-foreground outline-none focus:ring-2 focus:ring-ring"
                value={query}
                placeholder="Search plugins"
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
            <Button type="submit" variant="secondary" size="compact" disabled={loading}>
              Search
            </Button>
          </form>

          {plugins.length === 0 ? (
            <div className="px-5 py-8 text-[14px] text-muted-foreground">
              No marketplace plugins found. Install defaults or add and refresh a local marketplace, then search again.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {plugins.map((plugin) => (
                <PluginSearchRow
                  key={plugin.identityKey.canonicalSlug}
                  plugin={plugin}
                  installedPlugins={installedPlugins}
                  previewsByVariant={previewsByVariant}
                  onPreview={previewPlugin}
                  onInstall={installPlugin}
                  onInstallAll={installAllVariants}
                />
              ))}
            </div>
          )}
        </div>

        <aside className="space-y-4 px-5 py-4">
          <MarketplacesList
            marketplaces={marketplaces}
            loading={loading}
            onRefresh={refreshMarketplace}
            onRemove={removeMarketplace}
          />
          <LocalMarketplaceForm loading={loading} onAdd={addLocalMarketplace} />
          <InstalledPluginsList
            plugins={installedPlugins}
            loading={loading}
            onDisable={disablePlugin}
            onUninstall={uninstallPlugin}
          />
        </aside>
      </div>
    </section>
  );
}

function PluginSearchRow({
  plugin,
  installedPlugins,
  previewsByVariant,
  onPreview,
  onInstall,
  onInstallAll,
}: {
  plugin: DedupedMarketplacePlugin;
  installedPlugins: InstalledPluginRecord[];
  previewsByVariant: Record<string, PluginInstallPreview>;
  onPreview: (marketplaceId: string, pluginId: string) => Promise<void>;
  onInstall: (marketplaceId: string, pluginId: string) => Promise<void>;
  onInstallAll: (marketplaceId: string, pluginId: string) => Promise<void>;
}): React.JSX.Element {
  const variant = recommendedVariant(plugin);
  const installedKeys = useMemo(() => installedVariantSet(plugin, installedPlugins), [installedPlugins, plugin]);
  const preview = variant ? previewsByVariant[pluginVariantKey(variant)] : undefined;

  return (
    <article className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-[15px] font-medium">{plugin.displayName}</h2>
            {variant && <Badge variant="muted">{variant.kind}</Badge>}
            {variant && <Badge variant={variant.risk === "passive" ? "secondary" : "outline"}>{riskLabel(variant.risk)}</Badge>}
            {plugin.installedVariants.length > 0 && <Badge variant="secondary">Installed</Badge>}
          </div>
          <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">{plugin.description || "No description provided."}</p>
          {variant && (
            <p className="mt-2 truncate text-[12px] text-muted-foreground" title={sourceLabel(variant.source)}>
              {sourceLabel(variant.source)}
            </p>
          )}
        </div>
        {variant && (
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => void onPreview(variant.marketplaceId, variant.pluginId)}>
              Preview
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void onInstall(variant.marketplaceId, variant.pluginId)}>
              <PackagePlus className="size-3.5" />
              Install
            </Button>
            {plugin.variants.length > 1 && (
              <Button variant="ghost" size="sm" onClick={() => void onInstallAll(variant.marketplaceId, variant.pluginId)}>
                All variants
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 grid gap-2">
        {plugin.variants.map((candidate) => (
          <VariantRow
            key={pluginVariantKey(candidate)}
            variant={candidate}
            installed={installedKeys.has(pluginVariantKey(candidate))}
            onPreview={onPreview}
            onInstall={onInstall}
          />
        ))}
      </div>

      {preview && (
        <pre className="mt-3 max-h-48 overflow-auto rounded-md bg-muted px-3 py-2 text-[12px] text-muted-foreground">
          {JSON.stringify(preview, null, 2)}
        </pre>
      )}
    </article>
  );
}

function VariantRow({
  variant,
  installed,
  onPreview,
  onInstall,
}: {
  variant: MarketplacePluginVariant;
  installed: boolean;
  onPreview: (marketplaceId: string, pluginId: string) => Promise<void>;
  onInstall: (marketplaceId: string, pluginId: string) => Promise<void>;
}): React.JSX.Element {
  const components = activeComponentLabels(variant.componentHints);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-[12px]">
      <span className="font-medium text-foreground">{variant.marketplaceId}</span>
      <Badge variant="muted">{variant.kind}</Badge>
      {variant.version && <span className="text-muted-foreground">{variant.version}</span>}
      {components.length > 0 && <span className="min-w-0 flex-1 truncate text-muted-foreground">{components.join(", ")}</span>}
      {installed && <Badge variant="secondary">Installed</Badge>}
      <Button variant="ghost" size="sm" onClick={() => void onPreview(variant.marketplaceId, variant.pluginId)}>
        Preview
      </Button>
      <Button variant="ghost" size="sm" onClick={() => void onInstall(variant.marketplaceId, variant.pluginId)}>
        Install
      </Button>
    </div>
  );
}

function MarketplacesList({
  marketplaces,
  loading,
  onRefresh,
  onRemove,
}: {
  marketplaces: MarketplaceDescriptor[];
  loading: boolean;
  onRefresh: (marketplaceId: string) => Promise<void>;
  onRemove: (marketplaceId: string) => Promise<void>;
}): React.JSX.Element {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
        <Store className="size-3.5" />
        Marketplaces
      </div>
      {marketplaces.length === 0 ? (
        <div className="rounded-md border border-border px-3 py-3 text-[13px] text-muted-foreground">No marketplaces configured.</div>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border">
          {marketplaces.map((marketplace) => (
            <div key={marketplace.id} className="px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-foreground">{marketplace.displayName}</span>
                    <Badge variant={marketplace.enabled ? "secondary" : "muted"}>{marketplace.state}</Badge>
                  </div>
                  <p className="mt-1 truncate text-[12px] text-muted-foreground">{marketplace.id}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon" className="size-7" disabled={loading || !marketplace.enabled} aria-label={`Refresh ${marketplace.displayName}`} onClick={() => void onRefresh(marketplace.id)}>
                    <RefreshCw className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7" disabled={loading} aria-label={`Remove ${marketplace.displayName}`} onClick={() => void onRemove(marketplace.id)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function LocalMarketplaceForm({
  loading,
  onAdd,
}: {
  loading: boolean;
  onAdd: (params: { id: string; displayName: string; path: string; kind?: MarketplaceKind }) => Promise<void>;
}): React.JSX.Element {
  const [id, setId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [path, setPath] = useState("");
  const [kind, setKind] = useState<MarketplaceKind | "">("");
  const disabled = loading || !id.trim() || !displayName.trim() || !path.trim();

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (disabled) {
      return;
    }
    void onAdd({ id: id.trim(), displayName: displayName.trim(), path: path.trim(), kind: kind || undefined });
  }

  return (
    <form className="space-y-2" onSubmit={submit}>
      <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
        <Plus className="size-3.5" />
        Add local marketplace
      </div>
      <input className="h-8 w-full rounded-md border border-border bg-background px-2 text-[13px] outline-none focus:ring-2 focus:ring-ring" value={id} placeholder="id" onChange={(event) => setId(event.currentTarget.value)} />
      <input className="h-8 w-full rounded-md border border-border bg-background px-2 text-[13px] outline-none focus:ring-2 focus:ring-ring" value={displayName} placeholder="Display name" onChange={(event) => setDisplayName(event.currentTarget.value)} />
      <input className="h-8 w-full rounded-md border border-border bg-background px-2 text-[13px] outline-none focus:ring-2 focus:ring-ring" value={path} placeholder="/path/to/marketplace" onChange={(event) => setPath(event.currentTarget.value)} />
      <div className="flex gap-2">
        <select className="h-8 min-w-0 flex-1 rounded-md border border-border bg-muted px-2 text-[13px] outline-none" value={kind} onChange={(event) => setKind(event.currentTarget.value as MarketplaceKind | "")}>
          <option value="">Infer kind</option>
          <option value="claude">Claude</option>
          <option value="cursor">Cursor</option>
          <option value="codex">Codex</option>
          <option value="roder">Roder</option>
          <option value="custom">Custom</option>
        </select>
        <Button type="submit" variant="secondary" size="sm" disabled={disabled}>
          Add
        </Button>
      </div>
    </form>
  );
}

function InstalledPluginsList({
  plugins,
  loading,
  onDisable,
  onUninstall,
}: {
  plugins: InstalledPluginRecord[];
  loading: boolean;
  onDisable: (variantKey: string) => Promise<void>;
  onUninstall: (variantKey: string) => Promise<void>;
}): React.JSX.Element {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
        <PackageCheck className="size-3.5" />
        Installed
      </div>
      {plugins.length === 0 ? (
        <div className="rounded-md border border-border px-3 py-3 text-[13px] text-muted-foreground">No plugin variants installed.</div>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border">
          {plugins.map((plugin) => (
            <div key={plugin.variantKey} className="px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-foreground">{plugin.identityKey.normalizedName}</span>
                    <Badge variant={plugin.state === "installed" ? "secondary" : "muted"}>{plugin.state}</Badge>
                  </div>
                  <p className="mt-1 truncate text-[12px] text-muted-foreground" title={plugin.installPath}>{plugin.variantKey}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon" className="size-7" disabled={loading || plugin.state === "disabled"} aria-label={`Disable ${plugin.variantKey}`} onClick={() => void onDisable(plugin.variantKey)}>
                    <Ban className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7" disabled={loading} aria-label={`Uninstall ${plugin.variantKey}`} onClick={() => void onUninstall(plugin.variantKey)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

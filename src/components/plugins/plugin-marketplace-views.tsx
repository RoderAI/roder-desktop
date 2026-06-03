import * as React from "react";
import { Check, Compass, ExternalLink, ListFilter, PackagePlus, Plus, RefreshCw, Settings } from "lucide-react";
import {
  PluginActionContent,
  immediatePluginActionState,
  pluginActionButtonClassName,
  pluginActionButtonVariant,
} from "@/components/plugins/plugin-action";
import { PluginDetailsDialog } from "@/components/plugins/plugin-details-dialog";
import { PluginIcon } from "@/components/plugins/plugin-icon";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuCheckboxItemIndicator,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  categoryLabel,
  homepageIconUrl,
  marketplacePluginForInstalled,
  pluginVariantKey,
  recommendedVariant,
  sourceCodeUrl,
} from "@/lib/plugins-marketplace";
import type { MarketplacePluginLookups, MarketplacePluginMatch, PluginInstallStatus } from "@/lib/plugins-marketplace";
import { cn } from "@/lib/utils";
import type {
  DedupedMarketplacePlugin,
  InstalledPluginRecord,
  MarketplaceDescriptor,
  MarketplaceKind,
  PluginInstallPreview,
} from "@/types/plugins";

export function InstalledPluginsTab({
  plugins,
  lookups,
  marketplaces,
  previewsByVariant,
  loading,
  uninstallingVariants,
  onExplore,
  onPreview,
  onUninstall,
  onOpenSource,
}: {
  plugins: InstalledPluginRecord[];
  lookups: MarketplacePluginLookups;
  marketplaces: MarketplaceDescriptor[];
  previewsByVariant: Record<string, PluginInstallPreview>;
  loading: boolean;
  uninstallingVariants: Set<string>;
  onExplore: () => void;
  onPreview: (marketplaceId: string, pluginId: string) => Promise<void>;
  onUninstall: (variantKey: string) => Promise<void>;
  onOpenSource: (url: string) => void;
}): React.JSX.Element {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" role="tabpanel" aria-label="Installed plugins">
      {plugins.length === 0 ? (
        <Empty className="min-h-full">
          <EmptyHeader>
            <EmptyMedia variant="icon" tone="green" className="size-14 rounded-2xl">
              <PackagePlus className="size-8" />
            </EmptyMedia>
            <EmptyTitle>No plugins installed yet.</EmptyTitle>
            <EmptyDescription>Browse the plugin directory to add tools for this workspace.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="success" size="sm" onClick={onExplore}>
              <Compass className="size-3.5" />
              Explore plugins
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="mx-auto grid w-full max-w-screen-2xl gap-5 px-4 py-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {plugins.map((plugin) => (
            <InstalledPluginRow
              key={plugin.variantKey}
              plugin={plugin}
              marketplaceMatch={marketplacePluginForInstalled(plugin, lookups)}
              marketplaces={marketplaces}
              preview={previewsByVariant[plugin.variantKey]}
              loading={loading}
              uninstalling={uninstallingVariants.has(plugin.variantKey)}
              onPreview={onPreview}
              onUninstall={onUninstall}
              onOpenSource={onOpenSource}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function PluginSearchRow({
  plugin,
  marketplaces,
  installStatus,
  installingVariants,
  uninstallingVariants,
  previewsByVariant,
  onPreview,
  onInstall,
  onUninstall,
  onOpenSource,
}: {
  plugin: DedupedMarketplacePlugin;
  marketplaces: MarketplaceDescriptor[];
  installStatus: PluginInstallStatus | undefined;
  installingVariants: Set<string>;
  uninstallingVariants: Set<string>;
  previewsByVariant: Record<string, PluginInstallPreview>;
  onPreview: (marketplaceId: string, pluginId: string) => Promise<void>;
  onInstall: (marketplaceId: string, pluginId: string) => Promise<void>;
  onUninstall: (variantKey: string) => Promise<void>;
  onOpenSource: (url: string) => void;
}): React.JSX.Element {
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const variant = recommendedVariant(plugin);
  const variantKey = variant ? pluginVariantKey(variant) : undefined;
  const preview = variant ? previewsByVariant[pluginVariantKey(variant)] : undefined;
  const sourceUrl = variant ? sourceCodeUrl(variant.source, marketplaces) : undefined;
  const homepageUrl = variant?.homepage?.trim() || undefined;
  const iconUrl = homepageIconUrl(homepageUrl);
  const pendingVariantKey = installStatus?.variantKey ?? variantKey;
  const variantInstalling = Boolean(pendingVariantKey && installingVariants.has(pendingVariantKey));
  const variantUninstalling = Boolean(pendingVariantKey && uninstallingVariants.has(pendingVariantKey));
  const actionState = immediatePluginActionState({
    installed: Boolean(installStatus?.variantInstalled),
    installing: variantInstalling,
    uninstalling: variantUninstalling,
  });

  async function openDetails(): Promise<void> {
    setDetailsOpen(true);
    if (!variant || preview) {
      return;
    }
    setPreviewLoading(true);
    try {
      await onPreview(variant.marketplaceId, variant.pluginId);
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <>
      <article className="flex min-h-56 min-w-0 flex-col justify-between gap-3 rounded-3xl border border-border bg-white p-4">
        <div className="min-w-0">
          <div className="mb-3 flex justify-center">
            <PluginIcon src={iconUrl} alt="" />
          </div>
          {homepageUrl ? (
            <button
              type="button"
              className="mx-auto flex max-w-full items-center justify-center gap-1.5 text-center text-base font-medium outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onOpenSource(homepageUrl)}
            >
              <span className="truncate">{plugin.displayName}</span>
              <ExternalLink className="size-3.5 shrink-0" />
            </button>
          ) : (
            <h2 className="truncate text-center text-base font-medium">{plugin.displayName}</h2>
          )}
          <p className="mx-auto mt-1.5 line-clamp-2 min-h-10 max-w-2xl text-center text-base leading-5 text-muted-foreground">
            {plugin.description || "No description provided."}
          </p>
        </div>

        {variant && (
          <div className="grid shrink-0 grid-cols-2 gap-2.5">
            <Button size="sm" className="w-full" onClick={() => void openDetails()}>
              <span className="min-w-0 truncate">Learn More</span>
            </Button>
            {installStatus?.variantInstalled ? (
              <Button
                variant={pluginActionButtonVariant(actionState)}
                size="sm"
                className={pluginActionButtonClassName(actionState, "w-full")}
                disabled={variantUninstalling}
                onClick={() => void onUninstall(installStatus.variantKey)}
              >
                <PluginActionContent state={actionState} />
              </Button>
            ) : (
              <Button
                variant={pluginActionButtonVariant(actionState)}
                size="sm"
                className={pluginActionButtonClassName(actionState, "w-full")}
                disabled={variantInstalling}
                onClick={() => void onInstall(variant.marketplaceId, variant.pluginId)}
              >
                <PluginActionContent state={actionState} />
              </Button>
            )}
          </div>
        )}
      </article>
      {variant && (
        <PluginDetailsDialog
          open={detailsOpen}
          plugin={plugin}
          variant={variant}
          preview={preview}
          previewLoading={previewLoading}
          sourceUrl={sourceUrl}
          homepageUrl={homepageUrl}
          installed={Boolean(installStatus?.variantInstalled)}
          actionState={actionState}
          installing={variantInstalling}
          uninstalling={variantUninstalling}
          onOpenChange={setDetailsOpen}
          onOpenSource={onOpenSource}
          onInstall={() => onInstall(variant.marketplaceId, variant.pluginId)}
          onUninstall={() => installStatus && onUninstall(installStatus.variantKey)}
        />
      )}
    </>
  );
}

export function CategoryFilterDropdown({
  categories,
  selectedCategories,
  onChange,
}: {
  categories: string[];
  selectedCategories: string[];
  onChange: (categories: string[]) => void;
}): React.JSX.Element {
  const selected = new Set(selectedCategories);
  const label = selectedCategories.length === 0 ? "Categories" : `${selectedCategories.length} selected`;

  function toggleCategory(category: string, checked: boolean): void {
    if (checked) {
      onChange([...selectedCategories, category].sort((left, right) => left.localeCompare(right)));
      return;
    }
    onChange(selectedCategories.filter((selectedCategory) => selectedCategory !== category));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(buttonVariants({ variant: "outline", size: "compact" }), "min-w-36 justify-between pr-5")}
        disabled={categories.length === 0}
      >
        <span className="flex min-w-0 items-center gap-2">
          <ListFilter className="size-3.5 shrink-0" />
          <span className="truncate">{label}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 min-w-56 overflow-y-auto">
        <DropdownMenuGroup>
          {selectedCategories.length > 0 && (
            <button
              type="button"
              className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-base text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground"
              onClick={() => onChange([])}
            >
              Clear categories
            </button>
          )}
          {categories.map((category) => (
            <DropdownMenuCheckboxItem
              key={category}
              checked={selected.has(category)}
              closeOnClick={false}
              className="relative flex cursor-default select-none items-center gap-2 rounded-lg py-1.5 pl-8 pr-2 text-base outline-none data-[highlighted]:bg-accent"
              onCheckedChange={(checked) => toggleCategory(category, checked)}
            >
              <DropdownMenuCheckboxItemIndicator className="absolute left-2 flex size-4 items-center justify-center">
                <Check className="size-3.5" />
              </DropdownMenuCheckboxItemIndicator>
              <span className="min-w-0 flex-1 truncate">{categoryLabel(category)}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MarketplaceSettingsDialog({
  loading,
  onAdd,
  onRefresh,
}: {
  loading: boolean;
  onAdd: (params: { id: string; displayName: string; path: string; kind?: MarketplaceKind }) => Promise<void>;
  onRefresh: () => Promise<void>;
}): React.JSX.Element {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 rounded-lg"
          aria-label="Marketplace settings"
          title="Marketplace settings"
        >
          <Settings className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Provider settings</DialogTitle>
          <DialogDescription>Add a local provider for private or development plugin sources.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 px-3 py-2">
          <div className="min-w-0">
            <div className="text-base font-medium">Refresh providers</div>
            <div className="text-base text-muted-foreground">Reload marketplaces and installed plugins.</div>
          </div>
          <Button variant="ghost" size="sm" disabled={loading} onClick={() => void onRefresh()}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
        <LocalMarketplaceForm loading={loading} onAdd={onAdd} />
      </DialogContent>
    </Dialog>
  );
}

export function PanelEmpty({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="px-4 py-8 text-base text-muted-foreground">{children}</div>;
}

function InstalledPluginRow({
  plugin,
  marketplaceMatch,
  marketplaces,
  preview,
  loading,
  uninstalling,
  onPreview,
  onUninstall,
  onOpenSource,
}: {
  plugin: InstalledPluginRecord;
  marketplaceMatch: MarketplacePluginMatch | undefined;
  marketplaces: MarketplaceDescriptor[];
  preview: PluginInstallPreview | undefined;
  loading: boolean;
  uninstalling: boolean;
  onPreview: (marketplaceId: string, pluginId: string) => Promise<void>;
  onUninstall: (variantKey: string) => Promise<void>;
  onOpenSource: (url: string) => void;
}): React.JSX.Element {
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const matchedPlugin = marketplaceMatch?.plugin;
  const matchedVariant = marketplaceMatch?.variant;
  const homepageUrl = matchedVariant?.homepage?.trim() || undefined;
  const sourceUrl = matchedVariant ? sourceCodeUrl(matchedVariant.source, marketplaces) : undefined;
  const displayName = matchedPlugin?.displayName ?? plugin.identityKey.normalizedName;
  const description = matchedPlugin?.description || `Installed from ${plugin.marketplaceId}.`;
  const actionState = immediatePluginActionState({
    installed: true,
    installing: false,
    uninstalling,
  });

  async function openDetails(): Promise<void> {
    if (!matchedVariant) {
      return;
    }
    setDetailsOpen(true);
    if (preview) {
      return;
    }
    setPreviewLoading(true);
    try {
      await onPreview(matchedVariant.marketplaceId, matchedVariant.pluginId);
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <>
      <article className="flex min-h-64 min-w-0 flex-col justify-between gap-4 rounded-3xl border border-border bg-white p-5">
        <div className="min-w-0">
          <div className="mb-4 flex justify-center">
            <PluginIcon src={homepageIconUrl(homepageUrl)} alt="" />
          </div>
          {homepageUrl ? (
            <button
              type="button"
              className="mx-auto flex max-w-full items-center justify-center gap-1.5 text-center text-base font-medium outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onOpenSource(homepageUrl)}
            >
              <span className="truncate">{displayName}</span>
              <ExternalLink className="size-3.5 shrink-0" />
            </button>
          ) : (
            <h2 className="truncate text-center text-base font-medium">{displayName}</h2>
          )}
          <p className="mx-auto mt-2 line-clamp-2 min-h-12 max-w-2xl text-center text-base leading-6 text-muted-foreground">
            {description}
          </p>
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-3">
          <Button size="sm" className="w-full" disabled={!matchedVariant} onClick={() => void openDetails()}>
            <span className="min-w-0 truncate">Learn More</span>
          </Button>
          <Button
            variant={pluginActionButtonVariant(actionState)}
            size="sm"
            className={pluginActionButtonClassName(actionState, "w-full")}
            disabled={loading || uninstalling}
            onClick={() => void onUninstall(plugin.variantKey)}
          >
            <PluginActionContent state={actionState} />
          </Button>
        </div>
      </article>
      {matchedPlugin && matchedVariant && (
        <PluginDetailsDialog
          open={detailsOpen}
          plugin={matchedPlugin}
          variant={matchedVariant}
          preview={preview}
          previewLoading={previewLoading}
          sourceUrl={sourceUrl}
          homepageUrl={homepageUrl}
          installed
          actionState={actionState}
          installing={false}
          uninstalling={uninstalling}
          onOpenChange={setDetailsOpen}
          onOpenSource={onOpenSource}
          onInstall={() => Promise.resolve()}
          onUninstall={() => onUninstall(plugin.variantKey)}
        />
      )}
    </>
  );
}

function LocalMarketplaceForm({
  loading,
  onAdd,
}: {
  loading: boolean;
  onAdd: (params: { id: string; displayName: string; path: string; kind?: MarketplaceKind }) => Promise<void>;
}): React.JSX.Element {
  const [id, setId] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [path, setPath] = React.useState("");
  const [kind, setKind] = React.useState<MarketplaceKind | "">("");
  const disabled = loading || !id.trim() || !displayName.trim() || !path.trim();

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (disabled) {
      return;
    }
    void onAdd({ id: id.trim(), displayName: displayName.trim(), path: path.trim(), kind: kind || undefined });
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={submit}>
      <div className="flex items-center gap-2 font-medium text-muted-foreground">
        <Plus className="size-3.5" />
        Add local provider
      </div>
      <input
        className="h-9 w-full rounded-md border border-border bg-background px-2 text-base outline-none focus:ring-2 focus:ring-ring"
        value={id}
        aria-label="Provider ID"
        placeholder="id"
        onChange={(event) => setId(event.currentTarget.value)}
      />
      <input
        className="h-9 w-full rounded-md border border-border bg-background px-2 text-base outline-none focus:ring-2 focus:ring-ring"
        value={displayName}
        aria-label="Provider display name"
        placeholder="Display name"
        onChange={(event) => setDisplayName(event.currentTarget.value)}
      />
      <input
        className="h-9 w-full rounded-md border border-border bg-background px-2 text-base outline-none focus:ring-2 focus:ring-ring"
        value={path}
        aria-label="Provider marketplace path"
        placeholder="/path/to/marketplace"
        onChange={(event) => setPath(event.currentTarget.value)}
      />
      <div className="flex gap-2">
        <select
          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-base outline-none focus:ring-2 focus:ring-ring"
          value={kind}
          onChange={(event) => setKind(event.currentTarget.value as MarketplaceKind | "")}
          aria-label="Local marketplace kind"
        >
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

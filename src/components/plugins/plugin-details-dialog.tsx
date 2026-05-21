import * as React from "react";
import { ExternalLink } from "lucide-react";
import {
  PluginActionContent,
  type PluginActionState,
  pluginActionButtonClassName,
  pluginActionButtonVariant,
} from "@/components/plugins/plugin-action";
import { PluginIcon } from "@/components/plugins/plugin-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DotMatrixSpinner } from "@/components/ui/dot-matrix-spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  activeComponentLabels,
  homepageIconUrl,
  pluginVariantKey,
  riskLabel,
  sourceLabel,
  variantLabel,
} from "@/lib/plugins-marketplace";
import type {
  DedupedMarketplacePlugin,
  MarketplacePluginVariant,
  PluginInstallPreview,
} from "@/types/plugins";

export function PluginDetailsDialog({
  open,
  plugin,
  variant,
  preview,
  previewLoading,
  sourceUrl,
  homepageUrl,
  installed,
  actionState,
  installing,
  uninstalling,
  onOpenChange,
  onOpenSource,
  onInstall,
  onUninstall,
}: {
  open: boolean;
  plugin: DedupedMarketplacePlugin;
  variant: MarketplacePluginVariant;
  preview: PluginInstallPreview | undefined;
  previewLoading: boolean;
  sourceUrl: string | undefined;
  homepageUrl: string | undefined;
  installed: boolean;
  actionState: PluginActionState;
  installing: boolean;
  uninstalling: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSource: (url: string) => void;
  onInstall: () => Promise<void>;
  onUninstall: () => Promise<void> | undefined;
}): React.JSX.Element {
  const components = activeComponentLabels(preview?.componentHints ?? variant.componentHints);
  const capabilityHints = preview?.capabilityHints ?? variant.capabilityHints;
  const risk = preview?.risk ?? variant.risk;
  const tags = variant.tags;
  const subSkills = preview ? extractPreviewStrings(preview.rawManifest, ["skills", "subSkills", "subskills"]) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl rounded-3xl p-6">
        <DialogHeader>
          <div className="flex items-start gap-4">
            <PluginIcon src={homepageIconUrl(homepageUrl)} alt="" />
            <div className="min-w-0 flex-1">
              <DialogTitle className="flex min-w-0 flex-wrap items-center gap-2 text-xl">
                <span className="truncate">{plugin.displayName}</span>
                {homepageUrl && (
                  <button
                    type="button"
                    className="inline-flex items-center text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Open ${plugin.displayName} website`}
                    onClick={() => onOpenSource(homepageUrl)}
                  >
                    <ExternalLink className="size-4" />
                  </button>
                )}
              </DialogTitle>
              <DialogDescription className="mt-2 max-w-2xl">
                {plugin.description || "No description provided."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <PluginDetailSection title="What it includes">
            <DetailPills emptyLabel="No component hints provided." items={components} />
          </PluginDetailSection>

          <PluginDetailSection title="Risk">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={risk === "passive" ? "secondary" : "outline"}>{riskLabel(risk)}</Badge>
              <span className="text-base text-muted-foreground">
                {risk === "passive" ? "No active process, hook, or workspace-read hint." : "Review before installing."}
              </span>
            </div>
          </PluginDetailSection>

          <PluginDetailSection title="Capabilities">
            <DetailPills emptyLabel="No capability hints provided." items={capabilityHints} />
          </PluginDetailSection>

          <PluginDetailSection title="Sub skills">
            <DetailPills
              emptyLabel={previewLoading ? "Loading preview..." : "No sub-skill details found in the preview."}
              items={subSkills}
            />
          </PluginDetailSection>

          <PluginDetailSection title="Tags">
            <DetailPills
              emptyLabel="No tags provided."
              items={[variant.category, ...tags].filter((item): item is string => Boolean(item))}
            />
          </PluginDetailSection>
        </div>

        <PluginDetailSection title="Variant">
          <div className="grid gap-2 text-base text-muted-foreground sm:grid-cols-2">
            <DetailLine label="Provider" value={variant.marketplaceId} />
            <DetailLine label="Kind" value={variant.kind} />
            <DetailLine label="Plugin ID" value={variant.pluginId} />
            <DetailLine label="Version" value={variant.version ?? "Unknown"} />
          </div>
          <div className="mt-3 truncate font-mono text-base text-muted-foreground" title={sourceLabel(variant.source)}>
            {sourceLabel(variant.source)}
          </div>
        </PluginDetailSection>

        {plugin.variants.length > 1 && (
          <PluginDetailSection title="Related variants">
            <div className="flex flex-col gap-2">
              {plugin.variants.map((candidate) => (
                <div key={pluginVariantKey(candidate)} className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/30 px-3 py-2 text-base">
                  <span className="font-medium text-foreground">{variantLabel(candidate)}</span>
                  <Badge variant="outline">{candidate.marketplaceId}</Badge>
                  <Badge variant="muted">{candidate.kind}</Badge>
                  <Badge variant={candidate.risk === "passive" ? "secondary" : "outline"}>{riskLabel(candidate.risk)}</Badge>
                </div>
              ))}
            </div>
          </PluginDetailSection>
        )}

        <PluginDetailSection title="Preview">
          {previewLoading ? (
            <div className="flex items-center gap-2 text-base text-muted-foreground">
              <DotMatrixSpinner />
              Loading preview
            </div>
          ) : preview ? (
            <pre className="max-h-64 overflow-auto rounded-2xl bg-muted/30 p-3 font-mono text-base text-muted-foreground">
              {JSON.stringify(preview, null, 2)}
            </pre>
          ) : (
            <div className="text-base text-muted-foreground">No preview data loaded.</div>
          )}
        </PluginDetailSection>

        <DialogFooter>
          {sourceUrl && (
            <Button variant="ghost" size="sm" onClick={() => onOpenSource(sourceUrl)}>
              <ExternalLink className="size-3.5" />
              Source
            </Button>
          )}
          {installed ? (
            <Button
              variant={pluginActionButtonVariant(actionState)}
              size="sm"
              className={pluginActionButtonClassName(actionState)}
              disabled={uninstalling}
              onClick={() => void onUninstall()}
            >
              <PluginActionContent state={actionState} />
            </Button>
          ) : (
            <Button
              variant={pluginActionButtonVariant(actionState)}
              size="sm"
              className={pluginActionButtonClassName(actionState)}
              disabled={installing}
              onClick={() => void onInstall()}
            >
              <PluginActionContent state={actionState} />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PluginDetailSection({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="rounded-2xl border border-border bg-background p-4">
      <h3 className="mb-2 text-base font-medium text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function DetailPills({ items, emptyLabel }: { items: string[]; emptyLabel: string }): React.JSX.Element {
  if (items.length === 0) {
    return <div className="text-base text-muted-foreground">{emptyLabel}</div>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, index) => (
        <Badge key={`${item}:${index}`} variant="outline">{item}</Badge>
      ))}
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground">{label}</div>
      <div className="truncate font-medium text-foreground" title={value}>{value}</div>
    </div>
  );
}

function extractPreviewStrings(value: unknown, keys: string[]): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const extracted = unknownListToLabels(record[key]);
    if (extracted.length > 0) {
      return extracted;
    }
  }
  return [];
}

function unknownListToLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        const label = record.name ?? record.id ?? record.title;
        return typeof label === "string" ? label : undefined;
      }
      return undefined;
    })
    .filter((item): item is string => Boolean(item));
}

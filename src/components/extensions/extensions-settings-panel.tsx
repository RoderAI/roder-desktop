import { Play, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useExtensionsStore } from "@/stores/extensions-store";
import type { ExtensionCatalogRecord } from "@/types/extensions";
import { cn } from "@/lib/utils";

type ExtensionsSettingsPanelProps = {
  surface?: "settings" | "sidebar";
};

export function ExtensionsSettingsPanel({ surface = "settings" }: ExtensionsSettingsPanelProps): React.JSX.Element {
  const extensions = useExtensionsStore((state) => state.extensions);
  const loading = useExtensionsStore((state) => state.loading);
  const error = useExtensionsStore((state) => state.error);
  const lastResult = useExtensionsStore((state) => state.lastResult);
  const load = useExtensionsStore((state) => state.load);
  const selectAndInstallArchive = useExtensionsStore((state) => state.selectAndInstallArchive);
  const selectAndInstallFolder = useExtensionsStore((state) => state.selectAndInstallFolder);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className={cn("bg-card", surface === "settings" ? "rounded-xl border border-border shadow-sm" : "min-h-full")}>
      <header className={cn("flex items-start justify-between gap-4 border-b border-border py-4", surface === "settings" ? "px-5" : "px-3")}>
        <div>
          <h1 className="text-[16px] font-medium">Extensions</h1>
          <p className="mt-1 text-[14px] text-muted-foreground">
            {extensions.length === 0 ? "No local extensions installed" : `${extensions.length} local extension${extensions.length === 1 ? "" : "s"} installed`}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load()}>
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
          <Button variant="secondary" size="sm" disabled={loading} onClick={() => void selectAndInstallFolder()}>
            Install from folder
          </Button>
          <Button variant="secondary" size="sm" disabled={loading} onClick={() => void selectAndInstallArchive()}>
            Install .rdx
          </Button>
        </div>
      </header>

      {error && <div className={cn("border-b border-border py-3 text-[13px] text-destructive", surface === "settings" ? "px-5" : "px-3")}>{error}</div>}
      {lastResult && (
        <pre className={cn("max-h-48 overflow-auto border-b border-border bg-muted/50 py-3 text-[12px] text-muted-foreground", surface === "settings" ? "px-5" : "px-3")}>{lastResult}</pre>
      )}

      {extensions.length === 0 ? (
        <div className={cn("py-8 text-[14px] text-muted-foreground", surface === "settings" ? "px-5" : "px-3")}>
          Build an extension, then install its folder or packaged .rdx archive here. Local folders stay linked; archives are copied into app storage.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {extensions.map((extension) => (
            <ExtensionCard key={extension.id} extension={extension} />
          ))}
        </div>
      )}
    </section>
  );
}

function ExtensionCard({ extension }: { extension: ExtensionCatalogRecord }): React.JSX.Element {
  const disable = useExtensionsStore((state) => state.disable);
  const enable = useExtensionsStore((state) => state.enable);
  const reload = useExtensionsStore((state) => state.reload);
  const uninstall = useExtensionsStore((state) => state.uninstall);
  const activate = useExtensionsStore((state) => state.activate);
  const executeCommand = useExtensionsStore((state) => state.executeCommand);
  const executeTool = useExtensionsStore((state) => state.executeTool);
  const updatePreference = useExtensionsStore((state) => state.updatePreference);
  const readLogs = useExtensionsStore((state) => state.readLogs);
  const logs = useExtensionsStore((state) => state.logsByExtension[extension.id] ?? extension.logs);
  const [logsOpen, setLogsOpen] = useState(false);
  const capabilitySummary = useMemo(() => {
    if (extension.capabilities.length === 0) {
      return "No capabilities requested";
    }
    return extension.capabilities.map((grant) => `${grant.capability}: ${grant.status}`).join(", ");
  }, [extension.capabilities]);

  async function openLogs(): Promise<void> {
    await readLogs(extension.id);
    setLogsOpen((open) => !open);
  }

  return (
    <article className={cn("px-5 py-4", !extension.enabled && "opacity-70")}>
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-[15px] font-medium">{extension.manifest.displayName}</h2>
            <Badge variant={extension.enabled ? "secondary" : "muted"}>{extension.enabled ? "Enabled" : "Disabled"}</Badge>
            <Badge variant={extension.activationState === "failed" ? "outline" : "muted"}>{extension.activationState}</Badge>
          </div>
          <p className="mt-1 max-w-[620px] text-[13px] text-muted-foreground">{extension.manifest.description}</p>
          <p className="mt-2 truncate text-[12px] text-muted-foreground">
            {extension.source.type === "archive" ? `Packaged archive: ${extension.source.archivePath ?? extension.source.path}` : extension.source.path}
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">{capabilitySummary}</p>
          {extension.lastError && <p className="mt-2 text-[13px] text-destructive">{extension.lastError}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {extension.enabled ? (
            <Button variant="outline" size="sm" onClick={() => void disable(extension.id)}>
              Disable
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => void enable(extension.id)}>
              Enable
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={!extension.enabled} onClick={() => void activate(extension.id)}>
            <Play className="size-3.5" />
            Activate
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void reload(extension.id)}>
            <RotateCcw className="size-3.5" />
            Reload
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void uninstall(extension.id)}>
            <Trash2 className="size-3.5" />
            Remove
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ContributionList
          title="Commands"
          empty="No commands"
          items={extension.manifest.contributes.commands.map((command) => ({
            id: command.id,
            label: command.title,
            actionLabel: "Run",
            onAction: () => void executeCommand(command.id),
          }))}
        />
        <ContributionList
          title="Tools"
          empty="No tools"
          items={extension.manifest.contributes.tools.map((tool) => ({
            id: tool.id,
            label: tool.title,
            description: tool.description,
            actionLabel: "Call",
            onAction: () => void executeTool(tool.id),
          }))}
        />
      </div>

      {extension.manifest.contributes.configuration.length > 0 && (
        <div className="mt-4 rounded-lg border border-border">
          <div className="border-b border-border px-3 py-2 text-[13px] font-medium text-muted-foreground">Preferences</div>
          <div className="divide-y divide-border">
            {extension.manifest.contributes.configuration.map((preference) => (
              <label key={preference.key} className="flex items-center justify-between gap-4 px-3 py-2 text-[13px]">
                <span className="min-w-0">
                  <span className="block text-foreground">{preference.title}</span>
                  {preference.description && <span className="block text-[12px] text-muted-foreground">{preference.description}</span>}
                </span>
                {preference.type === "checkbox" ? (
                  <input
                    type="checkbox"
                    checked={Boolean(extension.preferences[preference.key])}
                    onChange={(event) => void updatePreference(extension.id, preference.key, event.currentTarget.checked)}
                  />
                ) : (
                  <input
                    className="h-8 w-64 rounded-lg border border-border bg-muted px-3 text-[13px] text-foreground outline-none"
                    value={String(extension.preferences[preference.key] ?? "")}
                    onChange={(event) => void updatePreference(extension.id, preference.key, event.currentTarget.value)}
                  />
                )}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4">
        <Button variant="ghost" size="sm" onClick={() => void openLogs()}>
          {logsOpen ? "Hide logs" : "Show logs"}
        </Button>
        {logsOpen && (
          <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-muted px-3 py-2 text-[12px] text-muted-foreground">
            {logs.length > 0 ? logs.join("\n") : "No logs yet."}
          </pre>
        )}
      </div>
    </article>
  );
}

function ContributionList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: Array<{ id: string; label: string; description?: string; actionLabel: string; onAction: () => void }>;
}): React.JSX.Element {
  return (
    <section className="rounded-lg border border-border">
      <div className="border-b border-border px-3 py-2 text-[13px] font-medium text-muted-foreground">{title}</div>
      {items.length === 0 ? (
        <div className="px-3 py-3 text-[13px] text-muted-foreground">{empty}</div>
      ) : (
        <div className="divide-y divide-border">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-[13px] text-foreground">{item.label}</div>
                <div className="truncate text-[12px] text-muted-foreground">{item.description ?? item.id}</div>
              </div>
              <Button variant="ghost" size="sm" onClick={item.onAction}>
                {item.actionLabel}
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

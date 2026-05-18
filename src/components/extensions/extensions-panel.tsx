import { Box, CircleAlert, MoreHorizontal, PanelRight, Play, Puzzle, RefreshCw, Settings, TerminalSquare, Trash2, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ExtensionWebviewPanel } from "@/components/extensions/extension-webview-panel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useExtensionsStore } from "@/stores/extensions-store";
import { useThemeStore } from "@/stores/theme-store";
import type { ExtensionCatalogRecord } from "@/types/extensions";
import { cn } from "@/lib/utils";

type ExtensionsPanelProps = {
  selectedExtensionId?: string | null;
  onSelectedExtensionChange?: (extensionId: string) => void;
};

export function ExtensionsPanel({ selectedExtensionId, onSelectedExtensionChange }: ExtensionsPanelProps): React.JSX.Element {
  const extensions = useExtensionsStore((state) => state.extensions);
  const loading = useExtensionsStore((state) => state.loading);
  const error = useExtensionsStore((state) => state.error);
  const load = useExtensionsStore((state) => state.load);
  const selectAndInstallFolder = useExtensionsStore((state) => state.selectAndInstallFolder);
  const selectAndInstallArchive = useExtensionsStore((state) => state.selectAndInstallArchive);
  const enable = useExtensionsStore((state) => state.enable);
  const disable = useExtensionsStore((state) => state.disable);
  const reload = useExtensionsStore((state) => state.reload);
  const uninstall = useExtensionsStore((state) => state.uninstall);
  const activate = useExtensionsStore((state) => state.activate);
  const executeCommand = useExtensionsStore((state) => state.executeCommand);
  const executeTool = useExtensionsStore((state) => state.executeTool);
  const openSettings = useThemeStore((state) => state.openSettings);
  const selectedExtension = extensions.find((extension) => extension.id === selectedExtensionId) ?? extensions[0];
  const panels = useMemo(
    () => selectedExtension?.manifest.contributes.views.panels.filter((panel) => panel.html) ?? [],
    [selectedExtension],
  );
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const selectedPanel = panels.find((panel) => panel.id === selectedPanelId) ?? panels[0];

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (selectedExtension && selectedExtension.id !== selectedExtensionId) {
      onSelectedExtensionChange?.(selectedExtension.id);
    }
  }, [onSelectedExtensionChange, selectedExtension, selectedExtensionId]);

  useEffect(() => {
    setSelectedPanelId((currentPanelId) => {
      if (currentPanelId && panels.some((panel) => panel.id === currentPanelId)) {
        return currentPanelId;
      }
      return panels[0]?.id ?? null;
    });
  }, [panels]);

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 text-[13px] font-medium text-foreground">
        <Puzzle className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">Extension Sidebar</span>
        <span className="rounded-full bg-sidebar-accent px-1.5 py-0.5 text-[11px] font-normal text-sidebar-muted">{extensions.length}</span>
      </div>
      {error && (
        <div className="border-b border-border px-3 py-2">
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[12px] text-destructive">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{error}</span>
          </div>
        </div>
      )}
      {selectedExtension ? (
        <>
          <ExtensionHeader
            extension={selectedExtension}
            loading={loading}
            onEnable={() => void enable(selectedExtension.id)}
            onDisable={() => void disable(selectedExtension.id)}
            onActivate={() => void activate(selectedExtension.id)}
            onReload={() => void reload(selectedExtension.id)}
            onRemove={() => void uninstall(selectedExtension.id)}
            onRefresh={() => void load()}
            onSettings={() => openSettings("extensions")}
          />
          {panels.length > 0 && (
            <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
              {panels.map((panel) => (
                <button
                  key={panel.id}
                  type="button"
                  className={cn(
                    "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring",
                    selectedPanel?.id === panel.id && "bg-sidebar-active text-sidebar-active-foreground",
                  )}
                  onClick={() => setSelectedPanelId(panel.id)}
                >
                  <PanelRight className="size-3.5" />
                  <span>{panel.title}</span>
                </button>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto sidebar-scroll bg-background">
            {selectedPanel ? (
              <ExtensionWebviewPanel extensionId={selectedExtension.id} panelId={selectedPanel.id} title={selectedPanel.title} />
            ) : (
              <ExtensionSummary extension={selectedExtension} onCommand={executeCommand} onTool={executeTool} />
            )}
          </div>
        </>
      ) : (
        <EmptyExtensions
          loading={loading}
          onRefresh={() => void load()}
          onInstallFolder={() => void selectAndInstallFolder()}
          onInstallArchive={() => void selectAndInstallArchive()}
          onSettings={() => openSettings("extensions")}
        />
      )}
    </div>
  );
}

function ExtensionHeader({
  extension,
  loading,
  onEnable,
  onDisable,
  onActivate,
  onReload,
  onRemove,
  onRefresh,
  onSettings,
}: {
  extension: ExtensionCatalogRecord;
  loading: boolean;
  onEnable: () => void;
  onDisable: () => void;
  onActivate: () => void;
  onReload: () => void;
  onRemove: () => void;
  onRefresh: () => void;
  onSettings: () => void;
}): React.JSX.Element {
  return (
    <header className="shrink-0 border-b border-border px-3 py-2">
      <div className="flex items-start gap-2">
        <ExtensionIdentity extension={extension} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{extension.manifest.displayName}</h2>
            <StatusDot extension={extension} />
          </div>
          <p className="truncate text-[11px] text-muted-foreground">{extension.manifest.publisher} · {extension.manifest.version}</p>
        </div>
        <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground" aria-label="Refresh extensions" disabled={loading} onClick={onRefresh}>
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </Button>
        <ExtensionActions extension={extension} onEnable={onEnable} onDisable={onDisable} onActivate={onActivate} onReload={onReload} onRemove={onRemove} onSettings={onSettings} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <TinyPill>{extension.enabled ? "Enabled" : "Disabled"}</TinyPill>
        <TinyPill>{extension.activationState}</TinyPill>
        <TinyPill>{extension.manifest.contributes.views.panels.filter((panel) => panel.html).length} panels</TinyPill>
      </div>
      {extension.lastError && <p className="mt-2 text-[12px] text-destructive">{extension.lastError}</p>}
    </header>
  );
}

function ExtensionActions({
  extension,
  onEnable,
  onDisable,
  onActivate,
  onReload,
  onRemove,
  onSettings,
}: {
  extension: ExtensionCatalogRecord;
  onEnable: () => void;
  onDisable: () => void;
  onActivate: () => void;
  onReload: () => void;
  onRemove: () => void;
  onSettings: () => void;
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100" aria-label={`${extension.manifest.displayName} actions`}>
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom">
        <DropdownMenuGroup>
          {extension.enabled ? (
            <DropdownMenuItem onSelect={onDisable}>Disable</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={onEnable}>Enable</DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onActivate}>
            <Play className="size-3.5" />
            Activate
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onReload}>
            <RefreshCw className="size-3.5" />
            Reload
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onSettings}>
            <Settings className="size-3.5" />
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem className="text-destructive" onSelect={onRemove}>
            <Trash2 className="size-3.5" />
            Remove
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ExtensionSummary({
  extension,
  onCommand,
  onTool,
}: {
  extension: ExtensionCatalogRecord;
  onCommand: (commandId: string) => Promise<void>;
  onTool: (toolId: string) => Promise<void>;
}): React.JSX.Element {
  return (
    <div className="space-y-3 px-3 py-3 text-[12px] text-muted-foreground">
      <section className="rounded-lg border border-border bg-card px-3 py-2">
        <div className="mb-1 flex items-center gap-2 text-[12px] font-medium text-foreground">
          <Box className="size-3.5" />
          Summary
        </div>
        <p className="leading-5">{extension.manifest.description || "No description provided."}</p>
        <p className="mt-2 truncate text-[11px]">{extension.source.type === "archive" ? `Archive: ${extension.source.archivePath ?? extension.source.path}` : extension.source.path}</p>
      </section>
      <ContributionShortcuts extension={extension} onCommand={onCommand} onTool={onTool} />
      {extension.capabilities.length > 0 && (
        <section className="rounded-lg border border-border bg-card px-3 py-2">
          <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-foreground">
            <Wrench className="size-3.5" />
            Capabilities
          </div>
          <div className="space-y-1">
            {extension.capabilities.map((grant) => (
              <div key={grant.capability} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{grant.capability}</span>
                <TinyPill>{grant.status}</TinyPill>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ContributionShortcuts({
  extension,
  onCommand,
  onTool,
}: {
  extension: ExtensionCatalogRecord;
  onCommand: (commandId: string) => Promise<void>;
  onTool: (toolId: string) => Promise<void>;
}): React.JSX.Element | null {
  const command = extension.manifest.contributes.commands[0];
  const tool = extension.manifest.contributes.tools[0];
  if (!command && !tool) {
    return null;
  }
  return (
    <section className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-foreground">
        <TerminalSquare className="size-3.5" />
        Quick Actions
      </div>
      <div className="flex flex-wrap gap-1.5">
      {command && (
        <button type="button" className="h-6 rounded-md bg-sidebar-accent px-2 text-[11px] text-sidebar-foreground hover:bg-accent" onClick={() => void onCommand(command.id)}>
          Run {command.title}
        </button>
      )}
      {tool && (
        <button type="button" className="h-6 rounded-md bg-sidebar-accent px-2 text-[11px] text-sidebar-foreground hover:bg-accent" onClick={() => void onTool(tool.id)}>
          Call {tool.title}
        </button>
      )}
      </div>
    </section>
  );
}

function ExtensionIdentity({ extension, className }: { extension: ExtensionCatalogRecord; className?: string }): React.JSX.Element {
  return (
    <span
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-md border border-border bg-card text-[12px] font-semibold uppercase text-foreground shadow-sm",
        className,
      )}
      title={extension.manifest.displayName}
      aria-hidden="true"
    >
      {extensionInitial(extension)}
    </span>
  );
}

function StatusDot({ extension }: { extension: ExtensionCatalogRecord }): React.JSX.Element {
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        !extension.enabled ? "bg-muted-foreground/35" : extension.activationState === "failed" ? "bg-destructive" : extension.activationState === "active" ? "bg-primary" : "bg-muted-foreground/60",
      )}
      title={`${extension.enabled ? "Enabled" : "Disabled"} · ${extension.activationState}`}
      aria-label={`${extension.enabled ? "Enabled" : "Disabled"} · ${extension.activationState}`}
    />
  );
}

function TinyPill({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="rounded-md bg-sidebar-accent px-1.5 py-0.5 text-[11px] text-sidebar-muted">{children}</span>;
}

function EmptyExtensions({
  loading,
  onRefresh,
  onInstallFolder,
  onInstallArchive,
  onSettings,
}: {
  loading: boolean;
  onRefresh: () => void;
  onInstallFolder: () => void;
  onInstallArchive: () => void;
  onSettings: () => void;
}): React.JSX.Element {
  return (
    <div className="space-y-3 px-3 py-4 text-[13px] text-muted-foreground">
      <p>Install a local extension to add an icon to the right rail.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={onInstallFolder}>Folder</Button>
        <Button variant="secondary" size="sm" onClick={onInstallArchive}>.rdx</Button>
        <Button variant="ghost" size="sm" disabled={loading} onClick={onRefresh}>
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
        <Button variant="ghost" size="sm" onClick={onSettings}>Settings</Button>
      </div>
    </div>
  );
}

function extensionInitial(extension: ExtensionCatalogRecord): string {
  const source = extension.manifest.displayName || extension.manifest.name || extension.id;
  return source.trim().slice(0, 1) || "E";
}


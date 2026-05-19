import { CircleAlert, PanelRight, Puzzle, RefreshCw, TerminalSquare } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ExtensionWebviewPanel } from "@/components/extensions/extension-webview-panel";
import { Button } from "@/components/ui/button";
import { getSidebarExtensions } from "@/lib/extension-sidebar";
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
  const executeCommand = useExtensionsStore((state) => state.executeCommand);
  const executeTool = useExtensionsStore((state) => state.executeTool);
  const openSettings = useThemeStore((state) => state.openSettings);
  const sidebarExtensions = useMemo(() => getSidebarExtensions(extensions), [extensions]);
  const selectedExtension = sidebarExtensions.find((extension) => extension.id === selectedExtensionId) ?? sidebarExtensions[0];
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
        <span className="rounded-full bg-sidebar-accent px-1.5 py-0.5 text-[11px] font-normal text-sidebar-muted">{sidebarExtensions.length}</span>
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
          {panels.length > 1 && (
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
              <ContributionShortcuts extension={selectedExtension} onCommand={executeCommand} onTool={executeTool} />
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
    return (
      <div className="px-3 py-4 text-[13px] text-muted-foreground">
        This extension has no sidebar panel. Manage it from Settings.
      </div>
    );
  }
  return (
    <section className="px-3 py-3 text-[12px] text-muted-foreground">
      <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
        <TerminalSquare className="size-3.5 text-muted-foreground" />
        Actions
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
      <p>Extensions with panels, commands, or tools appear here. Manage installed extensions and themes in Settings.</p>
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


import { ChevronDown, ChevronRight, CircleAlert, MoreHorizontal, PanelRight, Play, Puzzle, RefreshCw, Search, Settings, Trash2 } from "lucide-react";
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

export function ExtensionsPanel(): React.JSX.Element {
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
  const [query, setQuery] = useState("");
  const [sectionsOpen, setSectionsOpen] = useState({ panels: true, installed: true });
  const [expandedExtensions, setExpandedExtensions] = useState<Record<string, boolean>>({});
  const panels = useMemo(
    () =>
      extensions.flatMap((extension) =>
        extension.manifest.contributes.views.panels
          .filter((panel) => panel.html)
          .map((panel) => ({
            extension,
            panel,
          })),
      ),
    [extensions],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const filteredPanels = useMemo(
    () =>
      panels.filter(({ extension, panel }) =>
        includesQuery(
          normalizedQuery,
          panel.title,
          panel.id,
          extension.manifest.displayName,
          extension.manifest.name,
          extension.manifest.publisher,
        ),
      ),
    [normalizedQuery, panels],
  );
  const filteredExtensions = useMemo(
    () =>
      extensions.filter((extension) =>
        includesQuery(
          normalizedQuery,
          extension.manifest.displayName,
          extension.manifest.name,
          extension.manifest.description,
          extension.manifest.publisher,
          extension.manifest.contributes.views.panels.map((panel) => panel.title).join(" "),
          extension.manifest.contributes.commands.map((command) => command.title).join(" "),
          extension.manifest.contributes.tools.map((tool) => tool.title).join(" "),
        ),
      ),
    [extensions, normalizedQuery],
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = panels.find(({ extension, panel }) => panelKey(extension.id, panel.id) === selectedKey) ?? panels[0];

  useEffect(() => {
    void load();
  }, [load]);

  function toggleSection(section: "panels" | "installed"): void {
    setSectionsOpen((open) => ({ ...open, [section]: !open[section] }));
  }

  function toggleExtension(extensionId: string): void {
    setExpandedExtensions((open) => ({ ...open, [extensionId]: !extensionOpen(open, extensionId) }));
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 text-[13px] font-medium text-foreground">
        <Puzzle className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">Extensions</span>
        <span className="rounded-full bg-sidebar-accent px-1.5 py-0.5 text-[11px] font-normal text-sidebar-muted">{extensions.length}</span>
      </div>
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-background/65 px-2 text-muted-foreground focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
            <Search className="size-3.5 shrink-0" />
            <input
              value={query}
              placeholder="Search installed extensions"
              className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" aria-label="Refresh extensions" disabled={loading} onClick={() => void load()}>
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring" aria-label="Extension actions">
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom">
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => void selectAndInstallFolder()}>Install from folder</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void selectAndInstallArchive()}>Install .rdx</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openSettings("extensions")}>
                  <Settings className="size-3.5" />
                  Open settings
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {error && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[12px] text-destructive">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{error}</span>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto sidebar-scroll">
        <CompactSection title="Contributed Panels" count={filteredPanels.length} open={sectionsOpen.panels} onToggle={() => toggleSection("panels")}>
          {filteredPanels.length === 0 ? (
            <EmptyRow>{panels.length === 0 ? "No extension panels installed" : "No panels match your search"}</EmptyRow>
          ) : (
            <div className="py-1">
              {filteredPanels.map(({ extension, panel }) => {
                const key = panelKey(extension.id, panel.id);
                const active = selected && panelKey(selected.extension.id, selected.panel.id) === key;
                return (
                  <button
                    key={key}
                    type="button"
                    className={cn(
                      "flex h-9 w-full items-center gap-2 px-3 text-left text-[13px] outline-none hover:bg-sidebar-accent focus-visible:bg-sidebar-accent",
                      active && "bg-sidebar-active text-sidebar-active-foreground",
                    )}
                    onClick={() => setSelectedKey(key)}
                  >
                    <ExtensionIdentity extension={extension} className="size-5 text-[10px]" />
                    <PanelRight className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-foreground">{panel.title}</span>
                    <span className="max-w-24 shrink-0 truncate text-[11px] text-muted-foreground">{extension.manifest.displayName}</span>
                  </button>
                );
              })}
            </div>
          )}
        </CompactSection>

        {selected && (
          <section className="border-y border-border bg-card/45">
            <div className="flex h-9 items-center gap-2 px-3 text-[12px]">
              <ExtensionIdentity extension={selected.extension} className="size-5 text-[10px]" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-foreground">{selected.panel.title}</div>
                <div className="truncate text-[11px] text-muted-foreground">{selected.extension.manifest.displayName}</div>
              </div>
              <StatusDot extension={selected.extension} />
            </div>
            <div className="h-80 border-t border-border bg-background">
              <ExtensionWebviewPanel extensionId={selected.extension.id} panelId={selected.panel.id} title={selected.panel.title} />
            </div>
          </section>
        )}

        <CompactSection title="Installed" count={filteredExtensions.length} open={sectionsOpen.installed} onToggle={() => toggleSection("installed")}>
          {filteredExtensions.length === 0 ? (
            <EmptyRow>{extensions.length === 0 ? "Install a local folder or .rdx archive to get started" : "No extensions match your search"}</EmptyRow>
          ) : (
            <div className="divide-y divide-border">
              {filteredExtensions.map((extension) => {
                const open = extensionOpen(expandedExtensions, extension.id);
                const extensionPanels = extension.manifest.contributes.views.panels.filter((panel) => panel.html);
                return (
                  <article key={extension.id} className={cn(!extension.enabled && "opacity-65")}>
                    <div className="group flex min-h-12 items-center gap-2 px-3 py-1.5">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
                        aria-expanded={open}
                        onClick={() => toggleExtension(extension.id)}
                      >
                        {open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
                        <ExtensionIdentity extension={extension} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-foreground">{extension.manifest.displayName}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">{extension.manifest.publisher} · {extension.manifest.version}</span>
                        </span>
                        <StatusDot extension={extension} />
                      </button>
                      <ExtensionActions
                        extension={extension}
                        onEnable={() => void enable(extension.id)}
                        onDisable={() => void disable(extension.id)}
                        onActivate={() => void activate(extension.id)}
                        onReload={() => void reload(extension.id)}
                        onRemove={() => void uninstall(extension.id)}
                        onSettings={() => openSettings("extensions")}
                      />
                    </div>
                    {open && (
                      <div className="pb-2 pl-12 pr-3 text-[12px] text-muted-foreground">
                        {extension.manifest.description && <p className="line-clamp-2">{extension.manifest.description}</p>}
                        {extension.lastError && <p className="mt-1 text-destructive">{extension.lastError}</p>}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <TinyPill>{extension.enabled ? "Enabled" : "Disabled"}</TinyPill>
                          <TinyPill>{extension.activationState}</TinyPill>
                          <TinyPill>{extension.manifest.contributes.commands.length} commands</TinyPill>
                          <TinyPill>{extension.manifest.contributes.tools.length} tools</TinyPill>
                        </div>
                        {extensionPanels.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {extensionPanels.map((panel) => {
                              const key = panelKey(extension.id, panel.id);
                              const active = selected && panelKey(selected.extension.id, selected.panel.id) === key;
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  className={cn(
                                    "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] hover:bg-sidebar-accent",
                                    active && "bg-sidebar-active text-sidebar-active-foreground",
                                  )}
                                  onClick={() => setSelectedKey(key)}
                                >
                                  <PanelRight className="size-3.5 shrink-0 text-muted-foreground" />
                                  <span className="min-w-0 flex-1 truncate">{panel.title}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                        <ContributionShortcuts extension={extension} onCommand={executeCommand} onTool={executeTool} />
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </CompactSection>
      </div>
    </div>
  );
}

function CompactSection({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="border-b border-border">
      <button
        type="button"
        className="flex h-7 w-full items-center gap-1.5 px-3 text-left text-[11px] font-semibold uppercase tracking-wide text-sidebar-muted outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:bg-sidebar-accent"
        aria-expanded={open}
        onClick={onToggle}
      >
        {open ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="font-normal tabular-nums">{count}</span>
      </button>
      {open && children}
    </section>
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
    <div className="mt-2 flex flex-wrap gap-1.5">
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

function EmptyRow({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="px-3 py-3 text-[12px] text-muted-foreground">{children}</div>;
}

function extensionOpen(open: Record<string, boolean>, extensionId: string): boolean {
  return open[extensionId] ?? true;
}

function extensionInitial(extension: ExtensionCatalogRecord): string {
  const source = extension.manifest.displayName || extension.manifest.name || extension.id;
  return source.trim().slice(0, 1) || "E";
}

function includesQuery(query: string, ...parts: string[]): boolean {
  if (!query) {
    return true;
  }
  return parts.some((part) => part.toLowerCase().includes(query));
}

function panelKey(extensionId: string, panelId: string): string {
  return `${extensionId}:${panelId}`;
}

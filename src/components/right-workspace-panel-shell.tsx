import * as React from "react";
import type { CSSProperties } from "react";
import { Check, Plus, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { chromeIconButtonClassNameForState } from "@/components/ui/chrome-icon-button";
import { cn } from "@/lib/utils";
import type { RouteWorkspacePanel } from "@/lib/route-search";

export type RightWorkspacePanelEntry = {
  id: RouteWorkspacePanel;
  title: string;
  description: string;
  icon: React.ReactNode;
  shortcutLabel?: string;
};

export type NativeOverlayOcclusion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type RightWorkspacePanelShellProps = {
  open: boolean;
  tabs: RouteWorkspacePanel[];
  activePanel: RouteWorkspacePanel | null;
  entries: RightWorkspacePanelEntry[];
  width: number;
  onAddPanel: (panel: RouteWorkspacePanel) => void;
  onBeginResize: (event: React.PointerEvent<HTMLDivElement>) => void;
  onClosePanel: (panel: RouteWorkspacePanel) => void;
  onSelectPanel: (panel: RouteWorkspacePanel) => void;
  renderPanel: (
    entry: RightWorkspacePanelEntry,
    state: { active: boolean; nativeOverlayOcclusion: NativeOverlayOcclusion | null },
  ) => React.ReactNode;
};

export function RightWorkspacePanelShell({
  open,
  tabs,
  activePanel,
  entries,
  width,
  onAddPanel,
  onBeginResize,
  onClosePanel,
  onSelectPanel,
  renderPanel,
}: RightWorkspacePanelShellProps): React.JSX.Element {
  const [addMenuOpen, setAddMenuOpen] = React.useState(false);
  const [addMenuOcclusion, setAddMenuOcclusion] = React.useState<NativeOverlayOcclusion | null>(null);
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const openEntries = tabs
    .map((tab) => entriesById.get(tab))
    .filter((entry): entry is RightWorkspacePanelEntry => !!entry);
  const activeEntry = activePanel ? entriesById.get(activePanel) : null;
  const panelStyle = { "--right-workspace-panel-width": `${width}px` } as RightWorkspacePanelStyle;

  return (
    <aside
      className="right-workspace-panel relative flex h-full min-w-0 shrink-0 flex-col border-l border-border bg-white text-card-foreground"
      data-open={open ? "true" : undefined}
      style={panelStyle}
      aria-label="Workspace panel"
      aria-hidden={!open}
      inert={!open ? true : undefined}
    >
      <div
        className="no-drag absolute inset-y-0 left-0 z-30 w-2 cursor-col-resize bg-transparent hover:bg-border"
        aria-label="Resize workspace panel"
        role="separator"
        onPointerDown={onBeginResize}
      />
      <div className="flex h-[60px] shrink-0 items-center gap-1 px-2 pl-3">
        {openEntries.length > 0 ? (
          <>
            <Tabs
              value={activeEntry?.id}
              onValueChange={(value) => onSelectPanel(value as RouteWorkspacePanel)}
              className="min-w-0 shrink"
            >
              <TabsList variant="chrome" className="max-w-full overflow-x-auto" aria-label="Workspace panel tabs">
                {openEntries.map((entry) => (
                  <WorkspacePanelTab key={entry.id} entry={entry} onClosePanel={onClosePanel} />
                ))}
              </TabsList>
            </Tabs>
            <PanelAddMenu
              entries={entries}
              menuOpen={addMenuOpen}
              openPanel={activePanel}
              onAddPanel={onAddPanel}
              onMenuBoundsChange={setAddMenuOcclusion}
              onMenuOpenChange={setAddMenuOpen}
            />
            <div className="min-w-0 flex-1" />
          </>
        ) : (
          <>
            <PanelAddMenu
              entries={entries}
              menuOpen={addMenuOpen}
              openPanel={activePanel}
              onAddPanel={onAddPanel}
              onMenuBoundsChange={setAddMenuOcclusion}
              onMenuOpenChange={setAddMenuOpen}
            />
            <div className="min-w-0 flex-1" />
          </>
        )}
      </div>
      {openEntries.length > 0 && activeEntry ? (
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <Tabs value={activeEntry.id} className="contents">
            {openEntries.map((entry) => {
              const inactive = entry.id !== activeEntry.id;
              return (
                <TabsContent
                  key={entry.id}
                  keepMounted
                  value={entry.id}
                  aria-label={entry.title}
                  inert={inactive ? true : undefined}
                  className={cn("absolute inset-0 h-full min-h-0 text-base", inactive && "pointer-events-none opacity-0")}
                >
                  {renderPanel(entry, {
                    active: open && !inactive,
                    nativeOverlayOcclusion: open && !inactive ? addMenuOcclusion : null,
                  })}
                </TabsContent>
              );
            })}
          </Tabs>
        </div>
      ) : (
        <WorkspacePanelEmptyState entries={entries} onAddPanel={onAddPanel} />
      )}
    </aside>
  );
}

type RightWorkspacePanelStyle = CSSProperties & {
  "--right-workspace-panel-width": string;
};

function WorkspacePanelTab({
  entry,
  onClosePanel,
}: {
  entry: RightWorkspacePanelEntry;
  onClosePanel: (panel: RouteWorkspacePanel) => void;
}): React.JSX.Element {
  return (
    <div className="group flex h-8 min-w-0 max-w-40 items-center gap-1 rounded-full text-muted-foreground transition-colors">
      <TabsTrigger value={entry.id} aria-label={entry.title} className="min-w-0 flex-1 pl-2.5 pr-1">
        <span className="shrink-0 [&_svg]:size-4">{entry.icon}</span>
        <span className="truncate text-base font-medium">{entry.title}</span>
      </TabsTrigger>
      <button
        type="button"
        className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-background/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Close ${entry.title}`}
        onClick={(event) => {
          event.stopPropagation();
          onClosePanel(entry.id);
        }}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function PanelAddMenu({
  entries,
  menuOpen,
  openPanel,
  onAddPanel,
  onMenuBoundsChange,
  onMenuOpenChange,
}: {
  entries: RightWorkspacePanelEntry[];
  menuOpen: boolean;
  openPanel: RouteWorkspacePanel | null;
  onAddPanel: (panel: RouteWorkspacePanel) => void;
  onMenuBoundsChange: (bounds: NativeOverlayOcclusion | null) => void;
  onMenuOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const contentRef = React.useRef<HTMLDivElement | null>(null);

  React.useLayoutEffect(() => {
    if (!menuOpen) {
      onMenuBoundsChange(null);
      return;
    }

    function syncBounds(): void {
      const element = contentRef.current;
      if (!element) {
        onMenuBoundsChange(null);
        return;
      }
      const rect = element.getBoundingClientRect();
      onMenuBoundsChange({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
    }

    const animationFrame = requestAnimationFrame(syncBounds);
    const resizeObserver = new ResizeObserver(syncBounds);
    if (contentRef.current) {
      resizeObserver.observe(contentRef.current);
    }
    window.addEventListener("resize", syncBounds);
    window.addEventListener("scroll", syncBounds, true);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncBounds);
      window.removeEventListener("scroll", syncBounds, true);
    };
  }, [menuOpen, onMenuBoundsChange]);

  return (
    <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
      <DropdownMenuTrigger
        className={chromeIconButtonClassNameForState(false, "inline-flex items-center justify-center")}
        aria-label="Add workspace panel"
        title="Add panel"
      >
        <Plus />
      </DropdownMenuTrigger>
      <DropdownMenuContent ref={contentRef} align="end" side="bottom" sideOffset={8} className="w-80 p-1.5">
        <DropdownMenuGroup>
          {entries.map((entry) => (
            <DropdownMenuItem
              key={entry.id}
              selected={entry.id === openPanel}
              className="min-h-12 items-start rounded-lg px-2 py-2"
              onSelect={() => onAddPanel(entry.id)}
            >
              <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-4">{entry.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium text-foreground">{entry.title}</span>
                  {entry.shortcutLabel && (
                    <kbd className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-sm font-medium text-muted-foreground">
                      {entry.shortcutLabel}
                    </kbd>
                  )}
                </span>
                <span className="block truncate text-base text-muted-foreground">{entry.description}</span>
              </span>
              {entry.id === openPanel && <Check className="mt-1 size-3.5 shrink-0 text-primary" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WorkspacePanelEmptyState({
  entries,
  onAddPanel,
}: {
  entries: RightWorkspacePanelEntry[];
  onAddPanel: (panel: RouteWorkspacePanel) => void;
}): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-3 p-4">
      <div>
        <div className="text-base font-semibold text-foreground">Workspace panels</div>
        <div className="text-base text-muted-foreground">Terminal, browser, canvas, review, and extensions.</div>
      </div>
      <div className="grid gap-1.5">
        {entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="flex min-h-14 items-center gap-3 rounded-lg px-3 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onAddPanel(entry.id)}
          >
            <span className="shrink-0 text-muted-foreground [&_svg]:size-4">{entry.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-medium text-foreground">{entry.title}</span>
              <span className="block truncate text-base text-muted-foreground">{entry.description}</span>
            </span>
            {entry.shortcutLabel && (
              <kbd className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-sm font-medium text-muted-foreground">
                {entry.shortcutLabel}
              </kbd>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

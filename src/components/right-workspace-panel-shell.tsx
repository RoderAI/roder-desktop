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
  freezeLayout?: boolean;
  layoutWidth?: number;
  onAddPanel: (panel: RouteWorkspacePanel) => void;
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
  freezeLayout = false,
  layoutWidth,
  onAddPanel,
  onClosePanel,
  onSelectPanel,
  renderPanel,
}: RightWorkspacePanelShellProps): React.JSX.Element {
  const [addMenuOpen, setAddMenuOpen] = React.useState(false);
  const [addMenuOcclusion, setAddMenuOcclusion] = React.useState<NativeOverlayOcclusion | null>(null);
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const openEntries = tabs.reduce<RightWorkspacePanelEntry[]>((openEntries, tab) => {
    const entry = entriesById.get(tab);
    if (entry) {
      openEntries.push(entry);
    }
    return openEntries;
  }, []);
  const activeEntry = activePanel ? entriesById.get(activePanel) : null;
  const frozenLayoutStyle =
    freezeLayout && layoutWidth
      ? ({
          width: `${layoutWidth}px`,
          minWidth: `${layoutWidth}px`,
        } satisfies CSSProperties)
      : undefined;

  return (
    <aside
      className="right-workspace-panel relative flex h-full w-full min-w-0 flex-col border-l border-border bg-background text-foreground"
      data-open={open ? "true" : undefined}
      data-layout-frozen={freezeLayout ? "true" : undefined}
      style={frozenLayoutStyle}
      aria-label="Workspace panel"
      aria-hidden={!open}
      inert={!open ? true : undefined}
    >
      <div className="flex h-(--desktop-header-height) shrink-0 items-center gap-1 border-b border-border px-3">
        <PanelAddMenu
          entries={entries}
          menuOpen={addMenuOpen}
          openPanel={activePanel}
          onAddPanel={onAddPanel}
          onMenuBoundsChange={setAddMenuOcclusion}
          onMenuOpenChange={setAddMenuOpen}
        />
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
            <div className="min-w-0 flex-1" />
          </>
        ) : (
          <div className="min-w-0 flex-1" />
        )}
      </div>
      {openEntries.length > 0 && activeEntry ? (
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <Tabs value={activeEntry.id} className="contents">
            {openEntries.map((entry) => {
              const inactive = entry.id !== activeEntry.id;
              return (
                <WorkspacePanelContent
                  key={entry.id}
                  active={open && !inactive}
                  entry={entry}
                  inactive={inactive}
                  nativeOverlayOcclusion={open && !inactive ? addMenuOcclusion : null}
                  renderPanel={renderPanel}
                />
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

function WorkspacePanelContent({
  active,
  entry,
  inactive,
  nativeOverlayOcclusion,
  renderPanel,
}: {
  active: boolean;
  entry: RightWorkspacePanelEntry;
  inactive: boolean;
  nativeOverlayOcclusion: NativeOverlayOcclusion | null;
  renderPanel: RightWorkspacePanelShellProps["renderPanel"];
}): React.JSX.Element {
  return (
    <TabsContent
      keepMounted
      value={entry.id}
      aria-label={entry.title}
      inert={inactive ? true : undefined}
      className={cn("absolute inset-0 h-full min-h-0 text-base", inactive && "pointer-events-none opacity-0")}
    >
      {renderPanel(entry, { active, nativeOverlayOcclusion })}
    </TabsContent>
  );
}

function WorkspacePanelTab({
  entry,
  onClosePanel,
}: {
  entry: RightWorkspacePanelEntry;
  onClosePanel: (panel: RouteWorkspacePanel) => void;
}): React.JSX.Element {
  return (
    <div className="group/tab relative flex h-7 min-w-0 max-w-36 items-center rounded-full text-muted-foreground transition-colors">
      <TabsTrigger value={entry.id} aria-label={entry.title} className="min-w-0 flex-1 pl-2 pr-2">
        <span className="relative flex size-4 shrink-0 items-center justify-center">
          <span className="flex shrink-0 transition-opacity group-hover/tab:opacity-0 group-focus-within/tab:opacity-0 [&_svg]:size-3.5">
            {entry.icon}
          </span>
        </span>
        <span className="truncate text-sm font-medium">{entry.title}</span>
      </TabsTrigger>
      <button
        type="button"
        className="pointer-events-none absolute left-1 top-1/2 z-10 flex size-5 -translate-y-1/2 items-center justify-center rounded-full bg-muted-foreground/70 text-background opacity-0 outline-none transition-colors hover:bg-muted-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/tab:pointer-events-auto group-hover/tab:opacity-100 group-focus-within/tab:pointer-events-auto group-focus-within/tab:opacity-100"
        aria-label={`Close ${entry.title}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onClosePanel(entry.id);
        }}
      >
        <X className="size-3" />
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
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4"
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
              className="min-h-12 items-start rounded-lg p-2"
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

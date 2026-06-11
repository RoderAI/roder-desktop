import { LayoutAlignLeftIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Check, ChevronDown, Folder, MessageSquare } from "lucide-react";
import type { RoderStatus, RoderThread, RoderThreadGoal } from "@/types/roder";
import { Button } from "@/components/ui/button";
import { chromeIconButtonClassNameForState } from "@/components/ui/chrome-icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { RouteWorkspacePanel } from "@/lib/route-search";
import {
  normalizeWorkspacePath,
  normalizedTimestamp,
  workspaceName,
  type FolderOption,
} from "@/lib/workspace-thread-options";

export type WorkspacePanel = RouteWorkspacePanel | null;

type WorkspacePanelToggleButtonProps = {
  open: boolean;
  className?: string;
  onToggle: () => void;
};

type TopBarProps = {
  thread?: RoderThread;
  goal?: RoderThreadGoal | null;
  threads: RoderThread[];
  folders: FolderOption[];
  activeFolderPath: string;
  status: RoderStatus;
  workspacePanelOpen: boolean;
  workspacePanelToggleVisible?: boolean;
  extensionSidebarVisible?: boolean;
  sidebarOpen: boolean;
  placement: "content" | "window";
  onNewProject: () => void;
  onNewThread: () => void;
  onOpenSettings: () => void;
  onRestart: () => void;
  onToggleSidebar: () => void;
  onSelectFolder: (path: string) => void;
  onSelectThread: (threadId: string) => void;
  onToggleWorkspacePanelShell: () => void;
};

export function TopBar({
  thread,
  goal,
  threads,
  folders,
  activeFolderPath,
  status,
  workspacePanelOpen,
  workspacePanelToggleVisible = true,
  extensionSidebarVisible = false,
  sidebarOpen,
  placement,
  onNewProject,
  onNewThread,
  onOpenSettings,
  onRestart,
  onToggleSidebar,
  onSelectFolder,
  onSelectThread,
  onToggleWorkspacePanelShell,
}: TopBarProps): React.JSX.Element {
  const activeFolder = folders.find(
    (folder) => normalizeWorkspacePath(folder.path) === normalizeWorkspacePath(activeFolderPath),
  );
  const activeFolderLabel = activeFolder?.name ?? workspaceName(activeFolderPath);
  const isWindowTopBar = placement === "window";
  const goalLabel = goal?.objective.trim() ?? "";
  const viewMenuItems: WindowMenuItem[] = [
    { label: sidebarOpen ? "Hide sidebar" : "Show sidebar", onSelect: onToggleSidebar },
  ];
  if (workspacePanelToggleVisible) {
    viewMenuItems.push({
      label: workspacePanelOpen ? "Hide workspace panel" : "Show workspace panel",
      onSelect: onToggleWorkspacePanelShell,
    });
  }

  if (isWindowTopBar) {
    return (
      <header className="drag-region grid h-12 shrink-0 select-none grid-cols-3 items-center gap-3 border-b border-border/70 bg-background/95 pl-2 pr-44 text-muted-foreground">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className={cn(chromeIconButtonClassNameForState(false), "size-7 rounded-full [&_svg]:size-4")}
            aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            onClick={onToggleSidebar}
          >
            <HugeiconsIcon icon={LayoutAlignLeftIcon} strokeWidth={1.7} />
          </Button>
          <nav className="no-drag flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
            <WindowMenuButton
              label="File"
              items={[
                { label: "New project", onSelect: onNewProject },
                { label: "New thread", onSelect: onNewThread },
                { label: "Settings", onSelect: onOpenSettings },
              ]}
            />
            <WindowMenuButton label="Edit" items={[{ label: "No edit actions available", disabled: true }]} />
            <WindowMenuButton label="View" items={viewMenuItems} />
            <WindowMenuButton
              label="Window"
              items={[{ label: "Window controls use the system buttons", disabled: true }]}
            />
            <WindowMenuButton label="Help" items={[{ label: "Settings", onSelect: onOpenSettings }]} />
          </nav>
        </div>
        <h1
          className="drag-region flex min-w-0 items-center justify-center gap-1.5 text-sm"
          title={`${activeFolderPath} / ${threadTitle(thread)}`}
        >
          <span className="min-w-0 truncate font-medium text-muted-foreground">{activeFolderLabel}</span>
          <span className="shrink-0 text-muted-foreground/55" aria-hidden="true">
            /
          </span>
          <span className="min-w-0 truncate font-semibold text-foreground">{threadTitle(thread)}</span>
        </h1>
        <div className="flex min-w-0 items-center justify-end gap-2">
          {status.state === "error" && (
            <Button variant="outline" size="sm" onClick={onRestart}>
              Restart
            </Button>
          )}
          {workspacePanelToggleVisible && (
            <WorkspacePanelToggleButton
              open={workspacePanelOpen}
              className={cn("size-7 rounded-full [&_svg]:size-4", extensionSidebarVisible && "mr-12")}
              onToggle={onToggleWorkspacePanelShell}
            />
          )}
        </div>
      </header>
    );
  }

  return (
    <header
      className={cn(
        "drag-region flex min-w-0 shrink-0 items-center overflow-hidden border-b text-muted-foreground",
        "h-(--desktop-header-height) border-border pr-12",
        sidebarOpen ? "pl-5" : "pl-0",
      )}
    >
      {!sidebarOpen && <div className="shrink-0 basis-[148px]" aria-hidden="true" />}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          chromeIconButtonClassNameForState(false),
          "fixed left-20 top-[11px] z-40 size-7 translate-x-2 rounded-full [&_svg]:size-4",
        )}
        aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        onClick={onToggleSidebar}
      >
        <HugeiconsIcon icon={LayoutAlignLeftIcon} strokeWidth={1.7} />
      </Button>
      <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
        {sidebarOpen ? (
          <h1 className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden text-base">
            <span className="max-w-48 shrink-0 truncate font-normal text-muted-foreground">{activeFolderLabel}</span>
            <span className="shrink-0 text-muted-foreground/60" aria-hidden="true">
              /
            </span>
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
              <span
                className={cn(
                  "thread-title-breadcrumb min-w-0 truncate font-semibold text-foreground",
                  goalLabel ? "shrink" : "flex-1",
                )}
              >
                {threadTitle(thread)}
              </span>
              <GoalBreadcrumb goal={goal} constrain />
            </span>
          </h1>
        ) : (
          <CollapsedBreadcrumb
            thread={thread}
            goal={goal}
            threads={threads}
            folders={folders}
            activeFolder={activeFolder}
            activeFolderPath={activeFolderPath}
            onSelectFolder={onSelectFolder}
            onSelectThread={onSelectThread}
          />
        )}
      </div>
      <div className="no-drag ml-auto flex items-center gap-2">
        {status.state === "error" && (
          <Button variant="outline" size="sm" onClick={onRestart}>
            Restart
          </Button>
        )}
        {workspacePanelToggleVisible && (
          <WorkspacePanelToggleButton
            open={workspacePanelOpen}
            className="fixed right-2 top-[11px] z-[100] size-7 rounded-full pointer-events-auto [&_svg]:size-4"
            onToggle={onToggleWorkspacePanelShell}
          />
        )}
      </div>
    </header>
  );
}

export function WorkspacePanelToggleButton({
  open,
  className,
  onToggle,
}: WorkspacePanelToggleButtonProps): React.JSX.Element {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(chromeIconButtonClassNameForState(open), className)}
      aria-label={open ? "Hide workspace panel" : "Show workspace panel"}
      title={open ? "Hide workspace panel" : "Show workspace panel"}
      onClick={onToggle}
    >
      <HugeiconsIcon icon={LayoutAlignLeftIcon} className="rotate-180" strokeWidth={1.7} />
    </Button>
  );
}

type WindowMenuItem = {
  label: string;
  disabled?: boolean;
  onSelect?: () => void;
};

function WindowMenuButton({ label, items }: { label: string; items: WindowMenuItem[] }): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="no-drag rounded-md px-2 py-1 outline-none hover:bg-accent hover:text-foreground data-[popup-open]:bg-accent data-[popup-open]:text-foreground">
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" sideOffset={4} className="w-56 rounded-lg p-1">
        <DropdownMenuGroup>
          {items.map((item) => (
            <DropdownMenuItem
              key={item.label}
              disabled={item.disabled}
              className="h-8 rounded-md text-sm disabled:opacity-50"
              onSelect={() => item.onSelect?.()}
            >
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CollapsedBreadcrumb({
  thread,
  goal,
  threads,
  folders,
  activeFolder,
  activeFolderPath,
  onSelectFolder,
  onSelectThread,
}: {
  thread?: RoderThread;
  goal?: RoderThreadGoal | null;
  threads: RoderThread[];
  folders: FolderOption[];
  activeFolder?: FolderOption;
  activeFolderPath: string;
  onSelectFolder: (path: string) => void;
  onSelectThread: (threadId: string) => void;
}): React.JSX.Element {
  const activeFolderLabel = activeFolder?.name ?? workspaceName(activeFolderPath);
  const activeFolderKey = normalizeWorkspacePath(activeFolder?.path ?? activeFolderPath);
  return (
    <div className="no-drag flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden rounded-full bg-card/70 p-1 text-base shadow-sm ring-1 ring-border/70">
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-7 min-w-0 max-w-[220px] shrink items-center gap-2 rounded-full px-2.5 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground data-[popup-open]:bg-accent"
          aria-label={`Choose folder: ${activeFolderLabel}`}
          title={activeFolder?.path ?? activeFolderPath}
        >
          <Folder className="size-3.5 shrink-0" />
          <span className="truncate text-foreground">{activeFolderLabel}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" sideOffset={8} className="w-[340px] rounded-xl p-1.5">
          <DropdownMenuGroup className="max-h-[300px] overflow-y-auto">
            <div className="px-2 pb-1 pt-1 text-base font-medium text-muted-foreground">Folders</div>
            {folders.length > 0 ? (
              folders.map((folder) => {
                const selected = normalizeWorkspacePath(folder.path) === activeFolderKey;
                return (
                  <DropdownMenuItem
                    key={folder.path}
                    selected={selected}
                    className="h-10 rounded-lg px-2 text-base"
                    onSelect={() => onSelectFolder(folder.path)}
                  >
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-foreground">{folder.name}</span>
                    <span className="shrink-0 text-base text-muted-foreground">{folder.threadCount} threads</span>
                    {selected && <Check className="size-3.5 shrink-0 text-primary" />}
                  </DropdownMenuItem>
                );
              })
            ) : (
              <div className="px-2 py-4 text-base text-muted-foreground">No folders yet</div>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="select-none text-muted-foreground/60">/</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-7 min-w-0 max-w-[280px] shrink items-center gap-2 rounded-full px-2.5 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground data-[popup-open]:bg-accent"
          aria-label={`Choose thread: ${threadTitle(thread)}`}
          title={threadTitle(thread)}
        >
          <MessageSquare className="size-3.5 shrink-0" />
          <span className="truncate text-foreground">{threadTitle(thread)}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" sideOffset={8} className="w-[380px] rounded-xl p-1.5">
          <DropdownMenuGroup className="max-h-[320px] overflow-y-auto">
            <div className="px-2 pb-1 pt-1 text-base font-medium text-muted-foreground">
              Threads in {activeFolderLabel}
            </div>
            {threads.length > 0 ? (
              threads.map((item) => {
                const selected = item.id === thread?.id;
                return (
                  <DropdownMenuItem
                    key={item.id}
                    selected={selected}
                    className="h-10 rounded-lg px-2 text-base"
                    onSelect={() => onSelectThread(item.id)}
                  >
                    <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-foreground">{threadTitle(item)}</span>
                    <span className="shrink-0 text-base text-muted-foreground">{relativeAge(item.updatedAt)}</span>
                    {selected && <Check className="size-3.5 shrink-0 text-primary" />}
                  </DropdownMenuItem>
                );
              })
            ) : (
              <div className="px-2 py-4 text-base text-muted-foreground">No threads in this folder yet</div>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <GoalBreadcrumb goal={goal} constrain />
    </div>
  );
}

function GoalBreadcrumb({
  constrain = false,
  goal,
}: {
  constrain?: boolean;
  goal?: RoderThreadGoal | null;
}): React.JSX.Element | null {
  if (!goal) {
    return null;
  }
  const label = goal.objective.trim();
  if (!label) {
    return null;
  }

  return (
    <>
      <span className="shrink-0 text-muted-foreground/60" aria-hidden="true">
        /
      </span>
      <span
        aria-label={`Goal: ${label}`}
        className={cn(
          "goal-breadcrumb-indicator font-normal text-muted-foreground",
          constrain ? "min-w-0 basis-1/3 shrink truncate" : "shrink-0 whitespace-nowrap",
        )}
        title={label}
      >
        {label}
      </span>
    </>
  );
}

function threadTitle(thread: RoderThread | undefined): string {
  if (!thread) {
    return "New Agent";
  }
  return thread.name ?? (thread.preview || "Untitled agent");
}

function relativeAge(timestamp: number): string {
  const normalized = normalizedTimestamp(timestamp);
  if (normalized <= 0) {
    return "";
  }
  const diffMs = Math.max(0, Date.now() - normalized);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < hour) {
    return `${Math.max(1, Math.floor(diffMs / minute))}m`;
  }
  if (diffMs < day) {
    return `${Math.floor(diffMs / hour)}h`;
  }
  return `${Math.floor(diffMs / day)}d`;
}

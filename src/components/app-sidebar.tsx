import { Archive, CirclePlus, FolderPlus, Store } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { RoderThread } from "@/types/roder";
import { SidebarAccountMenu } from "@/components/sidebar-account-menu";
import { DotMatrixSpinner } from "@/components/ui/dot-matrix-spinner";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isThreadRunning } from "@/lib/roder-thread";
import { cn } from "@/lib/utils";
import { groupThreadsByFolder, sidebarProjectOrder } from "@/lib/sidebar-thread-groups";
import { visibleThreadsForGroup } from "@/lib/sidebar-thread-visibility";

type AppSidebarProps = {
  threads: RoderThread[];
  activeThreadId: string;
  activeView: "chat" | "plugins";
  width: number;
  reserveTitlebarSpace: boolean;
  onSelectThread: (threadId: string) => void;
  onArchiveThread: (threadId: string) => void;
  onNewProject: () => void;
  onNewThread: () => void;
  onNewThreadInFolder: (path: string) => void;
  onOpenPlugins: () => void;
  onOpenSettings: () => void;
};

export function AppSidebar({
  threads,
  activeThreadId,
  activeView,
  width,
  reserveTitlebarSpace,
  onSelectThread,
  onArchiveThread,
  onNewProject,
  onNewThread,
  onNewThreadInFolder,
  onOpenPlugins,
  onOpenSettings,
}: AppSidebarProps): React.JSX.Element {
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(() => new Set());
  const [projectOrder, setProjectOrder] = useState<string[]>(() => []);
  const nextProjectOrder = useMemo(() => sidebarProjectOrder(threads, projectOrder), [projectOrder, threads]);
  const threadGroups = useMemo(() => groupThreadsByFolder(threads, nextProjectOrder), [nextProjectOrder, threads]);

  useEffect(() => {
    if (!sameStringList(projectOrder, nextProjectOrder)) {
      setProjectOrder(nextProjectOrder);
    }
  }, [nextProjectOrder, projectOrder]);

  function showMoreForGroup(groupKey: string): void {
    setExpandedGroupKeys((current) => {
      const next = new Set(current);
      next.add(groupKey);
      return next;
    });
  }

  function showLessForGroup(groupKey: string): void {
    setExpandedGroupKeys((current) => {
      const next = new Set(current);
      next.delete(groupKey);
      return next;
    });
  }

  return (
    <aside
      className={cn(
        "relative z-20 flex shrink-0 flex-col overflow-visible border-r border-border bg-sidebar text-sidebar-foreground",
        reserveTitlebarSpace && "drag-region",
        reserveTitlebarSpace ? "h-screen" : "h-full",
      )}
      style={{ width }}
    >
      {reserveTitlebarSpace && <div className="h-(--desktop-header-height)" />}
      <div className="no-drag flex flex-col gap-0.5 px-2">
        <SidebarRowButton onClick={onNewProject}>
          <FolderPlus className="size-4" />
          <span className="min-w-0 flex-1 truncate">Add Project</span>
          <Kbd className="ml-auto">⌘+O</Kbd>
        </SidebarRowButton>
        <SidebarRowButton onClick={onNewThread}>
          <CirclePlus className="size-4" />
          <span className="min-w-0 flex-1 truncate">New Agent</span>
          <Kbd className="ml-auto">⌘+N</Kbd>
        </SidebarRowButton>
        <SidebarRowButton
          className={cn(activeView === "plugins" && "bg-sidebar-active/20 text-sidebar-active-foreground")}
          onClick={onOpenPlugins}
        >
          <Store className="size-4" />
          <span className="min-w-0 flex-1 truncate">Plugins</span>
        </SidebarRowButton>
      </div>

      <div className="sidebar-scroll no-drag mt-5 min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden px-2 pb-4">
        <div className="flex flex-col gap-5">
          {threadGroups.length > 0 ? (
            threadGroups.map((group) => {
              const expanded = expandedGroupKeys.has(group.key);
              const visibility = visibleThreadsForGroup(group.threads, expanded);
              return (
                <section key={group.key}>
                  <div className="group squircle-corners relative flex h-8 items-center rounded-xl px-2.5 pr-8 text-base text-sidebar-heading outline-none hover:bg-sidebar-active/20">
                    <div className="min-w-0 flex-1 truncate" title={group.path || group.title}>
                      {group.title}
                    </div>
                    <Tooltip>
                      <TooltipTrigger
                        type="button"
                        className="absolute right-1 flex size-6 items-center justify-center rounded-md text-sidebar-muted opacity-0 outline-none transition-opacity hover:bg-sidebar-active/25 hover:text-sidebar-foreground focus-visible:bg-sidebar-active/25 focus-visible:text-sidebar-foreground group-hover:opacity-100 group-focus-within:opacity-100"
                        aria-label={`New thread in ${group.title}`}
                        onClick={() => onNewThreadInFolder(group.path)}
                      >
                        <CirclePlus className="size-3.5" />
                      </TooltipTrigger>
                      <TooltipContent side="right">New thread</TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="mt-2 flex flex-col gap-0.5">
                    {visibility.primaryThreads.map((thread) => (
                      <ThreadRow
                        key={thread.id}
                        thread={thread}
                        active={activeView === "chat" && thread.id === activeThreadId}
                        running={isThreadRunning(thread)}
                        onSelectThread={onSelectThread}
                        onArchiveThread={onArchiveThread}
                      />
                    ))}
                    {visibility.canShowMore && (
                      <SidebarRowButton
                        className="text-base text-sidebar-muted hover:text-sidebar-foreground"
                        onClick={() => showMoreForGroup(group.key)}
                      >
                        <span className="min-w-0 flex-1 truncate">Show more</span>
                        <span className="shrink-0 text-base">+{visibility.hiddenCount}</span>
                      </SidebarRowButton>
                    )}
                    {visibility.overflowThreads.length > 0 && (
                      <div
                        className="thread-overflow-region"
                        data-expanded={expanded ? "true" : undefined}
                        aria-hidden={!expanded}
                      >
                        <div className="thread-overflow-region-inner flex flex-col gap-0.5">
                          {visibility.overflowThreads.map((thread) => (
                            <ThreadRow
                              key={thread.id}
                              thread={thread}
                              active={activeView === "chat" && thread.id === activeThreadId}
                              running={isThreadRunning(thread)}
                              onSelectThread={onSelectThread}
                              onArchiveThread={onArchiveThread}
                              disabled={!expanded}
                            />
                          ))}
                          {visibility.canShowLess && (
                            <SidebarRowButton
                              className="text-base text-sidebar-muted hover:text-sidebar-foreground"
                              onClick={() => showLessForGroup(group.key)}
                            >
                              <span className="min-w-0 flex-1 truncate">Show less</span>
                            </SidebarRowButton>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              );
            })
          ) : (
            <div className="px-3 py-2 text-base text-sidebar-heading">No sessions yet</div>
          )}
        </div>
      </div>
      <SidebarAccountMenu onOpenSettings={onOpenSettings} />
    </aside>
  );
}

function ThreadRow({
  thread,
  active,
  running,
  onSelectThread,
  onArchiveThread,
  disabled = false,
}: {
  thread: RoderThread;
  active: boolean;
  running: boolean;
  onSelectThread: (threadId: string) => void;
  onArchiveThread: (threadId: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "thread-row squircle-corners relative flex h-8 w-full items-center rounded-xl text-left text-base font-medium text-sidebar-foreground outline-none hover:bg-sidebar-active/20",
        active && "bg-sidebar-active/20 text-sidebar-active-foreground",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <button
        type="button"
        className="flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2.5 pr-12 text-left outline-none"
        disabled={disabled}
        onClick={() => onSelectThread(thread.id)}
      >
        <span className="min-w-0 flex-1 truncate">{thread.name ?? (thread.preview || "Untitled agent")}</span>
        <span
          className={cn(
            "thread-row-age absolute right-2.5 text-base text-sidebar-muted",
            running && "flex h-6 w-6 -translate-x-px items-center justify-end",
          )}
          aria-label={running ? "Turn running" : undefined}
        >
          {running ? <DotMatrixSpinner /> : relativeAge(thread.updatedAt)}
        </span>
      </button>
      <Tooltip>
        <TooltipTrigger
          type="button"
          className="thread-row-archive absolute right-2 flex size-6 items-center justify-center rounded-md text-sidebar-muted outline-none hover:bg-sidebar-active/25 hover:text-sidebar-foreground focus-visible:bg-sidebar-active/25 focus-visible:text-sidebar-foreground"
          disabled={disabled}
          aria-label={`Archive ${(thread.name ?? thread.preview) || "thread"}`}
          onClick={() => onArchiveThread(thread.id)}
        >
          <Archive className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent side="right">Archive</TooltipContent>
      </Tooltip>
    </div>
  );
}

function SidebarRowButton({
  children,
  className,
  disabled = false,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        "squircle-corners flex h-8 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-base font-medium text-sidebar-foreground outline-none hover:bg-sidebar-active/20 disabled:pointer-events-none",
        className,
      )}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function sameStringList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function relativeAge(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "";
  }
  const normalized = normalizedTimestamp(timestamp);
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

function normalizedTimestamp(timestamp: number): number {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 0;
  }
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

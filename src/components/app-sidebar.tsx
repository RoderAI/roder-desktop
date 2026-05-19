import { Archive, CirclePlus, Store } from "lucide-react";
import { useMemo, useState } from "react";
import type { RoderThread } from "@/types/roder";
import { SidebarAccountMenu } from "@/components/sidebar-account-menu";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { visibleThreadsForGroup } from "@/lib/sidebar-thread-visibility";

type AppSidebarProps = {
  threads: RoderThread[];
  activeThreadId: string;
  width: number;
  onSelectThread: (threadId: string) => void;
  onNewThread: () => void;
};

type ThreadGroup = {
  key: string;
  title: string;
  path: string;
  updatedAt: number;
  threads: RoderThread[];
};

export function AppSidebar({
  threads,
  activeThreadId,
  width,
  onSelectThread,
  onNewThread,
}: AppSidebarProps): React.JSX.Element {
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(() => new Set());
  const threadGroups = useMemo(() => groupThreadsByFolder(threads, activeThreadId), [activeThreadId, threads]);

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
      className="drag-region relative z-20 flex h-screen shrink-0 flex-col overflow-visible border-r border-border bg-sidebar text-sidebar-foreground"
      style={{ width }}
    >
      <div className="h-[60px]" />

      <div className="no-drag flex flex-col gap-1 px-2">
        <SidebarRowButton onClick={onNewThread}>
          <CirclePlus className="size-4.5" />
          <span className="min-w-0 flex-1 truncate">New Agent</span>
          <Kbd className="ml-auto">⌘+N</Kbd>
        </SidebarRowButton>
        <SidebarRowButton>
          <Store className="size-4.5" />
          <span className="min-w-0 flex-1 truncate">Marketplace</span>
        </SidebarRowButton>
      </div>

      <div className="sidebar-scroll no-drag mt-6 min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden px-2 pb-5">
        <div className="flex flex-col gap-7">
          {threadGroups.length > 0 ? (
            threadGroups.map((group) => {
              const expanded = expandedGroupKeys.has(group.key);
              const visibility = visibleThreadsForGroup(group.threads, expanded);
              return (
                <section key={group.key}>
                  <div className="truncate px-3 text-[15px] text-sidebar-heading" title={group.path}>
                    {group.title}
                  </div>
                  <div className="mt-3 flex flex-col gap-1">
                    {visibility.primaryThreads.map((thread) => (
                      <ThreadRow
                        key={thread.id}
                        thread={thread}
                        activeThreadId={activeThreadId}
                        onSelectThread={onSelectThread}
                      />
                    ))}
                    {visibility.canShowMore && (
                      <SidebarRowButton
                        className="text-sm text-sidebar-muted hover:text-sidebar-foreground"
                        onClick={() => showMoreForGroup(group.key)}
                      >
                        <span className="min-w-0 flex-1 truncate">Show more</span>
                        <span className="shrink-0 text-[13px]">+{visibility.hiddenCount}</span>
                      </SidebarRowButton>
                    )}
                    {visibility.overflowThreads.length > 0 && (
                      <div
                        className="thread-overflow-region"
                        data-expanded={expanded ? "true" : undefined}
                        aria-hidden={!expanded}
                      >
                        <div className="thread-overflow-region-inner flex flex-col gap-1">
                          {visibility.overflowThreads.map((thread) => (
                            <ThreadRow
                              key={thread.id}
                              thread={thread}
                              activeThreadId={activeThreadId}
                              onSelectThread={onSelectThread}
                              disabled={!expanded}
                            />
                          ))}
                          {visibility.canShowLess && (
                            <SidebarRowButton
                              className="text-sm text-sidebar-muted hover:text-sidebar-foreground"
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
            <div className="px-3 py-2 text-[15px] text-sidebar-heading">No sessions yet</div>
          )}
        </div>
      </div>
      <SidebarAccountMenu />
    </aside>
  );
}

function ThreadRow({
  thread,
  activeThreadId,
  onSelectThread,
  disabled = false,
}: {
  thread: RoderThread;
  activeThreadId: string;
  onSelectThread: (threadId: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <SidebarRowButton
      className={cn(
        "thread-row",
        thread.id === activeThreadId && "bg-sidebar-active/20 text-sidebar-active-foreground",
      )}
      disabled={disabled}
      onClick={() => onSelectThread(thread.id)}
    >
      <span className="min-w-0 flex-1 truncate">{thread.name ?? (thread.preview || "Untitled agent")}</span>
      <span className="relative flex h-5 w-10 shrink-0 items-center justify-end">
        <span className="thread-row-age absolute right-0 text-[14px] text-sidebar-muted">{relativeAge(thread.updatedAt)}</span>
        <Archive className="thread-row-archive absolute right-0 size-4 text-sidebar-muted" />
      </span>
    </SidebarRowButton>
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
        "squircle-corners flex h-9 w-full items-center gap-3 rounded-xl px-3 text-left text-[16px] font-medium text-sidebar-foreground outline-none hover:bg-sidebar-active/20 disabled:pointer-events-none",
        className,
      )}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function groupThreadsByFolder(threads: RoderThread[], activeThreadId: string): ThreadGroup[] {
  const groups = new Map<string, ThreadGroup>();
  let activeFolderKey = "";

  for (const thread of threads) {
    if (thread.id.startsWith("demo-")) {
      continue;
    }
    const key = normalizeFolderKey(thread.cwd);
    const existing = groups.get(key);
    const group = existing ?? {
      key,
      title: folderName(thread.cwd),
      path: thread.cwd || "workspace",
      updatedAt: 0,
      threads: [],
    };
    group.updatedAt = Math.max(group.updatedAt, normalizedTimestamp(thread.updatedAt));
    group.threads.push(thread);
    groups.set(key, group);

    if (thread.id === activeThreadId) {
      activeFolderKey = key;
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      threads: [...group.threads].sort((left, right) => normalizedTimestamp(right.updatedAt) - normalizedTimestamp(left.updatedAt)),
    }))
    .sort((left, right) => {
      if (left.key === activeFolderKey) {
        return -1;
      }
      if (right.key === activeFolderKey) {
        return 1;
      }
      return right.updatedAt - left.updatedAt || left.title.localeCompare(right.title);
    });
}

function normalizeFolderKey(path: string): string {
  return path || "workspace";
}

function folderName(path: string): string {
  return path?.split("/").filter(Boolean).pop() || "workspace";
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

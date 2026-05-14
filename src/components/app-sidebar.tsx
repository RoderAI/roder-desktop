import { Archive, Boxes, ChevronLeft, ChevronRight, Folder, GitBranch, PanelLeftClose, Pin, Search, Send } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { GodeThread } from "@/types/gode";
import { Button } from "@/components/ui/button";
import { SidebarAccountMenu } from "@/components/sidebar-account-menu";
import { cn } from "@/lib/utils";

type AppSidebarProps = {
  threads: GodeThread[];
  activeThreadId: string;
  width: number;
  onSelectThread: (threadId: string) => void;
  onNewThread: () => void;
  onBack: () => void;
  onForward: () => void;
  onClose: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
};

type PreviewState = {
  thread: GodeThread;
  top: number;
};

type ThreadGroup = {
  key: string;
  title: string;
  path: string;
  updatedAt: number;
  threads: GodeThread[];
};

export function AppSidebar({
  threads,
  activeThreadId,
  width,
  onSelectThread,
  onNewThread,
  onBack,
  onForward,
  onClose,
  canGoBack,
  canGoForward,
}: AppSidebarProps): React.JSX.Element {
  const sidebarRef = useRef<HTMLElement | null>(null);
  const hidePreviewTimerRef = useRef<number | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const threadGroups = useMemo(() => groupThreadsByFolder(threads, activeThreadId), [activeThreadId, threads]);

  function clearHidePreviewTimer(): void {
    if (hidePreviewTimerRef.current === null) {
      return;
    }
    window.clearTimeout(hidePreviewTimerRef.current);
    hidePreviewTimerRef.current = null;
  }

  function showPreview(thread: GodeThread, element: HTMLElement): void {
    clearHidePreviewTimer();
    const sidebar = sidebarRef.current;
    const sidebarRect = sidebar?.getBoundingClientRect();
    const rowRect = element.getBoundingClientRect();
    const rawTop = sidebarRect ? rowRect.top - sidebarRect.top - 4 : rowRect.top;
    const maxTop = Math.max(72, (sidebarRect?.height ?? window.innerHeight) - 158);
    setPreview({ thread, top: Math.min(Math.max(rawTop, 76), maxTop) });
  }

  function scheduleHidePreview(): void {
    clearHidePreviewTimer();
    hidePreviewTimerRef.current = window.setTimeout(() => setPreview(null), 120);
  }

  return (
    <aside
      ref={sidebarRef}
      className="drag-region relative z-20 flex h-screen shrink-0 flex-col overflow-visible border-r border-border bg-sidebar text-sidebar-foreground"
      style={{ width }}
    >
      <div className="flex h-[64px] items-center gap-3 px-5 pl-[104px]">
        <button
          className="no-drag flex size-8 items-center justify-center rounded-md opacity-70 transition-colors hover:bg-sidebar-accent hover:opacity-100 active:scale-95"
          aria-label="Hide sidebar"
          title="Hide sidebar"
          onClick={onClose}
        >
          <PanelLeftClose className="size-4" />
        </button>
        <Search className="size-5 opacity-70" />
        <div className="ml-auto flex items-center gap-3 opacity-60">
          <button className="rounded-md p-1 disabled:opacity-30" disabled={!canGoBack} onClick={onBack}>
            <ChevronLeft className="size-5" />
          </button>
          <button className="rounded-md p-1 disabled:opacity-30" disabled={!canGoForward} onClick={onForward}>
            <ChevronRight className="size-5" />
          </button>
        </div>
      </div>

      <div className="no-drag flex flex-col gap-1 px-3">
        <Button
          variant="ghost"
          className="h-10 justify-start gap-3 rounded-lg bg-sidebar-active px-3 text-[15px] text-sidebar-active-foreground hover:bg-sidebar-active"
          onClick={onNewThread}
        >
          <Send className="size-5" />
          New Agent
          <span className="ml-auto text-xs text-sidebar-muted">⌘N</span>
        </Button>
        <Button variant="ghost" className="h-10 justify-start gap-3 px-3 text-[15px] text-sidebar-foreground">
          <Boxes className="size-5" />
          Marketplace
        </Button>
      </div>

      <div className="sidebar-scroll no-drag mt-6 min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden px-2 pb-5">
        <div className="flex flex-col gap-7">
          {threadGroups.length > 0 ? (
            threadGroups.map((group) => (
              <section key={group.key}>
                <div className="truncate px-3 text-[14px] text-sidebar-heading" title={group.path}>
                  {group.title}
                </div>
                <div className="mt-3 flex flex-col gap-1">
                  {group.threads.map((thread) => (
                    <button
                      key={thread.id}
                      className={cn(
                        "flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] text-sidebar-foreground outline-none hover:bg-sidebar-accent",
                        thread.id === activeThreadId && "bg-sidebar-active text-sidebar-active-foreground",
                      )}
                      onMouseEnter={(event) => showPreview(thread, event.currentTarget)}
                      onMouseLeave={scheduleHidePreview}
                      onFocus={(event) => showPreview(thread, event.currentTarget)}
                      onBlur={scheduleHidePreview}
                      onClick={() => onSelectThread(thread.id)}
                    >
                      {thread.id === activeThreadId ? (
                        <Pin className="size-4 shrink-0 fill-current opacity-70" />
                      ) : (
                        <span className="size-1.5 shrink-0 rounded-full bg-sidebar-dot" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{thread.name ?? (thread.preview || "Untitled agent")}</span>
                      {thread.id === activeThreadId && (
                        <>
                          <span className="shrink-0 text-[13px] text-sidebar-muted">{relativeAge(thread.updatedAt)}</span>
                          <Archive className="size-4 shrink-0 text-sidebar-muted" />
                        </>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            ))
          ) : (
            <div className="px-3 py-2 text-[14px] text-sidebar-heading">No sessions yet</div>
          )}
        </div>
      </div>
      {preview && (
        <ThreadPreviewCard
          thread={preview.thread}
          top={preview.top}
          onMouseEnter={clearHidePreviewTimer}
          onMouseLeave={scheduleHidePreview}
        />
      )}
      <SidebarAccountMenu />
    </aside>
  );
}

function ThreadPreviewCard({
  thread,
  top,
  onMouseEnter,
  onMouseLeave,
}: {
  thread: GodeThread;
  top: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}): React.JSX.Element {
  const title = thread.name ?? (thread.preview || "Untitled agent");
  return (
    <div
      className="no-drag absolute left-[calc(100%-8px)] w-[342px] rounded-lg bg-popover px-4 py-3 text-popover-foreground shadow-lg ring-1 ring-border"
      style={{ top }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="truncate text-[15px] text-foreground">{title}</div>
      <div className="mt-3 flex items-start gap-3 text-[14px] text-muted-foreground">
        <GitBranch className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <div className="truncate">{thread.modelProvider || "gode"}</div>
          <div className="truncate">{thread.status.type || "idle"}</div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3 text-[14px] text-muted-foreground">
        <Folder className="size-4 shrink-0" />
        <span className="truncate">{shortPath(thread.cwd)}</span>
      </div>
    </div>
  );
}

function groupThreadsByFolder(threads: GodeThread[], activeThreadId: string): ThreadGroup[] {
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

function shortPath(path: string): string {
  if (!path) {
    return "workspace";
  }
  const home = processHomePath(path);
  return home ?? folderName(path);
}

function processHomePath(path: string): string | undefined {
  const marker = "/w/";
  const workspaceIndex = path.indexOf(marker);
  if (workspaceIndex !== -1) {
    return `~${path.slice(workspaceIndex)}`;
  }
  return undefined;
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

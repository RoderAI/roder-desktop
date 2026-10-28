import {
  Archive,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  Plus,
  Search,
  Settings,
  Store,
  ListTodo,
  MessagesSquare,
  X,
} from "lucide-react";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { PersistentAgentAvatar } from "@/components/persistent-agent-avatar";
import { persistentAgentsIpc } from "@/lib/persistent-agents-ipc";
import { roderIpc } from "@/lib/roder-ipc";
import type { PersistentAgent } from "@/types/persistent-agents";
import { Link } from "@tanstack/react-router";
import { useId, useReducer, useRef, useState } from "react";
import { useRoderStore } from "@/stores/roder-store";
import type { RoderThread, SubagentTraceView } from "@/types/roder";
import { DotMatrixSpinner } from "@/components/ui/dot-matrix-spinner";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isThreadRunning } from "@/lib/roder-thread";
import { cn } from "@/lib/utils";
import { groupThreadsByFolder, moveSidebarProject, sidebarProjectOrder } from "@/lib/sidebar-thread-groups";
import { visibleThreadsForGroup } from "@/lib/sidebar-thread-visibility";

export function filterPersistentAgents<T extends Pick<PersistentAgent, "name" | "mission" | "workspaceId">>(
  agents: T[],
  query: string,
  workspaces: { id: string; name: string }[],
): T[] {
  const search = query.trim().toLowerCase();
  const workspaceNames = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));
  return agents.filter((agent) =>
    `${agent.name}\n${agent.mission}\n${workspaceNames.get(agent.workspaceId) ?? agent.workspaceId}`
      .toLowerCase()
      .includes(search),
  );
}

export function ordinarySidebarThreads<
  T extends { id: string; parentThreadId?: string | null; workspaceFork?: unknown },
>(
  threads: T[],
  agents: { threadId: string }[],
  tracesByThread: Record<string, readonly Pick<SubagentTraceView, "childThreadId">[]> = {},
): T[] {
  const persistentThreadIds = new Set(agents.map((agent) => agent.threadId));
  const childThreadIds = new Set(
    Object.values(tracesByThread).flatMap((traces) => traces.map((trace) => trace.childThreadId).filter(Boolean)),
  );
  return threads.filter(
    (thread) => !persistentThreadIds.has(thread.id) && !thread.parentThreadId && !childThreadIds.has(thread.id),
  );
}

type SidebarSearchState = { open: boolean; query: string };
export function sidebarSearchReducer(
  state: SidebarSearchState,
  action: { type: "open" } | { type: "close" } | { type: "query"; query: string },
): SidebarSearchState {
  if (action.type === "close") return { open: false, query: "" };
  if (action.type === "open") return { open: true, query: "" };
  return state.open ? { open: true, query: action.query } : state;
}

export function SidebarSearchField({
  search,
  label,
  onChange,
  onClose,
}: {
  search: SidebarSearchState;
  label: string;
  onChange: (query: string) => void;
  onClose: () => void;
}): React.JSX.Element | null {
  if (!search.open) return null;
  return (
    <div className="relative">
      <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-2 size-4 text-sidebar-muted" />
      <input
        ref={(node) => {
          node?.focus();
        }}
        aria-label={label}
        placeholder={label + "…"}
        value={search.query}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
        className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-8 text-base outline-none placeholder:text-sidebar-muted focus-visible:ring-2 focus-visible:ring-ring"
      />
      <button
        type="button"
        aria-label="Close search"
        onClick={onClose}
        className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-md text-sidebar-muted hover:bg-sidebar-active/25 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

type AppSidebarProps = {
  threads: RoderThread[];
  activeThreadId: string;
  activeView: "chat" | "plugins" | "threads" | "issues" | "persistentAgents";
  hasMoreThreads: boolean;
  loadingMoreThreads: boolean;
  reserveTitlebarSpace: boolean;
  onSelectThread: (threadId: string) => void;
  onArchiveThread: (threadId: string) => void;
  onLoadMoreThreads: () => void;
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
  hasMoreThreads,
  loadingMoreThreads,
  reserveTitlebarSpace,
  onSelectThread,
  onArchiveThread,
  onLoadMoreThreads,
  onNewProject,
  onNewThread,
  onNewThreadInFolder,
  onOpenPlugins,
  onOpenSettings,
}: AppSidebarProps): React.JSX.Element {
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(() => new Set());
  const [threadSearch, dispatchThreadSearch] = useReducer(sidebarSearchReducer, { open: false, query: "" });
  const {
    persistentAgents,
    error: persistentAgentsError,
    loading: persistentAgentsLoading,
    refresh: refreshPersistentAgents,
  } = useSidebarPersistentAgents();
  const subagentTracesByThread = useRoderStore((state) => state.subagentTracesByThread);
  const ordinaryThreads = ordinarySidebarThreads(threads, persistentAgents, subagentTracesByThread);
  const matchingThreads = ordinaryThreads.filter((thread) =>
    `${thread.name ?? ""}\n${thread.preview}\n${thread.cwd}`
      .toLowerCase()
      .includes(threadSearch.query.trim().toLowerCase()),
  );
  const [manualProjectOrder, setManualProjectOrder] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved: unknown = JSON.parse(window.localStorage.getItem("sidebar-project-order") ?? "[]");
      return Array.isArray(saved) && saved.every((key) => typeof key === "string") ? saved : [];
    } catch {
      return [];
    }
  });
  const projectOrder = sidebarProjectOrder(ordinaryThreads, manualProjectOrder);
  const threadGroups = groupThreadsByFolder(matchingThreads, projectOrder);

  function handleProjectDrop(event: React.DragEvent<HTMLElement>, target: string): void {
    event.preventDefault();
    const source = event.dataTransfer.getData("application/x-roder-sidebar-project");
    const next = moveSidebarProject(projectOrder, source, target);
    if (next === projectOrder) return;
    setManualProjectOrder(next);
    try {
      window.localStorage.setItem("sidebar-project-order", JSON.stringify(next));
    } catch {
      // The in-memory order still works if storage is unavailable.
    }
  }

  function handleThreadListScroll(event: React.UIEvent<HTMLDivElement>): void {
    if (!hasMoreThreads || loadingMoreThreads) {
      return;
    }
    const target = event.currentTarget;
    if (target.scrollTop + target.clientHeight >= target.scrollHeight - 240) {
      onLoadMoreThreads();
    }
  }

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
        "relative z-20 flex w-full shrink-0 flex-col overflow-visible border-r border-border bg-sidebar text-sidebar-foreground",
        reserveTitlebarSpace && "drag-region",
        reserveTitlebarSpace ? "h-screen" : "h-full",
      )}
    >
      {reserveTitlebarSpace && <div className="h-(--desktop-header-height)" />}
      <div className="no-drag flex flex-col gap-0.5 px-2">
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
        {(
          [
            { view: "threads", to: "/threads", label: "Threads", Icon: MessagesSquare },
            { view: "issues", to: "/issues", label: "Issues", Icon: ListTodo },
          ] as const
        ).map(({ view, to, label, Icon }) => (
          <Link
            key={view}
            to={to}
            search={true}
            aria-current={activeView === view ? "page" : undefined}
            className={cn(
              "flex h-8 items-center gap-2 rounded-xl px-2 text-base font-medium hover:bg-sidebar-active/20 focus-visible:ring-2 focus-visible:ring-ring",
              activeView === view && "bg-sidebar-active/20 text-sidebar-active-foreground",
            )}
          >
            <Icon className="size-4" />
            <span>{label}</span>
          </Link>
        ))}
      </div>

      <div
        className="sidebar-scroll no-drag mt-3 min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3"
        onScroll={handleThreadListScroll}
      >
        <div className="flex flex-col gap-4">
          <PersistentAgentLinks
            persistentAgents={persistentAgents}
            error={persistentAgentsError}
            loading={persistentAgentsLoading}
            onRetry={() => void refreshPersistentAgents()}
            activeThreadId={activeView === "chat" ? activeThreadId : ""}
            activeManagement={activeView === "persistentAgents"}
            onSelectThread={onSelectThread}
          />
          <section aria-label="Projects" className="space-y-1">
            <div className="flex h-7 items-center gap-2 px-2.5 text-sidebar-heading">
              <h2 className="min-w-0 flex-1 text-base font-medium">Projects</h2>
              <button
                type="button"
                aria-label={threadSearch.open ? "Close project search" : "Search projects"}
                aria-expanded={threadSearch.open}
                className="flex size-6 items-center justify-center rounded-md hover:bg-sidebar-active/25 focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => dispatchThreadSearch({ type: threadSearch.open ? "close" : "open" })}
              >
                <Search className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Add project"
                title="Add project"
                className="flex size-6 items-center justify-center rounded-md hover:bg-sidebar-active/25 focus-visible:ring-2 focus-visible:ring-ring"
                onClick={onNewProject}
              >
                <Plus className="size-4" />
              </button>
            </div>
            <SidebarSearchField
              search={threadSearch}
              label="Search projects"
              onChange={(query) => dispatchThreadSearch({ type: "query", query })}
              onClose={() => dispatchThreadSearch({ type: "close" })}
            />
            {threadGroups.length > 0 ? (
              threadGroups.map((group) => {
                const expanded = expandedGroupKeys.has(group.key);
                const visibility = visibleThreadsForGroup(group.threads, expanded);
                return (
                  <section key={group.key}>
                    <div
                      className="group squircle-corners relative flex h-7 cursor-grab items-center rounded-xl text-base text-sidebar-heading outline-none hover:bg-sidebar-active/20 active:cursor-grabbing"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("application/x-roder-sidebar-project", group.key);
                      }}
                      onDragOver={(event) => {
                        if (event.dataTransfer.types.includes("application/x-roder-sidebar-project")) {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }
                      }}
                      onDrop={(event) => handleProjectDrop(event, group.key)}
                    >
                      <button
                        type="button"
                        className="flex h-full min-w-0 flex-1 items-center rounded-xl px-2.5 pr-8 text-left outline-none focus-visible:bg-sidebar-active/25 focus-visible:text-sidebar-foreground"
                        title={group.path || group.title}
                        aria-label={`New agent in ${group.title}`}
                        onClick={() => onNewThreadInFolder(group.path)}
                      >
                        <span className="min-w-0 flex-1 truncate">{group.title}</span>
                      </button>
                      <Tooltip>
                        <TooltipTrigger
                          type="button"
                          className="absolute right-1 flex size-6 items-center justify-center rounded-md text-sidebar-muted opacity-0 outline-none transition-opacity hover:bg-sidebar-active/25 hover:text-sidebar-foreground focus-visible:bg-sidebar-active/25 focus-visible:text-sidebar-foreground group-hover:opacity-100 group-focus-within:opacity-100"
                          aria-label={`New agent in ${group.title}`}
                          onClick={() => onNewThreadInFolder(group.path)}
                        >
                          <CirclePlus className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipContent side="right">New agent</TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="mt-1 flex flex-col gap-0.5">
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
              <div className="px-3 py-2 text-sm text-sidebar-muted">
                {threadSearch.query.trim() ? "No matching threads" : "No threads yet"}
              </div>
            )}
            {hasMoreThreads || loadingMoreThreads ? (
              <SidebarRowButton
                className="text-base text-sidebar-muted hover:text-sidebar-foreground"
                disabled={loadingMoreThreads}
                onClick={onLoadMoreThreads}
              >
                <span className="min-w-0 flex-1 truncate">
                  {loadingMoreThreads ? "Loading sessions..." : "Load more"}
                </span>
              </SidebarRowButton>
            ) : null}
          </section>
        </div>
      </div>
      <div className="no-drag shrink-0 px-2 pb-2">
        <SidebarRowButton className="focus-visible:ring-2 focus-visible:ring-ring" onClick={onOpenSettings}>
          <Settings className="size-4" />
          <span>Settings</span>
        </SidebarRowButton>
      </div>
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
            "thread-row-age absolute right-2.5 text-sm text-sidebar-muted",
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

function useSidebarPersistentAgents() {
  const [persistentAgents, setPersistentAgents] = useState<PersistentAgent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  useMountEffect(() => {
    let mounted = true;
    let revision = 0;
    async function refresh(): Promise<void> {
      setLoading(true);
      revision = revision + 1;
      const request = revision;
      try {
        const result = await persistentAgentsIpc.list();
        if (mounted && request === revision) {
          setPersistentAgents(result.persistentAgents);
          setError(null);
          setLoading(false);
        }
      } catch (cause) {
        if (mounted && request === revision) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setLoading(false);
        }
      }
    }
    refreshRef.current = refresh;
    const unsubscribe = roderIpc.onNotification((notification) => {
      if (notification.method === "desktop/persistent-agents/changed") void refresh();
    });
    void refresh();
    return () => {
      mounted = false;
      unsubscribe();
    };
  });
  return { persistentAgents, error, loading, refresh: () => refreshRef.current() };
}

function PersistentAgentLinks({
  persistentAgents,
  error,
  loading,
  onRetry,
  activeThreadId,
  activeManagement,
  onSelectThread,
}: {
  persistentAgents: PersistentAgent[];
  error: string | null;
  loading: boolean;
  onRetry: () => void;
  activeThreadId: string;
  activeManagement: boolean;
  onSelectThread: (threadId: string) => void;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(true);
  const [search, dispatchSearch] = useReducer(sidebarSearchReducer, { open: false, query: "" });
  const workspaces = useRoderStore((state) => state.workspaces);
  const listId = useId();
  const filtered = filterPersistentAgents(persistentAgents, search.query, workspaces);
  return (
    <section aria-label="Persistent Agents">
      <div className="flex h-7 items-center gap-1 text-sidebar-heading">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-label={expanded ? "Collapse persistent agents" : "Expand persistent agents"}
          className="flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-sidebar-active/20 focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            setExpanded(!expanded);
            dispatchSearch({ type: "close" });
          }}
        >
          {expanded ? (
            <ChevronDown aria-hidden="true" className="size-3.5" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-3.5" />
          )}
        </button>
        <h2 className="min-w-0 flex-1 text-base font-medium">
          <Link
            to="/persistent-agents"
            search={{ create: undefined }}
            aria-current={activeManagement ? "page" : undefined}
            className={cn(
              "flex h-7 items-center gap-1 rounded-lg px-1 hover:bg-sidebar-active/20 focus-visible:ring-2 focus-visible:ring-ring",
              activeManagement && "bg-sidebar-active/20 text-sidebar-active-foreground",
            )}
          >
            <span className="truncate">Persistent Agents</span>
            <span className="ml-auto text-sm text-sidebar-muted">{persistentAgents.length}</span>
          </Link>
        </h2>
        <button
          type="button"
          aria-label={search.open ? "Close persistent agent search" : "Search persistent agents"}
          aria-expanded={search.open}
          className="flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-sidebar-active/25 focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            setExpanded(true);
            dispatchSearch({ type: search.open ? "close" : "open" });
          }}
        >
          <Search className="size-4" />
        </button>
        <Link
          to="/persistent-agents"
          search={{ create: true }}
          aria-label="Add persistent agent"
          title="Add persistent agent"
          className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-sidebar-active/25 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-4" />
        </Link>
      </div>
      <div id={listId} hidden={!expanded} className="mt-1 space-y-1">
        <SidebarSearchField
          search={search}
          label="Search persistent agents"
          onChange={(query) => dispatchSearch({ type: "query", query })}
          onClose={() => dispatchSearch({ type: "close" })}
        />
        <div className="space-y-0.5">
          {filtered.map((persistentAgent) => (
            <SidebarRowButton
              key={persistentAgent.id}
              className={cn(
                "h-11 focus-visible:ring-2 focus-visible:ring-ring",
                persistentAgent.threadId === activeThreadId && "bg-sidebar-active/20 text-sidebar-active-foreground",
              )}
              onClick={() => onSelectThread(persistentAgent.threadId)}
            >
              <PersistentAgentAvatar id={persistentAgent.id} sprite={persistentAgent.sprite} />
              <span className="min-w-0 flex-1" title={persistentAgent.mission}>
                <span className="block truncate">{persistentAgent.name}</span>
                <span className="block truncate text-sm font-normal text-sidebar-muted">{persistentAgent.mission}</span>
              </span>
            </SidebarRowButton>
          ))}
        </div>
        {loading && !persistentAgents.length ? (
          <p role="status" className="px-2.5 text-sm text-sidebar-muted">
            Loading persistent agents…
          </p>
        ) : null}
        {!loading && !error && !filtered.length ? (
          <div className="px-2.5 text-sm text-sidebar-muted">
            {persistentAgents.length ? (
              "No matching persistent agents"
            ) : (
              <p>No persistent agents yet. Use + to add one.</p>
            )}
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="px-2.5 py-1 text-sm text-destructive">
            Couldn’t load persistent agents: {error}{" "}
            <button
              type="button"
              className="rounded-md underline focus-visible:ring-2 focus-visible:ring-ring"
              onClick={onRetry}
            >
              Retry
            </button>
          </p>
        ) : null}
      </div>
    </section>
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

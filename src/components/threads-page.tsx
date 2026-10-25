import { Link } from "@tanstack/react-router";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Cpu,
  Folder,
  GitBranch,
  MessageSquare,
  RefreshCw,
  Search,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { relativeAge } from "@/lib/relative-age";
import { roderIpc } from "@/lib/roder-ipc";
import {
  filterThreadList,
  discoverThreadListTraces,
  threadListProject,
  threadListStatus,
  traceListStatus,
} from "@/lib/thread-list";
import { useRoderStore } from "@/stores/roder-store";
import type { SubagentTraceSummary } from "@/types/roder";
import { TraceEvents } from "@/components/subagent-trace-events";

const controlClass =
  "h-8 rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ThreadsPage(): React.JSX.Element {
  const threads = useRoderStore((state) => state.threads);
  const workspaces = useRoderStore((state) => state.workspaces);
  const liveTraces = useRoderStore((state) => state.subagentTracesByThread);
  const nextCursor = useRoderStore((state) => state.nextThreadCursor);
  const loadingMore = useRoderStore((state) => state.loadingMoreThreads);
  const loadMore = useRoderStore((state) => state.loadMoreThreads);
  const refresh = useRoderStore((state) => state.refreshThreads);
  const storeError = useRoderStore((state) => state.error);
  const hydrated = useRoderStore((state) => state.hydrated);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [project, setProject] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [traces, setTraces] = useState<Record<string, SubagentTraceSummary[]>>({});
  const [lookupErrors, setLookupErrors] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [discoveryVersion, setDiscoveryVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const mergedTraces = { ...traces };
  for (const [threadId, values] of Object.entries(liveTraces)) {
    mergedTraces[threadId] = [
      ...new Map([...(traces[threadId] ?? []), ...values].map((trace) => [trace.traceId, trace])).values(),
    ];
  }
  const filtered = filterThreadList(threads, mergedTraces, workspaces, { search, status, project });
  const statuses = [
    ...new Set([
      "running",
      "waiting",
      "idle",
      "completed",
      "failed",
      "queued",
      "cancelled",
      ...threads.map(threadListStatus),
    ]),
  ];

  async function refreshList(): Promise<void> {
    setRefreshing(true);
    setError(null);
    try {
      await refresh();
      setTraces({});
      setLookupErrors({});
      setDiscoveryVersion((version) => version + 1);
    } catch (cause) {
      setError(String(cause));
    }
    setRefreshing(false);
  }

  return (
    <main className="flex h-full min-h-0 flex-col bg-background text-base font-medium">
      <ThreadTraceDiscovery
        key={`${discoveryVersion}:${threads.map((thread) => thread.id).join(",")}`}
        threadIds={threads.flatMap((thread) => (thread.id in traces ? [] : [thread.id]))}
        onLoaded={(threadId, values) => {
          setTraces((current) => ({ ...current, [threadId]: values }));
          setLookupErrors((current) => {
            const next = { ...current };
            delete next[threadId];
            return next;
          });
        }}
        onError={(threadId, cause) => setLookupErrors((current) => ({ ...current, [threadId]: String(cause) }))}
      />
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-base font-semibold">Threads</h1>
          <p className="text-sm font-normal text-muted-foreground">
            {filtered.length} of {threads.length} loaded
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="rounded-lg"
          disabled={refreshing}
          onClick={() => void refreshList()}
        >
          <RefreshCw className="size-4" />
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 pb-3">
        <label className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-2 size-4 text-muted-foreground" />
          <input
            aria-label="Search threads and loaded subagents"
            placeholder="Search threads and subagents…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={`${controlClass} w-full pl-9`}
          />
        </label>
        <select
          aria-label="Filter by status"
          className={controlClass}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">All statuses</option>
          {statuses.map((value) => (
            <option key={value} value={value}>
              {statusLabel(value)}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by project"
          className={`${controlClass} w-44 truncate`}
          value={project}
          onChange={(event) => setProject(event.target.value)}
        >
          <option value="">All projects</option>
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4 pt-2">
        {nextCursor ? (
          <p className="pb-2 text-sm font-normal text-muted-foreground">
            Filters search loaded results; load more to include older threads.
          </p>
        ) : null}
        {error || storeError ? (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {error || storeError}
          </p>
        ) : null}
        {!hydrated && !threads.length ? (
          <p role="status" className="py-8 text-muted-foreground">
            Loading threads…
          </p>
        ) : null}
        {hydrated && !filtered.length ? (
          <div className="rounded-xl bg-muted/30 px-4 py-8 text-center">
            <MessageSquare className="mx-auto mb-3 size-5 text-muted-foreground" />
            <p>{threads.length ? "No threads match these filters" : "No threads yet"}</p>
            <p className="mt-1 text-sm font-normal text-muted-foreground">
              {threads.length
                ? "Try another search or load more threads below."
                : "Start a new agent to begin a conversation."}
            </p>
          </div>
        ) : null}
        <ul>
          {filtered.map((thread) => {
            const isExpanded = expanded.has(thread.id);
            const children = mergedTraces[thread.id] ?? [];
            const workspace = threadListProject(thread, workspaces);
            return (
              <li key={thread.id}>
                <div className="flex h-10 items-center gap-3 rounded-lg px-2 hover:bg-accent/60">
                  {children.length ? (
                    <button
                      type="button"
                      className="grid size-7 shrink-0 place-items-center rounded-md hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`${isExpanded ? "Collapse" : "Show"} subagents for ${thread.name || thread.preview || thread.id}`}
                      aria-expanded={isExpanded}
                      onClick={() =>
                        setExpanded((current) => {
                          const next = new Set(current);
                          if (next.has(thread.id)) next.delete(thread.id);
                          else next.add(thread.id);
                          return next;
                        })
                      }
                    >
                      {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </button>
                  ) : lookupErrors[thread.id] ? (
                    <button
                      type="button"
                      className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`Retry subagent lookup for ${thread.name || thread.preview || thread.id}`}
                      title={`Subagent history unavailable. Click to retry.\n${lookupErrors[thread.id]}`}
                      onClick={() => {
                        setLookupErrors((current) => {
                          const next = { ...current };
                          delete next[thread.id];
                          return next;
                        });
                        setDiscoveryVersion((version) => version + 1);
                      }}
                    >
                      <AlertCircle className="size-4" />
                    </button>
                  ) : (
                    <span aria-hidden="true" className="size-7 shrink-0" />
                  )}
                  <StatusLabel status={threadListStatus(thread)} />
                  <Link
                    to="/threads/$threadId"
                    params={{ threadId: thread.id }}
                    search={true}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {thread.name || thread.preview || "Untitled thread"}
                    </span>
                    {children.length ? (
                      <span className="shrink-0 text-sm text-muted-foreground" title="Linked subagents">
                        <GitBranch className="mr-1 inline size-3.5" />
                        {children.length}
                      </span>
                    ) : null}
                    <span className="w-36 shrink-0" title={workspace?.name || thread.cwd || "No project"}>
                      <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-sm text-muted-foreground">
                        <Folder className="size-3.5 shrink-0" />
                        <span className="truncate">{workspace?.name || thread.cwd || "No project"}</span>
                      </span>
                    </span>
                    <span
                      className="w-44 shrink-0"
                      title={[thread.model, thread.modelProvider].filter(Boolean).join(" · ")}
                    >
                      <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-sm text-muted-foreground">
                        <Cpu className="size-3.5 shrink-0" />
                        <span className="truncate">{thread.model || "Model not reported"}</span>
                      </span>
                    </span>
                  </Link>
                  <span className="w-9 shrink-0 text-right text-sm text-muted-foreground" title="Last updated">
                    {relativeAge(thread.updatedAt)}
                  </span>
                </div>
                {isExpanded && children.length > 0 ? <ThreadChildren traces={children} /> : null}
              </li>
            );
          })}
        </ul>
        {nextCursor ? (
          <div className="flex justify-center py-3">
            <Button
              size="sm"
              variant="outline"
              className="rounded-lg"
              disabled={loadingMore}
              onClick={() => void loadMore().catch((cause) => setError(String(cause)))}
            >
              {loadingMore ? "Loading…" : "Load more threads"}
            </Button>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function ThreadTraceDiscovery({
  threadIds,
  onLoaded,
  onError,
}: {
  threadIds: string[];
  onLoaded: (threadId: string, traces: SubagentTraceSummary[]) => void;
  onError: (threadId: string, error: unknown) => void;
}): null {
  useMountEffect(() => {
    let active = true;
    void discoverThreadListTraces(threadIds, roderIpc, onLoaded, onError, () => active);
    return () => {
      active = false;
    };
  });
  return null;
}

function ThreadChildren({ traces }: { traces: SubagentTraceSummary[] }): React.JSX.Element {
  return (
    <div className="mb-1 ml-5 border-l border-border pl-5">
      <ul>
        {traces.map((trace) => (
          <TraceRow key={trace.traceId} trace={trace} />
        ))}
      </ul>
    </div>
  );
}

function TraceRow({ trace }: { trace: SubagentTraceSummary }): React.JSX.Element {
  const [showTrace, setShowTrace] = useState(false);
  return (
    <li>
      <div className="flex h-10 items-center gap-3 rounded-lg px-2 hover:bg-accent/60">
        <GitBranch className="size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {trace.childThreadId ? (
            <Link
              to="/threads/$threadId"
              params={{ threadId: trace.childThreadId }}
              search={true}
              className="min-w-0 flex-1 truncate rounded-md focus-visible:ring-2 focus-visible:ring-ring"
            >
              {trace.title}
            </Link>
          ) : (
            <span className="min-w-0 flex-1 truncate">{trace.title}</span>
          )}
          <p
            className="max-w-64 truncate text-sm font-normal text-muted-foreground"
            title={[trace.role, trace.model, trace.destination?.label, trace.latestActivity || trace.errorSummary]
              .filter(Boolean)
              .join(" · ")}
          >
            {[trace.role, trace.model, trace.destination?.label, trace.latestActivity || trace.errorSummary]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <StatusLabel status={traceListStatus(trace)} />
        <Button size="sm" variant="ghost" aria-expanded={showTrace} onClick={() => setShowTrace(!showTrace)}>
          {showTrace ? "Hide trace" : "Show trace"}
        </Button>
      </div>
      {showTrace ? <TraceEvents trace={trace} /> : null}
    </li>
  );
}

function statusLabel(status: string): string {
  return status.replace(/_/gu, " ").replace(/^./u, (value) => value.toUpperCase());
}

function StatusLabel({ status }: { status: string }): React.JSX.Element {
  return (
    <span className="inline-flex shrink-0 items-center" title={statusLabel(status)}>
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${status === "running" ? "bg-emerald-500" : status === "waiting" ? "bg-amber-500" : status === "failed" ? "bg-destructive" : "bg-muted-foreground/50"}`}
      />
      <span className="sr-only">{statusLabel(status)}</span>
    </span>
  );
}

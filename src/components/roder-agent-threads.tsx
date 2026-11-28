import { threadLabel } from "@/components/roder-issue-conversation";
import { workerGroups, type RoderWorkerEvent, type WorkerRow } from "@/lib/roder-board";
import { cn } from "@/lib/utils";
import type { Issue } from "@/types/issues";
import type { RoderThread } from "@/types/roder";
import type { RoderAgent } from "@/types/roder-agents";

/**
 * The Threads tab, from the worker registry: running threads, the queue with
 * each thread's place, and stopped threads with why they stopped.
 */
export function RoderAgentThreads({
  roder,
  issues,
  threads,
  events,
  onOpenThread,
}: {
  roder: Pick<RoderAgent, "workers" | "outbox" | "maxConcurrentWorkers" | "maxFollowups">;
  issues: Issue[];
  threads: Pick<RoderThread, "id" | "name" | "preview">[];
  /** Slice 7 seam: supervision events, when the backend reports them. */
  events?: RoderWorkerEvent[];
  onOpenThread: (threadId: string) => void;
}): React.JSX.Element {
  const groups = workerGroups(roder.workers, issues, events);
  if (!roder.workers.length)
    return (
      <p className="rounded-lg bg-muted/30 p-3 text-sm font-normal text-muted-foreground">
        No threads yet. The Roder delegates each issue to its own thread in a fresh worktree.
      </p>
    );
  const pending = new Set(roder.outbox.map((delivery) => delivery.threadId));
  const sections = [
    {
      key: "running",
      title: "Running",
      note: `${groups.running.length} of ${roder.maxConcurrentWorkers} at once`,
      rows: groups.running,
    },
    { key: "queued", title: "Queued", note: "Starts when a slot frees", rows: groups.queued },
    { key: "stopped", title: "Stopped", note: null, rows: groups.stopped },
  ] as const;
  return (
    <div className="space-y-4">
      {sections.map((section) =>
        section.rows.length || section.key === "running" ? (
          <section key={section.key} aria-label={`${section.title} threads`} className="space-y-1">
            <h3 className="flex items-baseline justify-between gap-2 px-2 font-semibold">
              <span>
                {section.title} <span className="text-sm font-medium text-muted-foreground">{section.rows.length}</span>
              </span>
              {section.note ? <span className="text-sm font-medium text-muted-foreground">{section.note}</span> : null}
            </h3>
            {section.rows.length ? (
              <ul className="space-y-0.5">
                {section.rows.map((row) => (
                  <WorkerRowItem
                    key={row.worker.threadId}
                    row={row}
                    threads={threads}
                    maxFollowups={roder.maxFollowups}
                    deliveryPending={pending.has(row.worker.threadId)}
                    onOpenThread={onOpenThread}
                  />
                ))}
              </ul>
            ) : (
              <p className="px-2 text-sm font-normal text-muted-foreground">No threads are running.</p>
            )}
          </section>
        ) : null,
      )}
    </div>
  );
}

function WorkerRowItem({
  row,
  threads,
  maxFollowups,
  deliveryPending,
  onOpenThread,
}: {
  row: WorkerRow;
  threads: Pick<RoderThread, "id" | "name" | "preview">[];
  maxFollowups: number;
  deliveryPending: boolean;
  onOpenThread: (threadId: string) => void;
}): React.JSX.Element {
  const { worker, issue, reason, attention } = row;
  const name = threadLabel(threads, worker.threadId);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpenThread(worker.threadId)}
        className="flex w-full min-w-0 items-start gap-3 rounded-xl px-2 py-2 text-left outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
      >
        {worker.state === "queued" ? (
          <span
            aria-label={`Queue position ${worker.queuePosition ?? "unknown"}`}
            className="mt-0.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-muted/50 px-1 text-sm"
          >
            {worker.queuePosition ?? "–"}
          </span>
        ) : (
          <span
            aria-hidden="true"
            className={cn(
              "mt-2 size-1.5 shrink-0 rounded-full",
              worker.state === "running" ? "bg-emerald-500" : attention ? "bg-amber-500" : "bg-muted-foreground/40",
            )}
          />
        )}
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="block truncate">{name === worker.threadId ? worker.objective || name : name}</span>
          <span className="block truncate text-sm font-normal text-muted-foreground">
            {issue ? `#${issue.number} ${issue.title} · ` : ""}
            <span className="font-mono">{worker.branch}</span>
          </span>
          {reason ? (
            <span
              className={cn(
                "block text-sm font-normal",
                attention ? "text-amber-700 dark:text-amber-500" : "text-muted-foreground",
              )}
            >
              {reason}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-right text-sm text-muted-foreground">
          {worker.state === "queued" ? `#${worker.queuePosition ?? "–"} in queue` : null}
          {worker.state === "running" ? "Running" : null}
          {worker.state === "idle" ? `${worker.followups}/${maxFollowups} follow-ups` : null}
          {deliveryPending ? <span className="block">Delivery pending</span> : null}
        </span>
      </button>
    </li>
  );
}

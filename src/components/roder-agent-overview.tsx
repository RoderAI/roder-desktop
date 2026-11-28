import { GitPullRequest, MessageSquareMore } from "lucide-react";
import { RoderAgentAvatar } from "@/components/roder-agent-avatar";
import { issueStatusDot, issueStatusLabel, pullRequestLabel, threadLabel } from "@/components/roder-issue-conversation";
import { Button } from "@/components/ui/button";
import { boardPullRequests, needsYouItems, statusCounts, workerGroups, type RoderWorkerEvent } from "@/lib/roder-board";
import { cn } from "@/lib/utils";
import type { Issue, IssueProject } from "@/types/issues";
import type { RoderThread } from "@/types/roder";
import type { RoderAgent } from "@/types/roder-agents";

export type RoderAgentTab = "overview" | "issues" | "threads" | "files" | "settings";

const rowClass =
  "flex w-full min-w-0 items-center gap-3 rounded-xl px-2 py-1.5 text-left outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring";

export function roderActivityLabel(roder: Pick<RoderAgent, "active" | "enabled">, running: number): string {
  if (running) return running === 1 ? "1 thread working" : `${running} threads working`;
  if (roder.active) return "Running";
  return roder.enabled ? "Enabled" : "Paused";
}

/** The Overview tab: what needs the user first, then the board, threads and pull requests. */
export function RoderAgentOverview({
  roder,
  project,
  issues,
  threads,
  events,
  onOpenIssue,
  onShowTab,
  onOpenThread,
  onOpenPullRequest,
}: {
  roder: RoderAgent;
  project: IssueProject | null;
  issues: Issue[];
  threads: Pick<RoderThread, "id" | "name" | "preview">[];
  events?: RoderWorkerEvent[];
  onOpenIssue: (issueId: string, options?: { answer?: boolean }) => void;
  onShowTab: (tab: RoderAgentTab) => void;
  onOpenThread: (threadId: string) => void;
  onOpenPullRequest: (url: string) => void;
}): React.JSX.Element {
  const asks = needsYouItems(issues);
  const counts = statusCounts(issues);
  const workers = workerGroups(roder.workers, issues, events);
  const pullRequests = boardPullRequests(issues);
  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <RoderAgentAvatar id={roder.id} sprite={roder.sprite} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{roder.name}</h2>
          <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                roder.enabled || workers.running.length ? "bg-emerald-500" : "bg-muted-foreground/40",
              )}
            />
            <span className="shrink-0">{roderActivityLabel(roder, workers.running.length)}</span>
            {roder.mission ? <span className="truncate font-normal">· {roder.mission}</span> : null}
          </p>
        </div>
      </header>

      {!project ? (
        <p className="rounded-lg bg-muted/30 p-3 text-sm font-normal text-muted-foreground">
          No issue board is linked to this Roder yet. Link a project to its thread on the Issues page.
        </p>
      ) : null}

      {asks.length ? (
        <section aria-label="Needs you" className="space-y-1">
          <h3 className="flex items-center gap-2 px-2 font-semibold">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-amber-500" />
            Needs you
            <span className="text-sm font-medium text-muted-foreground">{asks.length}</span>
          </h3>
          <ul className="space-y-1">
            {asks.map(({ issue, question }) => (
              <li key={issue.id} className="flex items-start gap-3 rounded-xl px-2 py-2 ring-1 ring-amber-500/40">
                <MessageSquareMore aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate">
                    <span className="mr-2 text-sm text-muted-foreground">#{issue.number}</span>
                    {issue.title}
                  </p>
                  <p className="line-clamp-2 text-sm font-normal text-muted-foreground">
                    {question?.text ?? "Waiting on you."}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 rounded-lg"
                  onClick={() => onOpenIssue(issue.id, { answer: true })}
                >
                  Answer
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {project ? (
        <section aria-label="Issues by status" className="space-y-1">
          <h3 className="px-2 font-semibold">Issues</h3>
          {counts.length ? (
            <ul className="grid gap-1 sm:grid-cols-2">
              {counts.map(({ status, count }) => (
                <li key={status}>
                  <button type="button" className={rowClass} onClick={() => onShowTab("issues")}>
                    <span aria-hidden="true" className={cn("size-1.5 rounded-full", issueStatusDot(status))} />
                    <span className="flex-1">{issueStatusLabel(status)}</span>
                    <span className="text-sm text-muted-foreground">{count}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 text-sm font-normal text-muted-foreground">
              No issues yet. Ask the Roder to plan work, or add one on the Issues page.
            </p>
          )}
        </section>
      ) : null}

      <section aria-label="Threads summary" className="space-y-1">
        <h3 className="flex items-center justify-between gap-2 px-2 font-semibold">
          Threads
          <span className="text-sm font-medium text-muted-foreground">
            {workers.running.length} running · {workers.queued.length} queued · {workers.stopped.length} stopped
          </span>
        </h3>
        {workers.running.length + workers.queued.length ? (
          <ul className="space-y-0.5">
            {[...workers.running, ...workers.queued].map(({ worker, issue }) => (
              <li key={worker.threadId}>
                <button type="button" className={rowClass} onClick={() => onOpenThread(worker.threadId)}>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      worker.state === "running" ? "bg-emerald-500" : "bg-muted-foreground/40",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{threadLabel(threads, worker.threadId)}</span>
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {issue ? `#${issue.number} · ` : ""}
                    {worker.state === "queued" ? `Queued ${worker.queuePosition ?? ""}`.trim() : "Running"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-2 text-sm font-normal text-muted-foreground">No threads are working right now.</p>
        )}
        {roder.workers.length ? (
          <Button variant="ghost" size="sm" className="rounded-lg" onClick={() => onShowTab("threads")}>
            All threads
          </Button>
        ) : null}
      </section>

      {pullRequests.length ? (
        <section aria-label="Pull requests" className="space-y-1">
          <h3 className="px-2 font-semibold">Pull requests</h3>
          <ul className="space-y-0.5">
            {pullRequests.map(({ issue, url, title }) => (
              <li key={`${issue.id}:${url}`}>
                <button type="button" title={url} className={rowClass} onClick={() => onOpenPullRequest(url)}>
                  <GitPullRequest aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{pullRequestLabel({ url, title })}</span>
                  <span className="shrink-0 text-sm text-muted-foreground">
                    #{issue.number} · {issueStatusLabel(issue.status)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

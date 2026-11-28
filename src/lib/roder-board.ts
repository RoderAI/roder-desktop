import { issuesIpc } from "@/lib/issues-ipc";
import { issueStatuses, type Issue, type IssueActivity, type IssueProject, type IssueStatus } from "@/types/issues";
import type { RoderAgent, RoderWorker } from "@/types/roder-agents";

/**
 * Seam for slice 7 (supervision events). The backend does not report these
 * yet; when a caller passes none, the UI shows only what the worker registry
 * knows. Shape follows the planned `RoderEvent` (plan section 1.7).
 */
export type RoderWorkerEventKind = "settled" | "failed" | "interrupted" | "needsInput";
export type RoderWorkerEvent = {
  id: string;
  threadId: string;
  kind: RoderWorkerEventKind;
  /** The report or error, already capped by the backend. */
  summary: string;
  at: number;
  acknowledged: boolean;
};

/** The Roder's board: the project linked to its thread, preferring one that is not archived. */
export function roderBoard(
  roder: Pick<RoderAgent, "threadId">,
  projects: IssueProject[],
  issues: Issue[],
): { project: IssueProject | null; issues: Issue[] } {
  const linked = projects.filter((project) => project.roderThreadId === roder.threadId);
  const project = linked.find((entry) => !entry.archived) ?? linked[0] ?? null;
  return { project, issues: project ? issues.filter((issue) => issue.projectId === project.id) : [] };
}

/** The question an issue waits on: its newest question entry. */
export function openQuestion(issue: Issue): IssueActivity | null {
  if (issue.status !== "needs_you") return null;
  return issue.activity.findLast((entry) => entry.kind === "question") ?? null;
}

export type NeedsYouItem = { issue: Issue; question: IssueActivity | null };

/** Issues waiting on the user, oldest question first so nothing waits longest unseen. */
export function needsYouItems(issues: Issue[]): NeedsYouItem[] {
  return issues
    .filter((issue) => issue.status === "needs_you")
    .map((issue) => ({ issue, question: openQuestion(issue) }))
    .sort((a, b) =>
      (a.question?.createdAt ?? a.issue.updatedAt).localeCompare(b.question?.createdAt ?? b.issue.updatedAt),
    );
}

/** How many of a Roder's issues wait on the user, for its sidebar row. */
export function roderNeedsYouCount(
  roder: Pick<RoderAgent, "threadId">,
  projects: IssueProject[],
  issues: Issue[],
): number {
  return roderBoard(roder, projects, issues).issues.filter((issue) => issue.status === "needs_you").length;
}

/** Issue counts by status in lifecycle order, skipping empty statuses. */
export function statusCounts(issues: Issue[]): { status: IssueStatus; count: number }[] {
  return issueStatuses
    .map((status) => ({ status, count: issues.filter((issue) => issue.status === status).length }))
    .filter((entry) => entry.count > 0);
}

/** Every linked pull request with the issue that carries it, newest issue activity first. */
export function boardPullRequests(issues: Issue[]): { issue: Issue; url: string; title: string }[] {
  return [...issues]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .flatMap((issue) => issue.pullRequests.map((pr) => ({ issue, url: pr.url, title: pr.title })));
}

export type WorkerRow = {
  worker: RoderWorker;
  issue: Issue | null;
  /** Why a stopped thread stopped; null for running and queued threads. */
  reason: string | null;
  /** True when the reason needs the user, such as a hold or a failure. */
  attention: boolean;
};

const eventReason: Record<RoderWorkerEventKind, { text: string; attention: boolean }> = {
  settled: { text: "Finished its turn", attention: false },
  failed: { text: "Turn failed", attention: true },
  interrupted: { text: "Interrupted", attention: true },
  needsInput: { text: "Waiting for input", attention: true },
};

function stopReason(worker: RoderWorker, event: RoderWorkerEvent | undefined): { text: string; attention: boolean } {
  if (worker.hold === "user")
    return { text: "Stopped by you. The Roder needs you before it messages this thread again.", attention: true };
  if (worker.hold === "roder") return { text: "Stopped by the Roder", attention: false };
  if (worker.lastError) return { text: worker.lastError, attention: true };
  if (event) {
    const known = eventReason[event.kind];
    return { text: event.summary ? `${known.text}: ${event.summary}` : known.text, attention: known.attention };
  }
  return { text: "Its last turn ended", attention: false };
}

/**
 * The Threads tab: running threads, the queue in start order, then stopped
 * threads with why they stopped. `events` is the slice 7 seam; without it the
 * reason comes from the worker registry alone.
 */
export function workerGroups(
  workers: RoderWorker[],
  issues: Issue[],
  events: RoderWorkerEvent[] = [],
): { running: WorkerRow[]; queued: WorkerRow[]; stopped: WorkerRow[] } {
  const row = (worker: RoderWorker, reason: { text: string; attention: boolean } | null): WorkerRow => ({
    worker,
    issue: issues.find((issue) => issue.id === worker.issueId) ?? null,
    reason: reason?.text ?? null,
    attention: reason?.attention ?? false,
  });
  const latestEvent = (threadId: string) =>
    events.filter((event) => event.threadId === threadId).sort((a, b) => b.at - a.at)[0];
  return {
    running: workers.filter((worker) => worker.state === "running").map((worker) => row(worker, null)),
    queued: workers
      .filter((worker) => worker.state === "queued")
      .sort((a, b) => (a.queuePosition ?? Infinity) - (b.queuePosition ?? Infinity))
      .map((worker) => row(worker, null)),
    stopped: workers
      .filter((worker) => worker.state === "idle")
      .sort((a, b) => b.delegatedAt - a.delegatedAt)
      .map((worker) => row(worker, stopReason(worker, latestEvent(worker.threadId)))),
  };
}

export type TimelineItem =
  | { type: "card"; entry: IssueActivity }
  | { type: "event"; entry: IssueActivity }
  | { type: "group"; entries: IssueActivity[] };

/** Runs of at least this many quiet entries fold into one line. */
const FOLD = 3;
const isDiscussion = (entry: IssueActivity) => entry.kind === "comment" || entry.kind === "question";
/** A quiet entry that still needs to be seen, so it never folds. */
const needsAttention = (entry: IssueActivity) =>
  entry.changes?.some((change) => change.field === "status" && /needs_you|blocked/.test(change.after ?? "")) ??
  /Needs you|Blocked/.test(entry.text);

/**
 * How an issue's activity reads as a conversation: comments and questions as
 * cards, quiet audit entries as rows, and longer runs of them folded.
 */
export function issueTimeline(activity: IssueActivity[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  let run: IssueActivity[] = [];
  const flush = () => {
    if (run.length >= FOLD) items.push({ type: "group", entries: run });
    else items.push(...run.map((entry) => ({ type: "event" as const, entry })));
    run = [];
  };
  for (const entry of activity) {
    if (isDiscussion(entry)) {
      flush();
      items.push({ type: "card", entry });
    } else if (needsAttention(entry)) {
      flush();
      items.push({ type: "event", entry });
    } else run.push(entry);
  }
  flush();
  return items;
}

/** Who an answer hands the issue back to, mirroring the service rule: the newest linked thread, else the Roder. */
export function handBackTarget(
  issue: Pick<Issue, "threadIds">,
): { type: "thread"; threadId: string } | { type: "roder" } {
  const threadId = issue.threadIds.at(-1);
  return threadId ? { type: "thread", threadId } : { type: "roder" };
}

/**
 * Answer a needs-you question. It is a user comment; the issue service hands
 * the issue back when a person comments on an issue that waits on them.
 */
export async function answerIssue(issueId: string, text: string): Promise<Issue> {
  const answer = text.trim();
  if (!answer) throw new Error("Write an answer first");
  return (await issuesIpc.commentIssue(issueId, answer)).issue;
}

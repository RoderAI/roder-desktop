import type { RoderNotification } from "@/types/roder";

const accountingEvents = new Set([
  "turn/completed",
  "turn/subagentTraceCreated",
  "turn/subagentTraceCompleted",
  "turn/subagentTraceFailed",
  "team/member/completed",
]);

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function shouldRefreshThreadAccounting(
  notification: RoderNotification,
  trackedIds: ReadonlySet<string>,
): boolean {
  if (!accountingEvents.has(notification.method)) return false;
  // A newly finished team member may not be in the descendant index yet.
  if (notification.method === "team/member/completed") return true;
  const params = record(notification.params);
  const summary = record(params.summary);
  const parent = record(params.parent);
  const summaryParent = record(summary.parent);
  const ids = [
    params.threadId,
    params.thread_id,
    params.childThreadId,
    params.child_thread_id,
    parent.threadId,
    parent.thread_id,
    summary.childThreadId,
    summaryParent.threadId,
    summaryParent.thread_id,
  ].filter((id): id is string => typeof id === "string" && Boolean(id));
  return ids.length === 0 || ids.some((id) => trackedIds.has(id));
}

export function createThreadAccountingRefreshScheduler(refresh: () => void): {
  schedule: () => void;
  dispose: () => void;
} {
  let immediate: ReturnType<typeof setTimeout> | undefined;
  let settled: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  return {
    schedule() {
      if (disposed) return;
      clearTimeout(immediate);
      clearTimeout(settled);
      immediate = setTimeout(refresh, 250);
      // Analytics are persisted asynchronously after the terminal notification.
      settled = setTimeout(refresh, 1500);
    },
    dispose() {
      disposed = true;
      clearTimeout(immediate);
      clearTimeout(settled);
    },
  };
}

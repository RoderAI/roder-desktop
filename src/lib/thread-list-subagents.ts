import type { SubagentTraceView } from "@/types/roder";

export function subagentThreadShortcuts(traces: readonly SubagentTraceView[]): SubagentTraceView[] {
  const byChild = new Map<string, SubagentTraceView>();
  for (const trace of traces) {
    if (!trace.childThreadId) continue;
    const previous = byChild.get(trace.childThreadId);
    if (!previous || previous.updatedAt < trace.updatedAt) byChild.set(trace.childThreadId, trace);
  }
  return [...byChild.values()].toSorted((left, right) => right.updatedAt - left.updatedAt);
}

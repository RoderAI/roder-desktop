import type { RoderThread, SubagentTraceSummary, Workspace } from "@/types/roder";

export type ThreadListFilters = { search: string; status: string; project: string };

export async function loadThreadListTraces(
  threadId: string,
  api: {
    readThread: (threadId: string) => Promise<{ thread: RoderThread | null }>;
    listSubagentTraces: (threadId: string, turnId: string) => Promise<{ traces: SubagentTraceSummary[] }>;
  },
): Promise<SubagentTraceSummary[]> {
  const { thread } = await api.readThread(threadId);
  if (!thread) throw new Error("Thread is no longer available");
  const turnIds = [
    ...new Set([
      ...(thread.turns ?? []).map((turn) => turn.id),
      ...(thread.status.activeTurnId ? [thread.status.activeTurnId] : []),
    ]),
  ];
  const byId = new Map<string, SubagentTraceSummary>();
  for (let offset = 0; offset < turnIds.length; offset += 4) {
    const pages = await Promise.all(
      turnIds.slice(offset, offset + 4).map((turnId) => api.listSubagentTraces(threadId, turnId)),
    );
    for (const page of pages) {
      for (const trace of page.traces) byId.set(trace.traceId, trace);
    }
  }
  return [...byId.values()];
}

export async function discoverThreadListTraces(
  threadIds: string[],
  api: Parameters<typeof loadThreadListTraces>[1],
  onLoaded: (threadId: string, traces: SubagentTraceSummary[]) => void,
  onError: (threadId: string, error: unknown) => void,
  isActive: () => boolean = () => true,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, threadIds.length) }, async () => {
      while (isActive() && next < threadIds.length) {
        const threadId = threadIds[next++];
        try {
          const traces = await loadThreadListTraces(threadId, api);
          if (isActive()) onLoaded(threadId, traces);
        } catch (error) {
          if (isActive()) onError(threadId, error);
        }
      }
    }),
  );
}

export function threadListProject(thread: RoderThread, workspaces: Workspace[]): Workspace | undefined {
  return (
    workspaces.find((workspace) => workspace.id === thread.workspaceId) ??
    workspaces.find((workspace) =>
      workspace.roots.some((root) => root.path.replace(/\/+$/u, "") === thread.cwd.replace(/\/+$/u, "")),
    )
  );
}

export function threadListStatus(thread: RoderThread): string {
  if (
    thread.status.activeFlags.some((flag) =>
      ["approvalRequired", "userInputRequired", "planExitRequired"].includes(flag),
    )
  )
    return "waiting";
  return thread.status.type;
}

export function traceListStatus(trace: SubagentTraceSummary): string {
  return trace.status === "waiting_for_approval" ? "waiting" : trace.status;
}

export function filterThreadList(
  threads: RoderThread[],
  tracesByThread: Record<string, SubagentTraceSummary[]>,
  workspaces: Workspace[],
  filters: ThreadListFilters,
): RoderThread[] {
  const search = filters.search.trim().toLocaleLowerCase();
  return threads
    .filter((thread) => {
      const project = threadListProject(thread, workspaces);
      if (filters.project && project?.id !== filters.project) return false;
      const metadata = [
        thread.id,
        thread.name,
        thread.preview,
        thread.model,
        thread.modelProvider,
        thread.cwd,
        project?.name,
      ]
        .join(" ")
        .toLocaleLowerCase();
      const matchesThread =
        (!search || metadata.includes(search)) && (!filters.status || threadListStatus(thread) === filters.status);
      if (matchesThread) return true;
      return (tracesByThread[thread.id] ?? []).some(
        (trace) =>
          (!filters.status || traceListStatus(trace) === filters.status) &&
          (!search ||
            [metadata, trace.title, trace.role, trace.childThreadId, trace.model, trace.latestActivity]
              .join(" ")
              .toLocaleLowerCase()
              .includes(search)),
      );
    })
    .toSorted((left, right) => right.updatedAt - left.updatedAt);
}

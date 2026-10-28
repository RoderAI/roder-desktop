import { messagesFromThread } from "@/lib/roder-thread";
import { useRoderStore } from "@/stores/roder-store";

async function waitForNavigationWork(work: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return work;
  if (signal.aborted) return;
  let abort = () => {};
  const cancelled = new Promise<void>((resolve) => {
    abort = resolve;
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    await Promise.race([work, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export async function loadTranscriptNavigationMessage(
  threadId: string,
  messageId: string,
  isCancelled: () => boolean = () => false,
  signal?: AbortSignal,
): Promise<void> {
  const requestId = useRoderStore.getState().threadHistoryByThread[threadId]?.requestId;
  const seen = new Set<string>();
  while (!isCancelled() && !signal?.aborted) {
    const state = useRoderStore.getState();
    const history = state.threadHistoryByThread[threadId];
    if (state.activeThreadId !== threadId || !history || history.requestId !== requestId) return;
    if (messagesFromThread(state.threadDetails[threadId]).some((message) => message.id === messageId)) return;
    if (history.loading || history.loadingOlder) {
      let unsubscribe = () => {};
      const waiting = new Promise<void>((resolve) => {
        unsubscribe = useRoderStore.subscribe((next) => {
          const latest = next.threadHistoryByThread[threadId];
          if (
            next.activeThreadId !== threadId ||
            latest?.requestId !== requestId ||
            (!latest.loading && !latest.loadingOlder)
          ) {
            unsubscribe();
            resolve();
          }
        });
      });
      try {
        await waitForNavigationWork(waiting, signal);
      } finally {
        unsubscribe();
      }
      const latestState = useRoderStore.getState();
      const latest = latestState.threadHistoryByThread[threadId];
      if (
        !isCancelled() &&
        !signal?.aborted &&
        latestState.activeThreadId === threadId &&
        latest?.requestId === requestId &&
        latest.error
      )
        throw new Error(latest.error);
      continue;
    }
    if (!history.hasMore || !history.before || seen.has(history.before)) {
      throw new Error("This message is no longer available in the thread history.");
    }
    seen.add(history.before);
    await waitForNavigationWork(state.loadOlderThreadHistory(threadId), signal);
    const latestState = useRoderStore.getState();
    const latest = latestState.threadHistoryByThread[threadId];
    if (isCancelled() || signal?.aborted || latestState.activeThreadId !== threadId || latest?.requestId !== requestId)
      return;
    if (latest?.error) throw new Error(latest.error);
  }
}

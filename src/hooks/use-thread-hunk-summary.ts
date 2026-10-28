import { useEffect, useState } from "react";
import { roderIpc } from "@/lib/roder-ipc";
import { summarizeReviewChanges, type ReviewTurnChangeSummary } from "@/lib/review-changes";
import { loadThreadHunks, threadHunkScopeKey } from "@/lib/thread-hunk-loading";
import type { HunkRecord, WorkspaceChangeObservation } from "@/types/roder";

export type ThreadHunkSummary = {
  fileCount: number;
  latestTurnId: string;
  turnChangeCounts: Record<string, number>;
  turnChangeSummaries: Record<string, ReviewTurnChangeSummary>;
  hunks: HunkRecord[];
  observedChanges: WorkspaceChangeObservation[];
  loading: boolean;
  error: string | null;
};

const emptySummary: ThreadHunkSummary = {
  fileCount: 0,
  latestTurnId: "",
  turnChangeCounts: {},
  turnChangeSummaries: {},
  hunks: [],
  observedChanges: [],
  loading: false,
  error: null,
};

type ThreadHunkSummaryState = ThreadHunkSummary & {
  hunkRevision: number;
  threadId: string;
  scopeKey: string;
};

export function useThreadHunkSummary(
  threadId: string,
  hunkRevision: number,
  turnIds: readonly string[] | undefined,
): ThreadHunkSummary {
  const scopeKey = threadHunkScopeKey(turnIds);
  const hasScope = scopeKey !== "[]";
  const [summaryState, setSummaryState] = useState<ThreadHunkSummaryState | null>(null);
  const summary =
    summaryState?.threadId === threadId &&
    summaryState.hunkRevision === hunkRevision &&
    summaryState.scopeKey === scopeKey
      ? summaryState
      : { ...emptySummary, loading: Boolean(threadId) && hasScope };

  useEffect(() => {
    if (!threadId || !hasScope) {
      return;
    }

    let disposed = false;
    void loadThreadHunks(roderIpc, threadId, scopeKey, () => disposed)
      .then(({ hunks, observedChanges }) => {
        if (disposed) {
          return;
        }
        const metadata = summarizeReviewChanges(hunks, observedChanges);
        setSummaryState({
          ...metadata,
          hunkRevision,
          threadId,
          scopeKey,
          hunks,
          observedChanges,
          loading: false,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        setSummaryState({
          ...emptySummary,
          hunkRevision,
          threadId,
          scopeKey,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      disposed = true;
    };
  }, [hasScope, hunkRevision, scopeKey, threadId]);

  return summary;
}

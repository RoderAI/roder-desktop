import { useEffect, useState } from "react";
import { roderIpc } from "@/lib/roder-ipc";
import { summarizeReviewChanges } from "@/lib/review-changes";
import type { HunkRecord, WorkspaceChangeObservation } from "@/types/roder";

export type ThreadHunkSummary = {
  fileCount: number;
  latestTurnId: string;
  turnChangeCounts: Record<string, number>;
  hunks: HunkRecord[];
  observedChanges: WorkspaceChangeObservation[];
  loading: boolean;
  error: string | null;
};

const emptySummary: ThreadHunkSummary = {
  fileCount: 0,
  latestTurnId: "",
  turnChangeCounts: {},
  hunks: [],
  observedChanges: [],
  loading: false,
  error: null,
};

type ThreadHunkSummaryState = ThreadHunkSummary & {
  hunkRevision: number;
  threadId: string;
};

export function useThreadHunkSummary(threadId: string, hunkRevision = 0): ThreadHunkSummary {
  const [summaryState, setSummaryState] = useState<ThreadHunkSummaryState | null>(null);
  const summary =
    summaryState?.threadId === threadId && summaryState.hunkRevision === hunkRevision
      ? summaryState
      : { ...emptySummary, loading: Boolean(threadId) };

  useEffect(() => {
    if (!threadId) {
      return;
    }

    let disposed = false;
    void Promise.all([roderIpc.listHunks(threadId), listObservedChanges(threadId)])
      .then(([hunkResult, observedResult]) => {
        if (disposed) {
          return;
        }
        const metadata = summarizeReviewChanges(hunkResult.hunks, observedResult.changes);
        setSummaryState({
          ...metadata,
          hunkRevision,
          threadId,
          hunks: hunkResult.hunks,
          observedChanges: observedResult.changes,
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
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      disposed = true;
    };
  }, [hunkRevision, threadId]);

  return summary;
}

async function listObservedChanges(threadId: string): Promise<{ changes: WorkspaceChangeObservation[] }> {
  try {
    return await roderIpc.listWorkspaceChanges(threadId);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Method not found")) {
      return { changes: [] };
    }
    throw error;
  }
}

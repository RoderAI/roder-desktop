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

export function useThreadHunkSummary(threadId: string, hunkRevision = 0): ThreadHunkSummary {
  const [summary, setSummary] = useState<ThreadHunkSummary>(emptySummary);

  useEffect(() => {
    if (!threadId) {
      setSummary(emptySummary);
      return;
    }

    let disposed = false;
    setSummary((current) => ({ ...current, loading: true, error: null }));
    void Promise.all([roderIpc.listHunks(threadId), listObservedChanges(threadId)])
      .then(([hunkResult, observedResult]) => {
        if (disposed) {
          return;
        }
        const metadata = summarizeReviewChanges(hunkResult.hunks, observedResult.changes);
        setSummary({
          ...metadata,
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
        setSummary({
          ...emptySummary,
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

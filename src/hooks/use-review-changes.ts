import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { roderIpc } from "@/lib/roder-ipc";
import type { RouteReviewScope } from "@/lib/route-search";
import {
  groupHunksByFile,
  groupObservedChangesByFile,
  hunkPagesToReviewPatch,
  latestChangedTurnId,
  mergeReviewChangedFiles,
  reviewTurnIdCandidate,
} from "@/lib/review-changes";
import type {
  GitChangedFile,
  GitChangeStatus,
  HunkRecord,
  PagedHunkDiff,
  WorkspaceChangeObservation,
  WorkspaceObservedFile,
} from "@/types/roder";

const initialDiffLimit = 20_000;

export type ReviewFile = {
  path: string;
  oldPath?: string | null;
  status: GitChangeStatus;
  additions: number;
  deletions: number;
  binary?: boolean;
  hunks?: HunkRecord[];
  observedFiles?: WorkspaceObservedFile[];
  source?: "branch" | "hunk" | "observed" | "mixed";
};

export type ReviewListState =
  | { status: "idle"; files: ReviewFile[]; latestTurnId?: string }
  | { status: "loading"; files: ReviewFile[]; latestTurnId?: string }
  | {
      status: "ready";
      files: ReviewFile[];
      latestTurnId?: string;
      branch?: string | null;
      baseRef?: string | null;
      repositoryRoot?: string;
      truncated?: boolean;
    }
  | { status: "error"; files: ReviewFile[]; latestTurnId?: string; error: string };

export type ReviewDiffState =
  | { status: "idle"; patch: string }
  | { status: "loading"; patch: string }
  | { status: "ready"; patch: string; truncated: boolean; totalLines: number }
  | { status: "error"; patch: string; error: string };

type UseReviewChangesParams = {
  threadId: string;
  workspace: string;
  scope: RouteReviewScope;
  turnId: string;
  selectedPath: string;
  appServerMethods: string[];
  threadHunks: HunkRecord[];
  threadObservedChanges: WorkspaceChangeObservation[];
  threadLatestTurnId: string;
  onSelectedPathChange: (path: string) => void;
};

export function useReviewChanges({
  threadId,
  workspace,
  scope,
  turnId,
  selectedPath,
  appServerMethods,
  threadHunks,
  threadObservedChanges,
  threadLatestTurnId,
  onSelectedPathChange,
}: UseReviewChangesParams) {
  const [listState, setListState] = useState<ReviewListState>({ status: "idle", files: [] });
  const [diffState, setDiffState] = useState<ReviewDiffState>({ status: "idle", patch: "" });
  const [diffLimit, setDiffLimit] = useState(initialDiffLimit);
  const listRequestSeq = useRef(0);
  const diffRequestSeq = useRef(0);
  const files = listState.files;
  const branchReviewAvailable =
    appServerMethods.includes("git/changes/list") && appServerMethods.includes("git/changes/read");
  const scopedLatestTurnId = listState.latestTurnId ?? "";
  const effectiveTurnId = reviewTurnIdCandidate(turnId, scopedLatestTurnId, threadLatestTurnId);
  const selectedFile = useMemo(() => files.find((file) => file.path === selectedPath) ?? null, [files, selectedPath]);

  const loadFiles = useCallback(async () => {
    const requestSeq = (listRequestSeq.current += 1);
    const isCurrentRequest = () => listRequestSeq.current === requestSeq;
    setListState((state) => ({ status: "loading", files: state.files, latestTurnId: state.latestTurnId }));
    try {
      if (scope === "branch") {
        if (!branchReviewAvailable) {
          if (!isCurrentRequest()) {
            return;
          }
          setListState({
            status: "error",
            files: [],
            error:
              "Branch review needs a newer Roder app-server. Rebundle from the backend branch that includes git/changes/list.",
          });
          return;
        }
        if (!workspace) {
          throw new Error("No workspace is selected.");
        }
        const result = await roderIpc.listGitChanges(workspace);
        if (!isCurrentRequest()) {
          return;
        }
        setListState({
          status: "ready",
          files: result.files.map(reviewFileFromGit),
          branch: result.branch,
          baseRef: result.baseRef,
          repositoryRoot: result.repositoryRoot,
          truncated: Boolean(result.truncated),
        });
        return;
      }

      if (!threadId) {
        if (!isCurrentRequest()) {
          return;
        }
        setListState({ status: "ready", files: [] });
        return;
      }

      const selectedTurnId = turnId || threadLatestTurnId;
      const scopedHunks = scope === "turn" ? threadHunks.filter((hunk) => hunk.turnId === selectedTurnId) : threadHunks;
      const scopedObservedChanges =
        scope === "turn"
          ? threadObservedChanges.filter((change) => change.turnId === selectedTurnId)
          : threadObservedChanges;
      if (!isCurrentRequest()) {
        return;
      }
      setListState({
        status: "ready",
        files: mergeReviewChangedFiles(groupHunksByFile(scopedHunks), groupObservedChangesByFile(scopedObservedChanges)),
        latestTurnId: latestChangedTurnId(scopedHunks, scopedObservedChanges),
      });
    } catch (error) {
      if (!isCurrentRequest()) {
        return;
      }
      setListState((state) => ({
        status: "error",
        files: state.files,
        latestTurnId: state.latestTurnId,
        error: errorMessage(error),
      }));
    }
  }, [
    branchReviewAvailable,
    scope,
    threadHunks,
    threadId,
    threadLatestTurnId,
    threadObservedChanges,
    turnId,
    workspace,
  ]);

  const loadDiff = useCallback(async () => {
    const requestSeq = (diffRequestSeq.current += 1);
    const isCurrentRequest = () => diffRequestSeq.current === requestSeq;
    if (!selectedFile) {
      setDiffState({ status: "idle", patch: "" });
      return;
    }

    setDiffState((state) => ({ status: "loading", patch: state.patch }));
    try {
      if (scope === "branch" || selectedFile.source === "observed" || selectedFile.source === "mixed") {
        if (!branchReviewAvailable) {
          if (scope === "branch") {
            if (!isCurrentRequest()) {
              return;
            }
            setDiffState({ status: "idle", patch: "" });
            return;
          }
          throw new Error("Observed workspace changes need git/changes/read support from the app-server.");
        }
        if (!workspace) {
          if (selectedFile.source === "hunk") {
            throw new Error("No workspace is selected.");
          }
          throw new Error("Observed workspace changes need a selected workspace.");
        }
        if (scope === "branch" || selectedFile.observedFiles?.length) {
          const result = await roderIpc.readGitChange(workspace, selectedFile.path, { limit: diffLimit });
          if (!isCurrentRequest()) {
            return;
          }
          setDiffState({
            status: "ready",
            patch: result.patch,
            truncated: result.nextOffset != null,
            totalLines: result.totalLines,
          });
          return;
        }
      }

      if (!threadId) {
        if (!isCurrentRequest()) {
          return;
        }
        setDiffState({ status: "ready", patch: "", truncated: false, totalLines: 0 });
        return;
      }

      const pages = await Promise.all(
        (selectedFile.hunks ?? []).map(async (hunk) => {
          const result = await roderIpc.readHunk(threadId, hunk.id, { limit: diffLimit });
          return result.page ?? pageFromHunk(hunk);
        }),
      );
      const reviewPatch = hunkPagesToReviewPatch(pages);
      if (!isCurrentRequest()) {
        return;
      }
      setDiffState({ status: "ready", ...reviewPatch });
    } catch (error) {
      if (!isCurrentRequest()) {
        return;
      }
      setDiffState((state) => ({ status: "error", patch: state.patch, error: errorMessage(error) }));
    }
  }, [branchReviewAvailable, diffLimit, scope, selectedFile, threadId, workspace]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    if (listState.status !== "ready") {
      return;
    }
    const fallbackPath = files[0]?.path ?? "";
    const nextPath = files.some((file) => file.path === selectedPath) ? selectedPath : fallbackPath;
    if (nextPath !== selectedPath) {
      onSelectedPathChange(nextPath);
    }
  }, [files, listState.status, onSelectedPathChange, selectedPath]);

  useEffect(() => {
    void loadDiff();
  }, [loadDiff]);

  useEffect(() => {
    setDiffLimit(initialDiffLimit);
  }, [scope, selectedFile?.path]);

  const loadFullDiff = useCallback(() => {
    if (diffState.status === "ready") {
      setDiffLimit(Math.max(diffState.totalLines, initialDiffLimit));
    }
  }, [diffState]);

  return {
    branchReviewAvailable,
    diffState,
    effectiveTurnId,
    files,
    listState,
    loadDiff,
    loadFiles,
    loadFullDiff,
    selectedFile,
  };
}

function reviewFileFromGit(file: GitChangedFile): ReviewFile {
  return {
    path: file.path,
    oldPath: file.oldPath,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    binary: file.binary,
    source: "branch",
  };
}

function pageFromHunk(hunk: HunkRecord): PagedHunkDiff {
  return {
    hunk,
    offset: 0,
    limit: hunk.diff.length,
    totalLines: hunk.diff.length,
    lines: hunk.diff,
    nextOffset: null,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

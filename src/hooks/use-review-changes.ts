import { useCallback, useEffect, useRef, useState } from "react";
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

type LoadDiffOptions = {
  force?: boolean;
};

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
  const [diffStatesByPath, setDiffStatesByPath] = useState<Record<string, ReviewDiffState>>({});
  const [diffLimitsByPath, setDiffLimitsByPath] = useState<Record<string, number>>({});
  const listRequestSeq = useRef(0);
  const diffRequestSeq = useRef(0);
  const diffRequestSeqByPath = useRef(new Map<string, number>());
  const files = listState.files;
  const branchReviewAvailable =
    appServerMethods.includes("git/changes/list") && appServerMethods.includes("git/changes/read");
  const scopedLatestTurnId = listState.latestTurnId ?? "";
  const effectiveTurnId = reviewTurnIdCandidate(turnId, scopedLatestTurnId, threadLatestTurnId);

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
        files: mergeReviewChangedFiles(
          groupHunksByFile(scopedHunks),
          groupObservedChangesByFile(scopedObservedChanges),
        ),
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

  const readDiffForFile = useCallback(
    async (file: ReviewFile, limit: number): Promise<ReviewDiffState> => {
      if (scope === "branch" || file.source === "observed" || file.source === "mixed") {
        if (!branchReviewAvailable) {
          if (scope === "branch") {
            return { status: "idle", patch: "" };
          }
          throw new Error("Observed workspace changes need git/changes/read support from the app-server.");
        }
        if (!workspace) {
          if (file.source === "hunk") {
            throw new Error("No workspace is selected.");
          }
          throw new Error("Observed workspace changes need a selected workspace.");
        }
        if (scope === "branch" || file.observedFiles?.length) {
          const result = await roderIpc.readGitChange(workspace, file.path, { limit });
          return {
            status: "ready",
            patch: result.patch,
            truncated: result.nextOffset != null,
            totalLines: result.totalLines,
          };
        }
      }

      if (!threadId) {
        return { status: "ready", patch: "", truncated: false, totalLines: 0 };
      }

      const pages = await Promise.all(
        (file.hunks ?? []).map(async (hunk) => {
          const result = await roderIpc.readHunk(threadId, hunk.id, { limit });
          return result.page ?? pageFromHunk(hunk);
        }),
      );
      return { status: "ready", ...hunkPagesToReviewPatch(pages) };
    },
    [branchReviewAvailable, scope, threadId, workspace],
  );

  const loadDiffForFile = useCallback(
    async (file: ReviewFile, limit: number) => {
      const requestSeq = (diffRequestSeq.current += 1);
      diffRequestSeqByPath.current.set(file.path, requestSeq);
      setDiffStatesByPath((state) => ({
        ...state,
        [file.path]: { status: "loading", patch: state[file.path]?.patch ?? "" },
      }));
      try {
        const diffState = await readDiffForFile(file, limit);
        if (diffRequestSeqByPath.current.get(file.path) !== requestSeq) {
          return;
        }
        setDiffStatesByPath((state) => ({ ...state, [file.path]: diffState }));
      } catch (error) {
        if (diffRequestSeqByPath.current.get(file.path) !== requestSeq) {
          return;
        }
        setDiffStatesByPath((state) => ({
          ...state,
          [file.path]: { status: "error", patch: state[file.path]?.patch ?? "", error: errorMessage(error) },
        }));
      }
    },
    [readDiffForFile],
  );

  const loadDiff = useCallback(
    (path = selectedPath, options: LoadDiffOptions = {}) => {
      const file = files.find((candidate) => candidate.path === path);
      if (!file) {
        return;
      }
      const currentState = diffStatesByPath[path];
      if (!options.force && currentState && currentState.status !== "idle") {
        return;
      }
      void loadDiffForFile(file, diffLimitsByPath[path] ?? initialDiffLimit);
    },
    [diffLimitsByPath, diffStatesByPath, files, loadDiffForFile, selectedPath],
  );

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
    if (listState.status !== "ready") {
      return;
    }
    diffRequestSeqByPath.current.clear();
    setDiffLimitsByPath(Object.fromEntries(files.map((file) => [file.path, initialDiffLimit])));
    setDiffStatesByPath(Object.fromEntries(files.map((file) => [file.path, { status: "idle", patch: "" }])));
  }, [files, listState.status, scope]);

  const loadFullDiff = useCallback(
    (path = selectedPath) => {
      const file = files.find((candidate) => candidate.path === path);
      const diffState = diffStatesByPath[path];
      if (!file || diffState?.status !== "ready") {
        return;
      }
      const limit = Math.max(diffState.totalLines, initialDiffLimit);
      setDiffLimitsByPath((state) => ({ ...state, [path]: limit }));
      void loadDiffForFile(file, limit);
    },
    [diffStatesByPath, files, loadDiffForFile, selectedPath],
  );

  return {
    branchReviewAvailable,
    diffStatesByPath,
    effectiveTurnId,
    files,
    listState,
    loadDiff,
    loadFiles,
    loadFullDiff,
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

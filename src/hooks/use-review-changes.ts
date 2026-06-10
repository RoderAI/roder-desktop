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
  trimReviewPatchContext,
} from "@/lib/review-changes";
import { reviewBranchAreaFiles, type ReviewBranchAreaFilter } from "@/lib/review-panel-ui";
import type {
  HunkRecord,
  PagedHunkDiff,
  VcsChangeArea,
  VcsChangedFile,
  VcsChangeStatus,
  WorkspaceChangeObservation,
  WorkspaceObservedFile,
} from "@/types/roder";

const initialDiffLimit = 20_000;
const maxDiffCollectionCount = 2;
const emptyDiffLimitsByPath: Record<string, number> = {};

export type ReviewFile = {
  path: string;
  oldPath?: string | null;
  status: VcsChangeStatus;
  areas?: VcsChangeArea[];
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

type ReviewDiffCollection = {
  key: string;
  limitsByPath: Record<string, number>;
  statesByPath: Record<string, ReviewDiffState>;
};

type ReviewDiffCollectionsByKey = Record<string, ReviewDiffCollection>;

type LoadDiffOptions = {
  force?: boolean;
};

type UseReviewChangesParams = {
  threadId: string;
  workspaceId: string;
  rootId: string;
  scope: RouteReviewScope;
  branchAreaFilter: ReviewBranchAreaFilter;
  turnId: string;
  selectedPath: string;
  ignoreWhitespace: boolean;
  appServerMethods: string[];
  threadHunks: HunkRecord[];
  threadObservedChanges: WorkspaceChangeObservation[];
  threadLatestTurnId: string;
  onSelectedPathChange: (path: string) => void;
};

export function useReviewChanges({
  threadId,
  workspaceId,
  rootId,
  scope,
  branchAreaFilter,
  turnId,
  selectedPath,
  ignoreWhitespace,
  appServerMethods,
  threadHunks,
  threadObservedChanges,
  threadLatestTurnId,
  onSelectedPathChange,
}: UseReviewChangesParams) {
  const [listState, setListState] = useState<ReviewListState>({ status: "idle", files: [] });
  const [diffCollectionsByKey, setDiffCollectionsByKey] = useState<ReviewDiffCollectionsByKey>({});
  const listRequestSeq = useRef(0);
  const diffRequestSeq = useRef(0);
  const diffRequestSeqByPath = useRef<Map<string, number> | null>(null);
  if (!diffRequestSeqByPath.current) {
    diffRequestSeqByPath.current = new Map<string, number>();
  }
  const diffRequestsByPath = diffRequestSeqByPath.current;
  const files = listState.files;
  const diffCollectionKey = useMemo(
    () => reviewDiffCollectionKey(scope, files, ignoreWhitespace, branchAreaFilter),
    [branchAreaFilter, files, ignoreWhitespace, scope],
  );
  const activeDiffCollectionKeyRef = useRef(diffCollectionKey);
  activeDiffCollectionKeyRef.current = diffCollectionKey;
  const activeDiffCollection = diffCollectionsByKey[diffCollectionKey];
  const defaultDiffStatesByPath = useMemo(
    () => Object.fromEntries(files.map((file) => [file.path, { status: "idle", patch: "" } satisfies ReviewDiffState])),
    [files],
  );
  const diffStatesByPath = useMemo(
    () =>
      activeDiffCollection
        ? { ...defaultDiffStatesByPath, ...activeDiffCollection.statesByPath }
        : defaultDiffStatesByPath,
    [activeDiffCollection, defaultDiffStatesByPath],
  );
  const diffLimitsByPath = activeDiffCollection?.limitsByPath ?? emptyDiffLimitsByPath;
  const branchReviewAvailable =
    appServerMethods.includes("vcs/changes/list") && appServerMethods.includes("vcs/changes/read");
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
            error: "Branch review needs a Roder app-server with vcs/changes/list and vcs/changes/read support.",
          });
          return;
        }
        if (!workspaceId || !rootId) {
          throw new Error("No workspace is selected.");
        }
        if (!isCurrentRequest()) {
          return;
        }
        const result = await roderIpc.listVcsChanges({ workspaceId, id: rootId });
        if (!isCurrentRequest()) {
          return;
        }
        setListState({
          status: "ready",
          files: result.files.map(reviewFileFromVcs),
          branch: result.status.activeLine?.name ?? null,
          baseRef: result.status.base?.refName ?? null,
          repositoryRoot: result.status.workspace.root,
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
    workspaceId,
    rootId,
  ]);

  const readDiffForFile = useCallback(
    async (file: ReviewFile, limit: number): Promise<ReviewDiffState> => {
      if (scope === "branch" || file.source === "observed" || file.source === "mixed") {
        if (!branchReviewAvailable) {
          if (scope === "branch") {
            return { status: "idle", patch: "" };
          }
          throw new Error("Observed workspace changes need vcs/changes/read support from the app-server.");
        }
        if (!workspaceId || !rootId) {
          if (file.source === "hunk") {
            throw new Error("No workspace is selected.");
          }
          throw new Error("Observed workspace changes need a selected workspace.");
        }
        if (scope === "branch" || file.observedFiles?.length) {
          const result = await roderIpc.readVcsChange({ workspaceId, id: rootId }, file.path, {
            area: reviewFileReadArea(file, branchAreaFilter),
            ignoreWhitespace,
            limit,
          });
          return {
            status: "ready",
            patch: trimReviewPatchContext(result.content ?? ""),
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
    [branchAreaFilter, branchReviewAvailable, ignoreWhitespace, scope, threadId, workspaceId, rootId],
  );

  const loadDiffForFile = useCallback(
    async (file: ReviewFile, limit: number) => {
      const requestSeq = (diffRequestSeq.current += 1);
      const requestKey = diffRequestKey(diffCollectionKey, file.path);
      diffRequestsByPath.set(requestKey, requestSeq);
      setDiffCollectionsByKey((collections) => {
        return updateDiffCollection(
          collections,
          diffCollectionKey,
          activeDiffCollectionKeyRef.current,
          (currentCollection) => ({
            ...currentCollection,
            statesByPath: {
              ...currentCollection.statesByPath,
              [file.path]: { status: "loading", patch: currentCollection.statesByPath[file.path]?.patch ?? "" },
            },
          }),
        );
      });
      try {
        const diffState = await readDiffForFile(file, limit);
        if (diffRequestsByPath.get(requestKey) !== requestSeq) {
          return;
        }
        setDiffCollectionsByKey((collections) => {
          return updateExistingDiffCollection(
            collections,
            diffCollectionKey,
            activeDiffCollectionKeyRef.current,
            (currentCollection) => ({
              ...currentCollection,
              statesByPath: { ...currentCollection.statesByPath, [file.path]: diffState },
            }),
          );
        });
      } catch (error) {
        if (diffRequestsByPath.get(requestKey) !== requestSeq) {
          return;
        }
        setDiffCollectionsByKey((collections) => {
          return updateExistingDiffCollection(
            collections,
            diffCollectionKey,
            activeDiffCollectionKeyRef.current,
            (currentCollection) => ({
              ...currentCollection,
              statesByPath: {
                ...currentCollection.statesByPath,
                [file.path]: {
                  status: "error",
                  patch: currentCollection.statesByPath[file.path]?.patch ?? "",
                  error: errorMessage(error),
                },
              },
            }),
          );
        });
      }
    },
    [diffCollectionKey, diffRequestsByPath, readDiffForFile],
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
    const selectableFiles = scope === "branch" ? reviewBranchAreaFiles(files, branchAreaFilter) : files;
    const fallbackPath = selectableFiles[0]?.path ?? "";
    const nextPath = selectableFiles.some((file) => file.path === selectedPath) ? selectedPath : fallbackPath;
    if (nextPath !== selectedPath) {
      onSelectedPathChange(nextPath);
    }
  }, [branchAreaFilter, files, listState.status, onSelectedPathChange, scope, selectedPath]);

  const loadFullDiff = useCallback(
    (path = selectedPath) => {
      const file = files.find((candidate) => candidate.path === path);
      const diffState = diffStatesByPath[path];
      if (!file || diffState?.status !== "ready") {
        return;
      }
      const limit = Math.max(diffState.totalLines, initialDiffLimit);
      setDiffCollectionsByKey((collections) => {
        return updateDiffCollection(
          collections,
          diffCollectionKey,
          activeDiffCollectionKeyRef.current,
          (currentCollection) => ({
            ...currentCollection,
            limitsByPath: { ...currentCollection.limitsByPath, [path]: limit },
          }),
        );
      });
      void loadDiffForFile(file, limit);
    },
    [diffCollectionKey, diffStatesByPath, files, loadDiffForFile, selectedPath],
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

function reviewDiffCollectionKey(
  scope: RouteReviewScope,
  files: ReviewFile[],
  ignoreWhitespace: boolean,
  branchAreaFilter: ReviewBranchAreaFilter,
): string {
  // Diff state is only valid for the exact review scope and file identities that produced it.
  // The collection map is capped separately so old keys can keep one quick-toggle cache without retaining patches forever.
  return JSON.stringify([
    scope,
    ignoreWhitespace,
    scope === "branch" ? branchAreaFilter : "all",
    files.map((file) => [
      file.path,
      file.oldPath ?? "",
      file.status,
      file.additions,
      file.deletions,
      file.areas ?? [],
      Boolean(file.binary),
      file.source ?? "",
      file.hunks?.map((hunk) => hunk.id) ?? [],
      file.observedFiles?.map((observedFile) => [
        observedFile.path,
        observedFile.oldPath ?? "",
        observedFile.status,
        observedFile.additions,
        observedFile.deletions,
        observedFile.binary,
      ]) ?? [],
    ]),
  ]);
}

function reviewFileReadArea(file: ReviewFile, branchAreaFilter: ReviewBranchAreaFilter): VcsChangeArea | undefined {
  if (branchAreaFilter === "all") {
    return undefined;
  }
  const areas = file.areas ?? [];
  if (branchAreaFilter === "staged") {
    return areas.includes("staged") ? "staged" : undefined;
  }
  if (areas.includes("unstaged")) {
    return "unstaged";
  }
  if (areas.includes("untracked") || (!areas.length && file.status === "untracked")) {
    return "untracked";
  }
  return undefined;
}

function emptyDiffCollection(key: string): ReviewDiffCollection {
  return { key, limitsByPath: {}, statesByPath: {} };
}

function updateDiffCollection(
  collections: ReviewDiffCollectionsByKey,
  key: string,
  activeKey: string,
  update: (collection: ReviewDiffCollection) => ReviewDiffCollection,
): ReviewDiffCollectionsByKey {
  const currentCollection = collections[key] ?? emptyDiffCollection(key);
  const nextCollection = update(currentCollection);
  const withoutKey = Object.fromEntries(Object.entries(collections).filter(([collectionKey]) => collectionKey !== key));
  return pruneDiffCollections({ ...withoutKey, [key]: nextCollection }, activeKey);
}

function updateExistingDiffCollection(
  collections: ReviewDiffCollectionsByKey,
  key: string,
  activeKey: string,
  update: (collection: ReviewDiffCollection) => ReviewDiffCollection,
): ReviewDiffCollectionsByKey {
  if (!collections[key]) {
    return collections;
  }
  return updateDiffCollection(collections, key, activeKey, update);
}

function pruneDiffCollections(collections: ReviewDiffCollectionsByKey, activeKey: string): ReviewDiffCollectionsByKey {
  const entries = Object.entries(collections);
  if (entries.length <= maxDiffCollectionCount) {
    return collections;
  }
  const activeEntry = entries.find(([key]) => key === activeKey);
  if (!activeEntry) {
    return Object.fromEntries(entries.slice(-maxDiffCollectionCount));
  }
  const recentEntries = entries.filter(([key]) => key !== activeKey).slice(-(maxDiffCollectionCount - 1));
  return Object.fromEntries([...recentEntries, activeEntry]);
}

function diffRequestKey(collectionKey: string, path: string): string {
  return `${collectionKey}\u0000${path}`;
}

function reviewFileFromVcs(file: VcsChangedFile): ReviewFile {
  return {
    path: file.path,
    oldPath: file.oldPath,
    status: file.status,
    areas: file.areas ?? [],
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

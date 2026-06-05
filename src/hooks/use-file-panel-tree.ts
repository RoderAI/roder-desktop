import { useCallback, useRef, useState } from "react";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  filePanelReloadableDirectoryPaths,
  filePanelSelectionKey,
  filePanelStatusNeedsRebuild,
  mergeFilePanelIndexedPaths,
  workspaceFilesEntriesToIndexedPaths,
  type FilePanelDirectoryReadError,
  type FilePanelIndexedPath,
} from "@/lib/file-panel";
import { roderIpc } from "@/lib/roder-ipc";
import type { RoderNotification, WorkspaceFilesStatus, WorkspaceRoot } from "@/types/roder";

export type FilePanelTreeState =
  | { status: "unavailable"; indexedPaths: FilePanelIndexedPath[] }
  | { status: "empty"; indexedPaths: FilePanelIndexedPath[] }
  | { status: "loading"; indexedPaths: FilePanelIndexedPath[]; message?: string }
  | {
      status: "ready";
      indexedPaths: FilePanelIndexedPath[];
      filesStatus: WorkspaceFilesStatus;
      directoryErrors: FilePanelDirectoryReadError[];
    }
  | { status: "error"; indexedPaths: FilePanelIndexedPath[]; error: string };

export type UseFilePanelTreeParams = {
  workspaceId: string;
  roots: readonly WorkspaceRoot[];
  available: boolean;
};

type DirectoryChildrenReadResult =
  | { indexedPath: FilePanelIndexedPath; result: Awaited<ReturnType<typeof roderIpc.listWorkspaceFileChildren>> }
  | { indexedPath: FilePanelIndexedPath; error: unknown };

type DirectoryReadState = {
  indexedPaths: FilePanelIndexedPath[];
  filesStatus: WorkspaceFilesStatus;
  directoryErrors: FilePanelDirectoryReadError[];
};

export function useFilePanelTree({ workspaceId, roots, available }: UseFilePanelTreeParams): {
  state: FilePanelTreeState;
  refresh: () => void;
  loadDirectory: (indexedPath: FilePanelIndexedPath) => Promise<void>;
} {
  const [state, setState] = useState<FilePanelTreeState>(() => initialTreeState(workspaceId, roots, available));
  const requestSeq = useRef(0);
  const loadedDirectoryKeys = useRef(new Set<string>());
  const pendingDirectoryRequests = useRef(new Map<string, Promise<void>>());
  const rootChildrenRequest = useRef<{ requestId: number; promise: Promise<void> } | null>(null);

  const loadRootChildren = useCallback(
    async (requestId: number): Promise<void> => {
      const activeRootChildrenRequest = rootChildrenRequest.current;
      if (activeRootChildrenRequest?.requestId === requestId) {
        return activeRootChildrenRequest.promise;
      }

      const promise = (async () => {
        const rootResult = await roderIpc.listWorkspaceFileChildren({ workspaceId });
        if (requestSeq.current !== requestId) {
          return;
        }
        if (rootResult.status.state === "failed") {
          setState((current) => ({
            status: "error",
            indexedPaths: current.indexedPaths,
            error: rootResult.status.message || "Workspace file index failed.",
          }));
          return;
        }

        const previouslyLoadedDirectoryKeys = new Set(loadedDirectoryKeys.current);
        loadedDirectoryKeys.current.clear();
        pendingDirectoryRequests.current.clear();

        const directoryReadState = createDirectoryReadState(rootResult);
        const rootDirectoryResults = await readWorkspaceDirectories(
          workspaceId,
          loadableDirectories(directoryReadState.indexedPaths),
        );
        if (requestSeq.current !== requestId) {
          return;
        }
        mergeDirectoryReadResults(directoryReadState, rootDirectoryResults, loadedDirectoryKeys.current);

        const reloadCompleted = await reloadPreviouslyLoadedDirectories({
          workspaceId,
          requestIsCurrent: () => requestSeq.current === requestId,
          previouslyLoadedDirectoryKeys,
          loadedDirectoryKeys: loadedDirectoryKeys.current,
          directoryReadState,
        });
        if (!reloadCompleted) {
          return;
        }

        setState({
          status: "ready",
          indexedPaths: directoryReadState.indexedPaths,
          filesStatus: directoryReadState.filesStatus,
          directoryErrors: directoryReadState.directoryErrors,
        });
      })();

      rootChildrenRequest.current = { requestId, promise };
      const clearRootChildrenRequest = () => {
        if (rootChildrenRequest.current?.promise === promise) {
          rootChildrenRequest.current = null;
        }
      };
      void promise.then(clearRootChildrenRequest, clearRootChildrenRequest);
      return promise;
    },
    [workspaceId],
  );

  const handleStatus = useCallback(
    (status: WorkspaceFilesStatus, requestId: number): void => {
      if (requestSeq.current !== requestId) {
        return;
      }
      if (status.state === "failed") {
        setState((current) => ({
          status: "error",
          indexedPaths: current.indexedPaths,
          error: status.message || "Workspace file index failed.",
        }));
        return;
      }
      if (status.state === "ready" && !status.stale) {
        void loadRootChildren(requestId).catch((error: unknown) => {
          if (requestSeq.current !== requestId) {
            return;
          }
          setState((current) => ({
            status: "error",
            indexedPaths: current.indexedPaths,
            error: errorMessage(error),
          }));
        });
        return;
      }
      setState((current) => ({
        status: "loading",
        indexedPaths: current.indexedPaths,
        message: status.message || filePanelStatusMessage(status),
      }));
    },
    [loadRootChildren],
  );

  const loadWorkspace = useCallback(
    (forceRebuild: boolean): void => {
      const requestId = (requestSeq.current += 1);
      if (!available) {
        setState({ status: "unavailable", indexedPaths: [] });
        return;
      }
      if (!workspaceId || roots.length === 0) {
        setState({ status: "empty", indexedPaths: [] });
        return;
      }

      loadedDirectoryKeys.current.clear();
      pendingDirectoryRequests.current.clear();
      rootChildrenRequest.current = null;
      setState((current) => ({ status: "loading", indexedPaths: current.indexedPaths }));
      void roderIpc
        .workspaceFilesStatus({ workspaceId })
        .then(async (result) => {
          if (requestSeq.current !== requestId) {
            return;
          }
          if (forceRebuild || filePanelStatusNeedsRebuild(result.status)) {
            const rebuildResult = await roderIpc.rebuildWorkspaceFiles({ workspaceId });
            if (requestSeq.current !== requestId) {
              return;
            }
            if (rebuildResult.status) {
              handleStatus(rebuildResult.status, requestId);
              return;
            }
            const nextStatus = await roderIpc.workspaceFilesStatus({ workspaceId });
            handleStatus(nextStatus.status, requestId);
            return;
          }
          handleStatus(result.status, requestId);
        })
        .catch((error: unknown) => {
          if (requestSeq.current !== requestId) {
            return;
          }
          setState((current) => ({ status: "error", indexedPaths: current.indexedPaths, error: errorMessage(error) }));
        });
    },
    [available, handleStatus, roots.length, workspaceId],
  );

  const refresh = useCallback(() => loadWorkspace(true), [loadWorkspace]);

  const loadDirectory = useCallback(
    (indexedPath: FilePanelIndexedPath): Promise<void> => {
      if (indexedPath.kind !== "directory" || !indexedPath.hasChildren) {
        return Promise.resolve();
      }
      const directoryKey = filePanelSelectionKey(indexedPath);
      if (loadedDirectoryKeys.current.has(directoryKey)) {
        return Promise.resolve();
      }
      const pending = pendingDirectoryRequests.current.get(directoryKey);
      if (pending) {
        return pending;
      }

      const request = roderIpc
        .listWorkspaceFileChildren({
          workspaceId,
          rootId: indexedPath.rootId,
          path: indexedPath.relativePath,
        })
        .then((result) => {
          loadedDirectoryKeys.current.add(directoryKey);
          setState((current) => {
            if (current.status !== "ready") {
              return current;
            }
            return {
              status: "ready",
              indexedPaths: mergeFilePanelIndexedPaths(
                current.indexedPaths,
                workspaceFilesEntriesToIndexedPaths(result.entries),
              ),
              filesStatus: result.status,
              directoryErrors: current.directoryErrors.filter((error) => filePanelSelectionKey(error) !== directoryKey),
            };
          });
        })
        .catch((error: unknown) => {
          setState((current) => {
            if (current.status !== "ready") {
              return current;
            }
            return {
              ...current,
              directoryErrors: mergeDirectoryErrors(current.directoryErrors, {
                rootId: indexedPath.rootId,
                relativePath: indexedPath.relativePath,
                error: errorMessage(error),
              }),
            };
          });
        })
        .finally(() => {
          pendingDirectoryRequests.current.delete(directoryKey);
        });

      pendingDirectoryRequests.current.set(directoryKey, request);
      return request;
    },
    [workspaceId],
  );

  useMountEffect(() => {
    // FilePanelSession is keyed by workspace identity, so this mount-only subscription is scoped to one workspace.
    loadWorkspace(false);
    const offNotification = roderIpc.onNotification((notification) => {
      const status = workspaceFilesStatusChanged(notification);
      if (!status || status.workspaceId !== workspaceId) {
        return;
      }
      const requestId = requestSeq.current;
      handleStatus(status, requestId);
    });
    return () => {
      requestSeq.current += 1;
      loadedDirectoryKeys.current.clear();
      pendingDirectoryRequests.current.clear();
      rootChildrenRequest.current = null;
      offNotification();
    };
  });

  return { state, refresh, loadDirectory };
}

function createDirectoryReadState(
  rootResult: Awaited<ReturnType<typeof roderIpc.listWorkspaceFileChildren>>,
): DirectoryReadState {
  return {
    indexedPaths: workspaceFilesEntriesToIndexedPaths(rootResult.entries),
    filesStatus: rootResult.status,
    directoryErrors: [],
  };
}

function loadableDirectories(indexedPaths: readonly FilePanelIndexedPath[]): FilePanelIndexedPath[] {
  return indexedPaths.filter((indexedPath) => indexedPath.kind === "directory" && indexedPath.hasChildren);
}

async function readWorkspaceDirectories(
  workspaceId: string,
  directories: readonly FilePanelIndexedPath[],
): Promise<DirectoryChildrenReadResult[]> {
  return Promise.all(directories.map((indexedPath) => readWorkspaceDirectory(workspaceId, indexedPath)));
}

async function readWorkspaceDirectory(
  workspaceId: string,
  indexedPath: FilePanelIndexedPath,
): Promise<DirectoryChildrenReadResult> {
  try {
    return {
      indexedPath,
      result: await roderIpc.listWorkspaceFileChildren({
        workspaceId,
        rootId: indexedPath.rootId,
        path: indexedPath.relativePath || undefined,
      }),
    };
  } catch (error) {
    return { indexedPath, error };
  }
}

function mergeDirectoryReadResults(
  directoryReadState: DirectoryReadState,
  directoryResults: readonly DirectoryChildrenReadResult[],
  loadedDirectoryKeys: Set<string>,
): void {
  for (const directoryResult of directoryResults) {
    if ("error" in directoryResult) {
      directoryReadState.directoryErrors.push({
        rootId: directoryResult.indexedPath.rootId,
        relativePath: directoryResult.indexedPath.relativePath,
        error: errorMessage(directoryResult.error),
      });
      continue;
    }
    loadedDirectoryKeys.add(filePanelSelectionKey(directoryResult.indexedPath));
    directoryReadState.indexedPaths = mergeFilePanelIndexedPaths(
      directoryReadState.indexedPaths,
      workspaceFilesEntriesToIndexedPaths(directoryResult.result.entries),
    );
    directoryReadState.filesStatus = directoryResult.result.status;
  }
}

async function reloadPreviouslyLoadedDirectories({
  workspaceId,
  requestIsCurrent,
  previouslyLoadedDirectoryKeys,
  loadedDirectoryKeys,
  directoryReadState,
}: {
  workspaceId: string;
  requestIsCurrent: () => boolean;
  previouslyLoadedDirectoryKeys: ReadonlySet<string>;
  loadedDirectoryKeys: Set<string>;
  directoryReadState: DirectoryReadState;
}): Promise<boolean> {
  const attemptedReloadDirectoryKeys = new Set<string>();
  while (requestIsCurrent()) {
    const skippedDirectoryKeys = new Set([...loadedDirectoryKeys, ...attemptedReloadDirectoryKeys]);
    const directoriesToReload = filePanelReloadableDirectoryPaths(
      directoryReadState.indexedPaths,
      previouslyLoadedDirectoryKeys,
      skippedDirectoryKeys,
    );
    if (directoriesToReload.length === 0) {
      break;
    }
    for (const indexedPath of directoriesToReload) {
      attemptedReloadDirectoryKeys.add(filePanelSelectionKey(indexedPath));
    }
    const directoryResults = await readWorkspaceDirectories(workspaceId, directoriesToReload);
    if (!requestIsCurrent()) {
      return false;
    }
    mergeDirectoryReadResults(directoryReadState, directoryResults, loadedDirectoryKeys);
  }
  return true;
}

function initialTreeState(
  workspaceId: string,
  roots: readonly WorkspaceRoot[],
  available: boolean,
): FilePanelTreeState {
  if (!available) {
    return { status: "unavailable", indexedPaths: [] };
  }
  if (!workspaceId || roots.length === 0) {
    return { status: "empty", indexedPaths: [] };
  }
  return { status: "loading", indexedPaths: [] };
}

function workspaceFilesStatusChanged(notification: RoderNotification): WorkspaceFilesStatus | null {
  if (notification.method !== "workspace/files/statusChanged") {
    return null;
  }
  const params = notification.params;
  if (!params || typeof params !== "object" || !("status" in params)) {
    return null;
  }
  return (params as { status?: WorkspaceFilesStatus }).status ?? null;
}

function filePanelStatusMessage(status: WorkspaceFilesStatus): string {
  if (status.state === "building") {
    return "Building file index.";
  }
  if (status.state === "missing") {
    return "Preparing file index.";
  }
  if (status.state === "stale" || status.stale) {
    return "Refreshing file index.";
  }
  return "Loading workspace files.";
}

function mergeDirectoryErrors(
  currentErrors: readonly FilePanelDirectoryReadError[],
  nextError: FilePanelDirectoryReadError,
): FilePanelDirectoryReadError[] {
  return [
    ...currentErrors.filter((error) => filePanelSelectionKey(error) !== filePanelSelectionKey(nextError)),
    nextError,
  ];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to read workspace files.";
}

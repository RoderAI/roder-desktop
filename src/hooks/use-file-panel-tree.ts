import { useCallback, useRef, useState } from "react";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { filePanelShouldIndexDirectory, normalizeRelativePath, type FilePanelIndexedPath } from "@/lib/file-panel";
import { roderIpc } from "@/lib/roder-ipc";
import type { WorkspaceRoot } from "@/types/roder";

const defaultIndexedPathLimit = 2_500;

export type FilePanelTreeState =
  | { status: "unavailable"; indexedPaths: FilePanelIndexedPath[] }
  | { status: "empty"; indexedPaths: FilePanelIndexedPath[] }
  | { status: "loading"; indexedPaths: FilePanelIndexedPath[] }
  | { status: "ready"; indexedPaths: FilePanelIndexedPath[]; truncated: boolean }
  | { status: "error"; indexedPaths: FilePanelIndexedPath[]; error: string };

export type UseFilePanelTreeParams = {
  roots: readonly WorkspaceRoot[];
  available: boolean;
  indexedPathLimit?: number;
};

export function useFilePanelTree({
  roots,
  available,
  indexedPathLimit = defaultIndexedPathLimit,
}: UseFilePanelTreeParams): {
  state: FilePanelTreeState;
  refresh: () => void;
} {
  const [state, setState] = useState<FilePanelTreeState>(() => initialTreeState(roots, available));
  const requestSeq = useRef(0);
  const refresh = useCallback(() => {
    const requestId = (requestSeq.current += 1);
    if (!available) {
      setState({ status: "unavailable", indexedPaths: [] });
      return;
    }
    if (roots.length === 0) {
      setState({ status: "empty", indexedPaths: [] });
      return;
    }

    setState((current) => ({ status: "loading", indexedPaths: current.indexedPaths }));
    void indexWorkspaceRoots(roots, indexedPathLimit)
      .then((result) => {
        if (requestSeq.current !== requestId) {
          return;
        }
        setState({ status: "ready", indexedPaths: result.indexedPaths, truncated: result.truncated });
      })
      .catch((error: unknown) => {
        if (requestSeq.current !== requestId) {
          return;
        }
        setState((current) => ({ status: "error", indexedPaths: current.indexedPaths, error: errorMessage(error) }));
      });
  }, [available, indexedPathLimit, roots]);

  useMountEffect(() => {
    refresh();
  });

  return { state, refresh };
}

function initialTreeState(roots: readonly WorkspaceRoot[], available: boolean): FilePanelTreeState {
  if (!available) {
    return { status: "unavailable", indexedPaths: [] };
  }
  if (roots.length === 0) {
    return { status: "empty", indexedPaths: [] };
  }
  return { status: "loading", indexedPaths: [] };
}

async function indexWorkspaceRoots(
  roots: readonly WorkspaceRoot[],
  limit: number,
): Promise<{ indexedPaths: FilePanelIndexedPath[]; truncated: boolean }> {
  const indexedPaths: FilePanelIndexedPath[] = [];
  let truncated = false;

  for (const root of roots) {
    const queue = [""];
    while (queue.length > 0) {
      const relativeDirectoryPath = queue.shift() ?? "";
      const directoryPath = absolutePathForDirectory(root.path, relativeDirectoryPath);
      const result = await roderIpc.readDirectory(directoryPath);
      for (const entry of result.entries) {
        if (indexedPaths.length >= limit) {
          truncated = true;
          return { indexedPaths, truncated };
        }
        const relativePath = normalizeRelativePath([relativeDirectoryPath, entry.fileName].filter(Boolean).join("/"));
        if (!relativePath) {
          continue;
        }
        if (entry.isDirectory) {
          indexedPaths.push({ rootId: root.id, relativePath, kind: "directory" });
          if (filePanelShouldIndexDirectory(relativePath)) {
            queue.push(relativePath);
          }
        } else if (entry.isFile) {
          indexedPaths.push({ rootId: root.id, relativePath, kind: "file" });
        }
      }
    }
  }

  return { indexedPaths, truncated };
}

function absolutePathForDirectory(rootPath: string, relativePath: string): string {
  const root = rootPath.replace(/[\\/]+$/, "");
  return relativePath ? `${root}/${relativePath}` : root;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to read workspace files.";
}

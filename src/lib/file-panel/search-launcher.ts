import { filePanelRootItems, filePanelSelectionKey } from "@/lib/file-panel/tree";
import type { FilePanelIndexedPath, FilePanelRootItem } from "@/lib/file-panel/types";
import { workspaceFileEntryToIndexedPath } from "@/lib/file-panel/workspace";
import type { WorkspaceFilesQueryMatch, WorkspaceRoot } from "@/types/roder";

export type FilePanelSearchLauncherResult = {
  key: string;
  title: string;
  subtitle: string;
  rootLabel: string;
  indexedPath: FilePanelIndexedPath;
};

export type FilePanelSearchStatus =
  | { state: "idle" }
  | { state: "loading"; results: FilePanelSearchLauncherResult[] }
  | { state: "ready"; results: FilePanelSearchLauncherResult[] }
  | { state: "error"; message: string };

export type FilePanelSearchDisplayStatus =
  | FilePanelSearchStatus
  | { state: "unavailable" }
  | { state: "empty-workspace" };

export function filePanelSearchLauncherResults(
  roots: readonly WorkspaceRoot[],
  matches: readonly WorkspaceFilesQueryMatch[],
): FilePanelSearchLauncherResult[] {
  const rootItems = filePanelRootItems(roots);
  const rootItemsById = new Map(rootItems.map((root) => [root.id, root]));

  return matches.flatMap((match) => {
    const indexedPath = workspaceFileEntryToIndexedPath(match.entry);
    if (!indexedPath) {
      return [];
    }
    const rootItem = rootItemsById.get(indexedPath.rootId);
    if (!rootItem) {
      return [];
    }
    return [
      {
        key: filePanelSelectionKey(indexedPath),
        title: launcherResultTitle(rootItem, indexedPath),
        subtitle: launcherResultSubtitle(rootItem, indexedPath),
        rootLabel: rootItem.label,
        indexedPath,
      },
    ];
  });
}

export function fileSearchDisplayStatus({
  filesystemAvailable,
  workspaceId,
  roots,
  status,
}: {
  filesystemAvailable: boolean;
  workspaceId: string;
  roots: readonly WorkspaceRoot[];
  status: FilePanelSearchStatus;
}): FilePanelSearchDisplayStatus {
  if (!filesystemAvailable) {
    return { state: "unavailable" };
  }
  if (!workspaceId || roots.length === 0) {
    return { state: "empty-workspace" };
  }
  return status;
}

function launcherResultTitle(rootItem: FilePanelRootItem, indexedPath: FilePanelIndexedPath): string {
  if (!indexedPath.relativePath) {
    return rootItem.label;
  }
  return indexedPath.relativePath.split("/").at(-1) || indexedPath.relativePath;
}

function launcherResultSubtitle(rootItem: FilePanelRootItem, indexedPath: FilePanelIndexedPath): string {
  if (!indexedPath.relativePath) {
    return rootItem.path;
  }
  return `${rootItem.label}/${indexedPath.relativePath}`;
}

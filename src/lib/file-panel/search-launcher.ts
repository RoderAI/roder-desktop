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

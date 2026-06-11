import { createFileTreeIconResolver, getBuiltInSpriteSheet } from "@pierre/trees";
import { filePanelBasename, normalizeRelativePath } from "@/lib/file-panel/path";
import type {
  FilePanelFileIcon,
  FilePanelIndexedPath,
  FilePanelRootItem,
  FilePanelSelection,
  FilePanelTabIdentity,
  FilePanelTreeInitialExpansion,
} from "@/lib/file-panel/types";
import type { WorkspaceRoot } from "@/types/roder";

const filePanelIconResolver = createFileTreeIconResolver();

export const filePanelFileIconSpriteSheet = getBuiltInSpriteSheet("complete");

export function filePanelFileIcon(path: string): FilePanelFileIcon {
  return filePanelIconResolver.resolveIcon("file-tree-icon-file", path);
}

export function filePanelRootItems(roots: readonly WorkspaceRoot[]): FilePanelRootItem[] {
  const duplicateNames = duplicateRootNames(roots);
  const seenNames = new Set<string>();
  const usedTreePaths = new Set<string>();

  return roots.map((root) => {
    const baseLabel = root.name || filePanelBasename(root.path) || "workspace";
    const shouldDisambiguate = duplicateNames.has(baseLabel) && seenNames.has(baseLabel);
    const label = shouldDisambiguate ? `${baseLabel} - ${rootPathHint(root.path)}` : baseLabel;
    seenNames.add(baseLabel);
    const treePath = uniqueTreePath(sanitizeTreeSegment(label), usedTreePaths);
    return {
      id: root.id,
      label,
      path: root.path,
      treePath,
    };
  });
}

export function filePanelTreePaths(
  roots: readonly WorkspaceRoot[],
  indexedPaths: readonly FilePanelIndexedPath[],
): string[] {
  const rootItems = filePanelRootItems(roots);
  const pathsByRootId = new Map<string, Set<string>>();

  for (const root of rootItems) {
    pathsByRootId.set(root.id, new Set());
  }
  for (const indexedPath of indexedPaths) {
    const rootTreePath = rootItems.find((root) => root.id === indexedPath.rootId)?.treePath;
    if (!rootTreePath) {
      continue;
    }
    pathsByRootId.get(indexedPath.rootId)?.add(filePanelTreePath(rootTreePath, indexedPath));
  }

  return rootItems.flatMap((root) => [...(pathsByRootId.get(root.id) ?? [])].sort(compareTreePaths));
}

export function filePanelTreePathForIndexedPath(
  roots: readonly WorkspaceRoot[],
  indexedPath: FilePanelIndexedPath,
): string | null {
  const root = filePanelRootItems(roots).find((candidate) => candidate.id === indexedPath.rootId);
  if (!root) {
    return null;
  }
  return filePanelTreePath(root.treePath, indexedPath);
}

export function filePanelDirectoryChain(indexedPath: FilePanelIndexedPath): FilePanelIndexedPath[] {
  if (indexedPath.kind !== "directory") {
    return [];
  }
  const normalizedPath = normalizeRelativePath(indexedPath.relativePath);
  if (!normalizedPath) {
    return [indexedPath];
  }
  const segments = normalizedPath.split("/").filter(Boolean);
  return segments.map((_, index) => {
    const relativePath = segments.slice(0, index + 1).join("/");
    const target = relativePath === normalizedPath;
    return {
      rootId: indexedPath.rootId,
      relativePath,
      kind: "directory",
      hasChildren: target ? indexedPath.hasChildren : true,
    };
  });
}

export function filePanelIndexedPathByTreePath(
  roots: readonly WorkspaceRoot[],
  indexedPaths: readonly FilePanelIndexedPath[],
): Map<string, FilePanelIndexedPath> {
  return new Map(
    indexedPaths.flatMap((indexedPath) => {
      const treePath = filePanelTreePathForIndexedPath(roots, indexedPath);
      return treePath ? [[treePath, indexedPath] as const] : [];
    }),
  );
}

export function filePanelSearchPaths(
  roots: readonly WorkspaceRoot[],
  indexedPaths: readonly FilePanelIndexedPath[],
  query: string,
  limit = 200,
): FilePanelIndexedPath[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) {
    return [...indexedPaths].slice(0, limit);
  }

  const rootLabelById = new Map(filePanelRootItems(roots).map((root) => [root.id, root.label]));
  const matches = indexedPaths.filter((path) => {
    const haystack = `${rootLabelById.get(path.rootId) ?? ""} ${path.relativePath}`.toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
  return matches.slice(0, limit);
}

export function filePanelTreeInitialExpansion(search: string): FilePanelTreeInitialExpansion {
  return search.trim() ? "open" : 1;
}

export function filePanelTreeInitialExpandedPaths(
  paths: readonly string[],
  initialExpansion: FilePanelTreeInitialExpansion,
): string[] {
  if (initialExpansion === "open") {
    return filePanelTreeDirectoryPaths(paths, Number.POSITIVE_INFINITY);
  }
  return filePanelTreeDirectoryPaths(paths, initialExpansion);
}

export function filePanelSelectionKey(selection: FilePanelSelection): string {
  return `${selection.rootId}\u0000${selection.relativePath}`;
}

export function filePanelTabTitle(selection: FilePanelSelection): string {
  return filePanelBasename(selection.relativePath) || selection.relativePath;
}

export function nextFilePanelActiveTabKey(
  tabs: readonly FilePanelTabIdentity[],
  activeKey: string | null,
  closingKey: string,
): string | null {
  if (activeKey !== closingKey) {
    return activeKey;
  }
  const closingIndex = tabs.findIndex((tab) => tab.key === closingKey);
  if (closingIndex === -1) {
    return activeKey;
  }
  const nextTabs = tabs.filter((tab) => tab.key !== closingKey);
  return nextTabs[Math.min(closingIndex, nextTabs.length - 1)]?.key ?? null;
}

export function filePanelSearchResultLimitSummary(
  matchCount: number,
  indexedFileCount: number,
  limit: number,
): string | null {
  const safeMatchCount = Math.max(0, Math.floor(matchCount));
  const safeIndexedFileCount = Math.max(0, Math.floor(indexedFileCount));
  const safeLimit = Math.max(0, Math.floor(limit));
  if (safeLimit === 0 || safeMatchCount < safeLimit || safeIndexedFileCount <= safeMatchCount) {
    return null;
  }
  return `Showing first ${safeMatchCount} matches from ${safeIndexedFileCount} indexed files.`;
}

export function mergeFilePanelIndexedPaths(
  currentPaths: readonly FilePanelIndexedPath[],
  nextPaths: readonly FilePanelIndexedPath[],
): FilePanelIndexedPath[] {
  const pathsByKey = new Map<string, FilePanelIndexedPath>();
  for (const path of [...currentPaths, ...nextPaths]) {
    pathsByKey.set(filePanelSelectionKey(path), path);
  }
  return [...pathsByKey.values()].sort(compareIndexedPaths);
}

export function filePanelReloadableDirectoryPaths(
  indexedPaths: readonly FilePanelIndexedPath[],
  previouslyLoadedDirectoryKeys: ReadonlySet<string>,
  skippedDirectoryKeys: ReadonlySet<string>,
): FilePanelIndexedPath[] {
  const seenDirectoryKeys = new Set<string>();
  return indexedPaths.filter((indexedPath) => {
    if (indexedPath.kind !== "directory" || !indexedPath.hasChildren) {
      return false;
    }
    const directoryKey = filePanelSelectionKey(indexedPath);
    if (
      seenDirectoryKeys.has(directoryKey) ||
      skippedDirectoryKeys.has(directoryKey) ||
      !previouslyLoadedDirectoryKeys.has(directoryKey)
    ) {
      return false;
    }
    seenDirectoryKeys.add(directoryKey);
    return true;
  });
}

function duplicateRootNames(roots: readonly WorkspaceRoot[]): Set<string> {
  const counts = new Map<string, number>();
  for (const root of roots) {
    const name = root.name || filePanelBasename(root.path) || "workspace";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
}

function rootPathHint(path: string): string {
  const parts = path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .filter(Boolean);
  return parts.slice(-2).join("/") || filePanelBasename(path) || "root";
}

function uniqueTreePath(path: string, usedTreePaths: Set<string>): string {
  let candidate = path || "workspace";
  let suffix = 2;
  while (usedTreePaths.has(candidate)) {
    candidate = `${path} ${suffix}`;
    suffix += 1;
  }
  usedTreePaths.add(candidate);
  return candidate;
}

function sanitizeTreeSegment(segment: string): string {
  return segment.replace(/[\\/]+/g, "-").trim() || "workspace";
}

function sanitizeRelativeTreePath(path: string): string {
  return normalizeRelativePath(path).split("/").map(sanitizeTreeSegment).join("/");
}

function filePanelTreePath(rootTreePath: string, indexedPath: FilePanelIndexedPath): string {
  if (!indexedPath.relativePath) {
    return indexedPath.kind === "directory" ? `${rootTreePath}/` : rootTreePath;
  }
  const path = `${rootTreePath}/${sanitizeRelativeTreePath(indexedPath.relativePath)}`;
  return indexedPath.kind === "directory" ? `${path}/` : path;
}

function searchTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function compareTreePaths(left: string, right: string): number {
  return left.localeCompare(right);
}

function compareIndexedPaths(left: FilePanelIndexedPath, right: FilePanelIndexedPath): number {
  const rootComparison = left.rootId.localeCompare(right.rootId);
  if (rootComparison !== 0) {
    return rootComparison;
  }
  if (left.kind !== right.kind) {
    return left.kind === "directory" ? -1 : 1;
  }
  return left.relativePath.localeCompare(right.relativePath);
}

function filePanelTreeDirectoryPaths(paths: readonly string[], maxDepth: number): string[] {
  const directories = new Set<string>();
  for (const path of paths) {
    const segments = path.split("/").filter(Boolean);
    for (let index = 1; index < segments.length; index += 1) {
      if (index > maxDepth) {
        break;
      }
      directories.add(segments.slice(0, index).join("/"));
    }
  }
  return [...directories];
}

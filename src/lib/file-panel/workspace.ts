import { absolutePathForDirectory, isWithinRoot, joinAbsolutePath, normalizeRelativePath } from "@/lib/file-panel/path";
import type {
  FilePanelDirectoryReadError,
  FilePanelIndexedPath,
  FilePanelReadDirectory,
  FilePanelResolvedPath,
  FilePanelSelection,
  FilePanelWorkspaceIndex,
} from "@/lib/file-panel/types";
import type {
  FileSystemReadDirectoryResult,
  WorkspaceFileEntry,
  WorkspaceFilesStatus,
  WorkspaceRoot,
} from "@/types/roder";

const skippedIndexDirectoryNames = new Set([
  ".cache",
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
]);

const workspaceFileApiMethods = [
  "workspace/files/status",
  "workspace/files/rebuild",
  "workspace/files/children",
  "workspace/files/query",
  "workspace/files/read",
];

export function filePanelWorkspaceKey(
  workspaceId: string,
  roots: readonly WorkspaceRoot[],
  selectedRootId: string,
  available: boolean,
): string {
  return JSON.stringify({
    available,
    selectedRootId,
    workspaceId,
    roots: roots.map((root) => ({ id: root.id, name: root.name, path: root.path })),
  });
}

export function filePanelWorkspaceFilesAvailable(appServerMethods: readonly string[]): boolean {
  return workspaceFileApiMethods.every((method) => appServerMethods.includes(method));
}

export function filePanelShouldIndexDirectory(relativePath: string): boolean {
  return relativePath
    .split("/")
    .filter(Boolean)
    .every((segment) => !skippedIndexDirectoryNames.has(segment));
}

export async function indexFilePanelWorkspaceRoots(
  roots: readonly WorkspaceRoot[],
  limit: number,
  readDirectory: FilePanelReadDirectory,
): Promise<FilePanelWorkspaceIndex> {
  const indexedPaths: FilePanelIndexedPath[] = [];
  const directoryErrors: FilePanelDirectoryReadError[] = [];
  let truncated = false;

  for (const root of roots) {
    const queue = [""];
    while (queue.length > 0) {
      const relativeDirectoryPath = queue.shift() ?? "";
      const directoryPath = absolutePathForDirectory(root.path, relativeDirectoryPath);
      let result: FileSystemReadDirectoryResult;
      try {
        result = await readDirectory(directoryPath);
      } catch (error) {
        directoryErrors.push({ rootId: root.id, relativePath: relativeDirectoryPath, error: errorMessage(error) });
        continue;
      }
      for (const entry of result.entries) {
        if (indexedPaths.length >= limit) {
          truncated = true;
          return { indexedPaths, truncated, directoryErrors };
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

  return { indexedPaths, truncated, directoryErrors };
}

export function workspaceFilesEntriesToIndexedPaths(entries: readonly WorkspaceFileEntry[]): FilePanelIndexedPath[] {
  return entries.flatMap((entry) => {
    const indexedPath = workspaceFileEntryToIndexedPath(entry);
    return indexedPath ? [indexedPath] : [];
  });
}

export function workspaceFileEntryToIndexedPath(entry: WorkspaceFileEntry): FilePanelIndexedPath | null {
  const relativePath = normalizeRelativePath(entry.path);
  if (!entry.rootId || (entry.kind !== "file" && entry.kind !== "directory")) {
    return null;
  }
  if (!relativePath && entry.kind !== "directory") {
    return null;
  }
  return {
    rootId: entry.rootId,
    relativePath,
    kind: entry.kind,
    hasChildren: Boolean(entry.hasChildren),
  };
}

export function filePanelStatusNeedsRebuild(status: WorkspaceFilesStatus): boolean {
  return status.state === "missing" || status.state === "stale" || status.stale;
}

export function resolveFilePanelPath(
  roots: readonly WorkspaceRoot[],
  selection: FilePanelSelection,
): FilePanelResolvedPath {
  const root = roots.find((candidate) => candidate.id === selection.rootId);
  if (!root) {
    throw new Error("Workspace root not found.");
  }

  const relativePath = normalizeRelativePath(selection.relativePath);
  if (relativePath.split("/").includes("..")) {
    throw new Error("File path is outside the workspace root.");
  }
  const absolutePath = joinAbsolutePath(root.path, relativePath);
  if (!isWithinRoot(root.path, absolutePath)) {
    throw new Error("File path is outside the workspace root.");
  }
  return { root, absolutePath };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to read workspace files.";
}

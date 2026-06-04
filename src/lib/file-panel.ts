import type { FileSystemReadDirectoryResult, WorkspaceRoot } from "@/types/roder";

export type FilePanelPathKind = "file" | "directory";

export type FilePanelIndexedPath = {
  rootId: string;
  relativePath: string;
  kind: FilePanelPathKind;
};

export type FilePanelRootItem = {
  id: string;
  label: string;
  path: string;
  treePath: string;
};

export type FilePanelSelection = {
  rootId: string;
  relativePath: string;
};

export type FilePanelResolvedPath = {
  root: WorkspaceRoot;
  absolutePath: string;
};

export type FilePanelTreeInitialExpansion = 1 | "open";

export type FilePanelDirectoryReadError = {
  rootId: string;
  relativePath: string;
  error: string;
};

export type FilePanelWorkspaceIndex = {
  indexedPaths: FilePanelIndexedPath[];
  truncated: boolean;
  directoryErrors: FilePanelDirectoryReadError[];
};

export type FilePanelReadDirectory = (path: string) => Promise<FileSystemReadDirectoryResult>;

export type DecodedFileContent =
  | { status: "text"; text: string; bytes: number }
  | { status: "binary"; bytes: number }
  | { status: "too-large"; bytes: number };

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

export function filePanelRootItems(roots: readonly WorkspaceRoot[]): FilePanelRootItem[] {
  const duplicateNames = duplicateRootNames(roots);
  const seenNames = new Set<string>();
  const usedTreePaths = new Set<string>();

  return roots.map((root) => {
    const baseLabel = root.name || basename(root.path) || "workspace";
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
    if (!isFilePanelTreeLeaf(indexedPath)) {
      continue;
    }
    const rootTreePath = rootItems.find((root) => root.id === indexedPath.rootId)?.treePath;
    if (!rootTreePath || !indexedPath.relativePath) {
      continue;
    }
    pathsByRootId.get(indexedPath.rootId)?.add(`${rootTreePath}/${sanitizeRelativeTreePath(indexedPath.relativePath)}`);
  }

  return rootItems.flatMap((root) => [...(pathsByRootId.get(root.id) ?? [])].sort(compareTreePaths));
}

export function filePanelTreePathForIndexedPath(
  roots: readonly WorkspaceRoot[],
  indexedPath: FilePanelIndexedPath,
): string | null {
  if (!isFilePanelTreeLeaf(indexedPath)) {
    return null;
  }
  const root = filePanelRootItems(roots).find((candidate) => candidate.id === indexedPath.rootId);
  if (!root || !indexedPath.relativePath) {
    return null;
  }
  return `${root.treePath}/${sanitizeRelativeTreePath(indexedPath.relativePath)}`;
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

export function decodeFileContent(dataBase64: string, options: { maxBytes: number }): DecodedFileContent {
  const bytes = base64ToBytes(dataBase64);
  if (bytes.length > options.maxBytes) {
    return { status: "too-large", bytes: bytes.length };
  }
  if (bytes.includes(0)) {
    return { status: "binary", bytes: bytes.length };
  }

  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (text.includes("\uFFFD")) {
    return { status: "binary", bytes: bytes.length };
  }
  return { status: "text", text, bytes: bytes.length };
}

export function normalizeRelativePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+/, "");
  const parts: string[] = [];
  for (const segment of normalized.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      parts.pop();
      parts.push("..");
      continue;
    }
    parts.push(segment);
  }
  return parts.join("/");
}

function duplicateRootNames(roots: readonly WorkspaceRoot[]): Set<string> {
  const counts = new Map<string, number>();
  for (const root of roots) {
    const name = root.name || basename(root.path) || "workspace";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
}

function rootPathHint(path: string): string {
  const parts = path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .filter(Boolean);
  return parts.slice(-2).join("/") || basename(path) || "root";
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

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

function searchTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function isFilePanelTreeLeaf(indexedPath: FilePanelIndexedPath): boolean {
  return indexedPath.kind === "file";
}

function joinAbsolutePath(rootPath: string, relativePath: string): string {
  const root = rootPath.replace(/[\\/]+$/, "");
  return relativePath ? `${root}/${relativePath}` : root;
}

function absolutePathForDirectory(rootPath: string, relativePath: string): string {
  const root = rootPath.replace(/[\\/]+$/, "");
  return relativePath ? `${root}/${relativePath}` : root;
}

function isWithinRoot(rootPath: string, absolutePath: string): boolean {
  const root = rootPath.replace(/[\\/]+$/, "");
  return absolutePath === root || absolutePath.startsWith(`${root}/`);
}

function compareTreePaths(left: string, right: string): number {
  return left.localeCompare(right);
}

function base64ToBytes(dataBase64: string): Uint8Array {
  if (typeof atob === "function") {
    return Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0));
  }
  return Uint8Array.from(Buffer.from(dataBase64, "base64"));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to read workspace files.";
}

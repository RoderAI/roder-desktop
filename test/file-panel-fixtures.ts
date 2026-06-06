import type { FilePanelIndexedPath } from "../src/lib/file-panel";
import type { FileSystemReadDirectoryResult, WorkspaceFileEntry, WorkspaceRoot } from "../src/types/roder";

export const roots: WorkspaceRoot[] = [
  { id: "root_a", name: "app", path: "/workspace/app" },
  { id: "root_b", name: "app", path: "/workspace/packages/app" },
];

export const workspaceFileMethods = [
  "workspace/files/status",
  "workspace/files/rebuild",
  "workspace/files/children",
  "workspace/files/query",
  "workspace/files/read",
];

export function indexedPath(
  rootId: string,
  relativePath: string,
  kind: FilePanelIndexedPath["kind"] = "file",
): FilePanelIndexedPath {
  return { rootId, relativePath, kind };
}

export function readDirectoryResult(entries: FileSystemReadDirectoryResult["entries"]): FileSystemReadDirectoryResult {
  return { entries };
}

export function directoryEntry(fileName: string): FileSystemReadDirectoryResult["entries"][number] {
  return { fileName, isDirectory: true, isFile: false };
}

export function fileEntry(fileName: string): FileSystemReadDirectoryResult["entries"][number] {
  return { fileName, isDirectory: false, isFile: true };
}

export function workspaceFileEntry(
  entry: Partial<WorkspaceFileEntry> & Pick<WorkspaceFileEntry, "path" | "name" | "kind">,
): WorkspaceFileEntry {
  return {
    rootId: entry.rootId ?? "root_a",
    rootName: entry.rootName ?? "app",
    path: entry.path,
    name: entry.name,
    kind: entry.kind,
    hasChildren: entry.hasChildren ?? false,
    size: entry.size,
    modifiedMs: entry.modifiedMs,
  };
}

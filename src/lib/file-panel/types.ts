import type { FileSystemReadDirectoryResult, WorkspaceRoot } from "@/types/roder";

export type FilePanelPathKind = "file" | "directory";

export type FilePanelIndexedPath = {
  rootId: string;
  relativePath: string;
  kind: FilePanelPathKind;
  hasChildren?: boolean;
};

export type FilePanelSelectionIntent = {
  id: number;
  workspaceId: string;
  indexedPath: FilePanelIndexedPath;
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

export type FilePanelMarkdownViewMode = "preview" | "source";

export type FilePanelTabIdentity = {
  key: string;
};

export type FilePanelFileIcon = {
  height?: number;
  name: string;
  remappedFrom?: string;
  token?: string;
  viewBox?: string;
  width?: number;
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
  | { status: "text"; text: string; bytes: number; truncated?: boolean }
  | { status: "binary"; bytes: number }
  | { status: "too-large"; bytes: number };

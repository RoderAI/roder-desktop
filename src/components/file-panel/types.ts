import type {
  DecodedFileContent,
  FilePanelIndexedPath,
  FilePanelMarkdownViewMode,
  FilePanelSelection,
} from "@/lib/file-panel";

export type FileViewState =
  | { status: "empty" }
  | { status: "loading"; selection: FilePanelSelection; label: string }
  | {
      status: "text";
      selection: FilePanelSelection;
      label: string;
      content: DecodedFileContent & { status: "text" };
      markdownViewMode: FilePanelMarkdownViewMode;
    }
  | { status: "binary"; selection: FilePanelSelection; label: string; bytes: number }
  | { status: "too-large"; selection: FilePanelSelection; label: string; bytes: number }
  | { status: "error"; selection: FilePanelSelection; label: string; error: string };

export type OpenFileViewState = Exclude<FileViewState, { status: "empty" }>;

export type OpenFileTab = {
  key: string;
  title: string;
  state: OpenFileViewState;
};

export type FileTabsOverflowState = {
  canScrollLeft: boolean;
  canScrollRight: boolean;
};

export type FileSearchState =
  | { status: "idle"; query: string; indexedPaths: FilePanelIndexedPath[] }
  | { status: "loading"; query: string; indexedPaths: FilePanelIndexedPath[] }
  | { status: "ready"; query: string; indexedPaths: FilePanelIndexedPath[]; indexedFileCount: number }
  | { status: "error"; query: string; indexedPaths: FilePanelIndexedPath[]; error: string };

export type FilePanelTreeSidebarState = "unavailable" | "empty" | "loading" | "ready" | "error";

export type FilePanelSidebarState = FilePanelTreeSidebarState | "search-loading" | "search-ready" | "search-error";

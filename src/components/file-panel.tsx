import { FileTree, useFileTree } from "@pierre/trees/react";
import type { FileTree as FileTreeModel } from "@pierre/trees";
import { AlertCircle, FileCode2, RefreshCw } from "lucide-react";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useFilePanelTree } from "@/hooks/use-file-panel-tree";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { highlightFileContent, type HighlightedFileContent } from "@/lib/file-syntax-highlight";
import {
  decodeFileContent,
  filePanelIndexedPathByTreePath,
  filePanelRootItems,
  filePanelSearchPaths,
  filePanelTreeInitialExpansion,
  filePanelTreePaths,
  resolveFilePanelPath,
  type DecodedFileContent,
  type FilePanelIndexedPath,
  type FilePanelSelection,
} from "@/lib/file-panel";
import { roderIpc } from "@/lib/roder-ipc";
import { cn } from "@/lib/utils";
import type { WorkspaceRoot } from "@/types/roder";

const maxRenderedFileBytes = 750_000;

export type FilePanelProps = {
  roots: WorkspaceRoot[];
  selectedRootId: string;
  appServerMethods: string[];
};

type FileViewState =
  | { status: "empty" }
  | { status: "loading"; selection: FilePanelSelection; label: string }
  | { status: "text"; selection: FilePanelSelection; label: string; content: DecodedFileContent & { status: "text" } }
  | { status: "binary"; selection: FilePanelSelection; label: string; bytes: number }
  | { status: "too-large"; selection: FilePanelSelection; label: string; bytes: number }
  | { status: "error"; selection: FilePanelSelection; label: string; error: string };

export function FilePanel({ roots, selectedRootId, appServerMethods }: FilePanelProps): React.JSX.Element {
  const filesystemAvailable = appServerMethods.includes("fs/readDirectory") && appServerMethods.includes("fs/readFile");
  const orderedRoots = useMemo(() => orderWorkspaceRoots(roots, selectedRootId), [roots, selectedRootId]);
  const { state, refresh } = useFilePanelTree({ roots: orderedRoots, available: filesystemAvailable });
  const [search, setSearch] = useState("");
  const [viewState, setViewState] = useState<FileViewState>({ status: "empty" });
  const readRequestSeq = useRef(0);
  const rootItems = useMemo(() => filePanelRootItems(orderedRoots), [orderedRoots]);
  const visibleIndexedPaths = useMemo(
    () => filePanelSearchPaths(orderedRoots, state.indexedPaths, search),
    [orderedRoots, search, state.indexedPaths],
  );
  const directoryErrorCount = state.status === "ready" ? state.directoryErrors.length : 0;

  const openFile = useCallback(
    (indexedPath: FilePanelIndexedPath) => {
      if (indexedPath.kind !== "file") {
        return;
      }
      const selection = { rootId: indexedPath.rootId, relativePath: indexedPath.relativePath };
      const label = fileSelectionLabel(rootItems, selection);
      const requestId = (readRequestSeq.current += 1);
      setViewState({ status: "loading", selection, label });
      let resolvedPath: ReturnType<typeof resolveFilePanelPath>;
      try {
        resolvedPath = resolveFilePanelPath(orderedRoots, selection);
      } catch (error) {
        setViewState({ status: "error", selection, label, error: errorMessage(error) });
        return;
      }
      void roderIpc
        .readFile(resolvedPath.absolutePath)
        .then((result) => {
          if (readRequestSeq.current !== requestId) {
            return;
          }
          const content = decodeFileContent(result.dataBase64, { maxBytes: maxRenderedFileBytes });
          if (content.status === "text") {
            setViewState({ status: "text", selection, label, content });
          } else if (content.status === "binary") {
            setViewState({ status: "binary", selection, label, bytes: content.bytes });
          } else {
            setViewState({ status: "too-large", selection, label, bytes: content.bytes });
          }
        })
        .catch((error: unknown) => {
          if (readRequestSeq.current !== requestId) {
            return;
          }
          setViewState({ status: "error", selection, label, error: errorMessage(error) });
        });
    },
    [orderedRoots, rootItems],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
        <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 truncate text-base font-medium">Files</div>
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0 rounded-md"
          aria-label="Refresh files"
          title="Refresh files"
          disabled={state.status === "loading" || state.status === "unavailable" || state.status === "empty"}
          onClick={refresh}
        >
          <RefreshCw className={cn("size-3.5", state.status === "loading" && "animate-spin")} />
        </Button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(190px,240px)_minmax(0,1fr)]">
        <aside className="flex min-h-0 min-w-0 flex-col border-r border-border bg-background">
          <div className="border-b border-border px-3 py-2">
            <input
              value={search}
              type="search"
              placeholder="Search files"
              className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-base font-medium outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              aria-label="Search files"
              disabled={state.status === "unavailable" || state.status === "empty"}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
          </div>
          <FilePanelSidebar
            roots={orderedRoots}
            indexedPaths={visibleIndexedPaths}
            search={search}
            state={state.status}
            directoryErrorCount={directoryErrorCount}
            onOpenFile={openFile}
          />
        </aside>
        <FileViewer state={viewState} />
      </div>
    </div>
  );
}

function FilePanelSidebar({
  roots,
  indexedPaths,
  search,
  state,
  directoryErrorCount,
  onOpenFile,
}: {
  roots: WorkspaceRoot[];
  indexedPaths: FilePanelIndexedPath[];
  search: string;
  state: string;
  directoryErrorCount: number;
  onOpenFile: (path: FilePanelIndexedPath) => void;
}): React.JSX.Element {
  if (state === "unavailable") {
    return <PanelMessage title="Files unavailable">Update the app-server to browse workspace files.</PanelMessage>;
  }
  if (state === "empty") {
    return <PanelMessage title="No workspace">Select or create a workspace to browse files.</PanelMessage>;
  }
  if (state === "error") {
    return <PanelMessage title="Unable to read files">Refresh or select a different workspace.</PanelMessage>;
  }

  const treePaths = filePanelTreePaths(roots, indexedPaths);
  const initialExpansion = filePanelTreeInitialExpansion(search);
  if (state === "ready" && treePaths.length === 0) {
    if (directoryErrorCount > 0) {
      return <PanelMessage title="No readable files">Some folders couldn't be read.</PanelMessage>;
    }
    return search ? (
      <PanelMessage title="No matches">Try a different file name or path.</PanelMessage>
    ) : (
      <PanelMessage title="No files">This workspace root is empty.</PanelMessage>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {directoryErrorCount > 0 && <DirectoryReadWarning count={directoryErrorCount} />}
      <div className="min-h-0 flex-1 pt-1.5">
        <FilePanelTree
          key={treeKey(treePaths, initialExpansion)}
          roots={roots}
          indexedPaths={indexedPaths}
          initialExpansion={initialExpansion}
          paths={treePaths}
          onOpenFile={onOpenFile}
        />
      </div>
    </div>
  );
}

function DirectoryReadWarning({ count }: { count: number }): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-start gap-2 border-b border-border bg-muted/30 px-3 py-2 text-base text-muted-foreground">
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
      <span>{count === 1 ? "A folder couldn't be read." : `${count} folders couldn't be read.`}</span>
    </div>
  );
}

function FilePanelTree({
  roots,
  indexedPaths,
  initialExpansion,
  paths,
  onOpenFile,
}: {
  roots: WorkspaceRoot[];
  indexedPaths: FilePanelIndexedPath[];
  initialExpansion: ReturnType<typeof filePanelTreeInitialExpansion>;
  paths: string[];
  onOpenFile: (path: FilePanelIndexedPath) => void;
}): React.JSX.Element {
  const treeId = useId();
  const indexedPathByTreePath = useMemo(
    () => filePanelIndexedPathByTreePath(roots, indexedPaths),
    [indexedPaths, roots],
  );
  const modelRef = useRef<FileTreeModel | null>(null);
  const { model } = useFileTree({
    id: treeId,
    paths,
    flattenEmptyDirectories: true,
    initialExpansion,
    itemHeight: 32,
    search: false,
    stickyFolders: true,
    onSelectionChange: (selectedPaths) => {
      const selectedTreePath = selectedPaths.at(-1) ?? "";
      const indexedPath = indexedPathByTreePath.get(selectedTreePath);
      if (!indexedPath) {
        return;
      }
      if (indexedPath.kind === "directory") {
        modelRef.current?.getItem(selectedTreePath)?.toggleSelect();
        return;
      }
      onOpenFile(indexedPath);
    },
    unsafeCSS: filePanelTreeUnsafeCSS,
  });
  modelRef.current = model;

  return <FileTree model={model} className="block h-full w-full" />;
}

function FileViewer({ state }: { state: FileViewState }): React.JSX.Element {
  if (state.status === "empty") {
    return <CenteredViewerText>Select a file to preview.</CenteredViewerText>;
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-background">
      <header className="flex min-h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 truncate text-base font-medium">{state.label}</div>
      </header>
      {state.status === "loading" && <InlineViewerText>Loading file...</InlineViewerText>}
      {state.status === "binary" && <InlineViewerText>Binary file cannot be previewed.</InlineViewerText>}
      {state.status === "too-large" && (
        <InlineViewerText>{`File is too large to preview (${formatBytes(state.bytes)}).`}</InlineViewerText>
      )}
      {state.status === "error" && <PanelError message={state.error} inline />}
      {state.status === "text" && (
        <HighlightedCodeView
          key={`${state.selection.rootId}:${state.selection.relativePath}`}
          path={state.selection.relativePath}
          text={state.content.text}
        />
      )}
    </section>
  );
}

function HighlightedCodeView({ path, text }: { path: string; text: string }): React.JSX.Element {
  const [highlightedContent, setHighlightedContent] = useState<HighlightedFileContent | null>(null);
  const [failed, setFailed] = useState(false);

  useMountEffect(() => {
    let active = true;
    void highlightFileContent(path, text)
      .then((content) => {
        if (active) {
          setHighlightedContent(content);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  });

  if (highlightedContent && !failed) {
    return (
      <div
        className="file-code-view workspace-scrollbar min-h-0 flex-1 overflow-auto"
        dangerouslySetInnerHTML={{ __html: highlightedContent.html }}
      />
    );
  }

  return (
    <div className="workspace-scrollbar min-h-0 flex-1 overflow-auto">
      <pre className="m-0 min-w-full p-4 font-mono text-sm font-normal leading-6 text-foreground">
        <code>{text}</code>
      </pre>
    </div>
  );
}

function PanelMessage({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-1 p-4 text-center">
      <div className="text-base font-medium text-foreground">{title}</div>
      <div className="text-base text-muted-foreground">{children}</div>
    </div>
  );
}

function CenteredViewerText({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-4 text-base text-muted-foreground">
      {children}
    </div>
  );
}

function InlineViewerText({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="p-4 text-base text-muted-foreground">{children}</div>;
}

function PanelError({ message, inline = false }: { message: string; inline?: boolean }): React.JSX.Element {
  return (
    <div className={cn(!inline && "px-3 py-2")}>
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-base text-destructive">
        <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0 flex-1">{message}</span>
      </div>
    </div>
  );
}

function orderWorkspaceRoots(roots: WorkspaceRoot[], selectedRootId: string): WorkspaceRoot[] {
  if (!selectedRootId) {
    return roots;
  }
  return [...roots].sort((left, right) => {
    if (left.id === selectedRootId) {
      return -1;
    }
    if (right.id === selectedRootId) {
      return 1;
    }
    return 0;
  });
}

function fileSelectionLabel(rootItems: ReturnType<typeof filePanelRootItems>, selection: FilePanelSelection): string {
  const root = rootItems.find((candidate) => candidate.id === selection.rootId);
  return root ? `${root.label}/${selection.relativePath}` : selection.relativePath;
}

function treeKey(paths: string[], initialExpansion: ReturnType<typeof filePanelTreeInitialExpansion>): string {
  return `${initialExpansion}:${paths.join("\u0000")}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 102.4) / 10} KB`;
  }
  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to read file.";
}

const filePanelTreeUnsafeCSS = `
  :host {
    --trees-bg-override: var(--color-background);
    --trees-input-bg-override: var(--color-background);
    --trees-search-bg-override: var(--color-background);
    --trees-search-fg-override: var(--color-foreground);
    --trees-search-font-weight-override: 400;
    --trees-fg-override: var(--color-foreground);
    --trees-fg-muted-override: var(--color-muted-foreground);
    --trees-selected-bg-override: var(--color-accent);
    --trees-selected-fg-override: var(--color-accent-foreground);
    --trees-border-color-override: var(--color-border);
    --trees-font-family-override: var(--font-ui);
    --trees-font-size-override: var(--font-size-ui);
    --trees-font-weight-regular-override: 500;
  }
`;

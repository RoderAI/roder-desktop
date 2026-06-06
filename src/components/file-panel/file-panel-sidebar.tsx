import { FileTree, useFileTree } from "@pierre/trees/react";
import type { FileTree as FileTreeModel } from "@pierre/trees";
import { AlertCircle } from "lucide-react";
import { useId, useLayoutEffect, useMemo, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { FilePanelSidebarState, FilePanelTreeSidebarState, FileSearchState } from "@/components/file-panel/types";
import {
  filePanelIndexedPathByTreePath,
  filePanelTreeInitialExpandedPaths,
  filePanelTreeInitialExpansion,
  filePanelTreePaths,
  type FilePanelIndexedPath,
} from "@/lib/file-panel";
import { cn } from "@/lib/utils";
import type { WorkspaceRoot } from "@/types/roder";

const fileTreeSkeletonRows = [
  { id: "root-file", widthClassName: "w-28", nested: false },
  { id: "wide-file", widthClassName: "w-40", nested: false },
  { id: "middle-file", widthClassName: "w-32", nested: false },
  { id: "nested-a", widthClassName: "w-28", nested: true },
  { id: "nested-b", widthClassName: "w-40", nested: true },
  { id: "nested-c", widthClassName: "w-32", nested: true },
  { id: "nested-d", widthClassName: "w-28", nested: true },
];

export function filePanelSidebarState(
  treeState: FilePanelTreeSidebarState,
  searchState: FileSearchState["status"],
  searching: boolean,
): FilePanelSidebarState {
  if (!searching) {
    return treeState;
  }
  if (searchState === "error") {
    return "search-error";
  }
  if (searchState === "loading") {
    return "search-loading";
  }
  if (searchState === "ready") {
    return "search-ready";
  }
  return treeState;
}

export function FilePanelSidebar({
  roots,
  indexedPaths,
  search,
  state,
  directoryErrorCount,
  onOpenFile,
  onOpenDirectory,
  expandedTreePaths,
}: {
  roots: WorkspaceRoot[];
  indexedPaths: FilePanelIndexedPath[];
  search: string;
  state: FilePanelSidebarState;
  directoryErrorCount: number;
  onOpenFile: (path: FilePanelIndexedPath) => void;
  onOpenDirectory: (path: FilePanelIndexedPath) => void;
  expandedTreePaths: string[];
}): React.JSX.Element {
  const treePaths = useMemo(() => filePanelTreePaths(roots, indexedPaths), [indexedPaths, roots]);
  const initialExpansion = filePanelTreeInitialExpansion(search);
  const treeResetKey = `${initialExpansion}:${roots.map((root) => root.id).join("\u0000")}`;

  if (state === "unavailable") {
    return <PanelMessage title="Files unavailable">Update the app-server to browse workspace files.</PanelMessage>;
  }
  if (state === "empty") {
    return <PanelMessage title="No workspace">Select or create a workspace to browse files.</PanelMessage>;
  }
  if (state === "error") {
    return <PanelMessage title="Unable to read files">Refresh or select a different workspace.</PanelMessage>;
  }
  if (state === "search-error") {
    return <PanelMessage title="Unable to search files">Try again after the file index is ready.</PanelMessage>;
  }
  if (state === "loading" && indexedPaths.length === 0) {
    return <FileTreeSkeleton />;
  }
  if (state === "search-loading" && indexedPaths.length === 0) {
    return <FileTreeSkeleton />;
  }

  if ((state === "ready" || state === "search-ready") && treePaths.length === 0) {
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
          key={treeResetKey}
          roots={roots}
          indexedPaths={indexedPaths}
          initialExpansion={initialExpansion}
          expandedTreePaths={expandedTreePaths}
          paths={treePaths}
          onOpenFile={onOpenFile}
          onOpenDirectory={onOpenDirectory}
        />
      </div>
    </div>
  );
}

function FileTreeSkeleton(): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 px-3 py-2" role="status" aria-label="Loading files">
      {fileTreeSkeletonRows.map((row) => (
        <div key={row.id} className="flex h-8 items-center gap-2">
          <Skeleton className="size-4 shrink-0 rounded-sm bg-muted/50" />
          <Skeleton className={cn("h-3 rounded-full bg-muted/50", row.widthClassName, row.nested && "ml-4")} />
        </div>
      ))}
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
  expandedTreePaths,
  paths,
  onOpenFile,
  onOpenDirectory,
}: {
  roots: WorkspaceRoot[];
  indexedPaths: FilePanelIndexedPath[];
  initialExpansion: ReturnType<typeof filePanelTreeInitialExpansion>;
  expandedTreePaths: string[];
  paths: string[];
  onOpenFile: (path: FilePanelIndexedPath) => void;
  onOpenDirectory: (path: FilePanelIndexedPath) => void;
}): React.JSX.Element {
  const treeId = useId();
  const indexedPathByTreePath = useMemo(
    () => filePanelIndexedPathByTreePath(roots, indexedPaths),
    [indexedPaths, roots],
  );
  const indexedPathByTreePathRef = useRef(indexedPathByTreePath);
  const onOpenFileRef = useRef(onOpenFile);
  const onOpenDirectoryRef = useRef(onOpenDirectory);
  const initialExpandedPaths = useMemo(
    () => [...new Set([...filePanelTreeInitialExpandedPaths(paths, initialExpansion), ...expandedTreePaths])],
    [expandedTreePaths, initialExpansion, paths],
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
      const indexedPath = indexedPathByTreePathRef.current.get(selectedTreePath);
      if (!indexedPath) {
        return;
      }
      if (indexedPath.kind === "directory") {
        onOpenDirectoryRef.current(indexedPath);
        const item = modelRef.current?.getItem(selectedTreePath);
        if (item && "expand" in item) {
          item.expand();
        }
        return;
      }
      onOpenFileRef.current(indexedPath);
    },
    unsafeCSS: filePanelTreeUnsafeCSS,
  });
  useLayoutEffect(() => {
    indexedPathByTreePathRef.current = indexedPathByTreePath;
    onOpenFileRef.current = onOpenFile;
    onOpenDirectoryRef.current = onOpenDirectory;
    modelRef.current = model;
    model.resetPaths(paths, { initialExpandedPaths });
  }, [indexedPathByTreePath, initialExpandedPaths, model, onOpenDirectory, onOpenFile, paths]);

  return <FileTree model={model} className="block h-full w-full" />;
}

function PanelMessage({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-1 p-4 text-center">
      <div className="text-base font-medium text-foreground">{title}</div>
      <div className="text-base text-muted-foreground">{children}</div>
    </div>
  );
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

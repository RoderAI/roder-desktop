import { FileTree, useFileTree } from "@pierre/trees/react";
import { Virtualizer as DiffsVirtualizer } from "@pierre/diffs";
import { PatchDiff, VirtualizerContext } from "@pierre/diffs/react";
import type { FileTree as FileTreeModel, GitStatus, GitStatusEntry } from "@pierre/trees";
import { AlertCircle, FileDiff, GitCompareArrows, PanelLeftClose, PanelLeftOpen, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import {
  useReviewChanges,
  type ReviewDiffState,
  type ReviewFile,
  type ReviewListState,
} from "@/hooks/use-review-changes";
import { useHorizontalResize } from "@/hooks/use-horizontal-resize";
import {
  reviewActiveFilePath,
  reviewChangedFilesText,
  reviewDiffPathsToLoad,
  reviewFileTreeStatusLabel,
  reviewFileTreeToggleLabel,
  reviewFileTreeWidth,
  reviewFileTreeWidthBounds,
  reviewLatestSelectedFilePath,
} from "@/lib/review-panel-ui";
import type { RouteReviewScope } from "@/lib/route-search";
import { cn } from "@/lib/utils";
import type { VcsChangeStatus, HunkRecord, WorkspaceChangeObservation } from "@/types/roder";

type ReviewPanelProps = {
  threadId: string;
  workspaceId: string;
  rootId: string;
  threadHunks: HunkRecord[];
  threadObservedChanges: WorkspaceChangeObservation[];
  threadLatestTurnId: string;
  scope: RouteReviewScope;
  turnId: string;
  selectedPath: string;
  width: number;
  appServerMethods: string[];
  onScopeChange: (scope: RouteReviewScope, turnId?: string) => void;
  onSelectedPathChange: (path: string) => void;
};

export function ReviewPanel({
  threadId,
  workspaceId,
  rootId,
  threadHunks,
  threadObservedChanges,
  threadLatestTurnId,
  scope,
  turnId,
  selectedPath,
  width,
  appServerMethods,
  onScopeChange,
  onSelectedPathChange,
}: ReviewPanelProps): React.JSX.Element {
  const {
    branchReviewAvailable,
    diffStatesByPath,
    effectiveTurnId,
    files,
    listState,
    loadDiff,
    loadFiles,
    loadFullDiff,
  } = useReviewChanges({
    threadId,
    workspaceId,
    rootId,
    scope,
    turnId,
    selectedPath,
    appServerMethods,
    threadHunks,
    threadObservedChanges,
    threadLatestTurnId,
    onSelectedPathChange,
  });
  const [fileTreeVisible, setFileTreeVisible] = useState(true);
  const [fileTreeWidth, setFileTreeWidth] = useState<number>(reviewFileTreeWidthBounds.defaultValue);
  const [fileTreeResizing, setFileTreeResizing] = useState(false);
  const [diffScrollElement, setDiffScrollElement] = useState<HTMLElement | null>(null);
  const [nearbyDiffPaths, setNearbyDiffPaths] = useState<Set<string>>(() => new Set());
  const fileTreeId = useId();
  const diffScrollRef = useRef<HTMLElement | null>(null);
  const diffSectionRefs = useRef(new Map<string, HTMLElement>());
  const selectionSourceRef = useRef<"navigation" | "scroll" | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const fileTreeToggleLabel = reviewFileTreeToggleLabel(fileTreeVisible);
  const effectiveFileTreeWidth = reviewFileTreeWidth(fileTreeWidth, width);
  const reviewPanelStyle = { "--review-file-tree-width": `${effectiveFileTreeWidth}px` } as ReviewPanelStyle;
  const diffLoadablePaths = useMemo(() => files.filter((file) => !file.binary).map((file) => file.path), [files]);
  const diffPathsToLoad = useMemo(
    () =>
      reviewDiffPathsToLoad({
        files: diffLoadablePaths,
        selectedPath,
        nearbyPaths: nearbyDiffPaths,
        diffStatesByPath,
      }),
    [diffLoadablePaths, diffStatesByPath, nearbyDiffPaths, selectedPath],
  );
  const resizeFileTree = useCallback(
    (startWidth: number, deltaX: number) => {
      setFileTreeWidth(reviewFileTreeWidth(startWidth + deltaX, width));
    },
    [width],
  );
  const beginFileTreeResize = useHorizontalResize(effectiveFileTreeWidth, resizeFileTree, {
    onActiveChange: setFileTreeResizing,
  });

  useEffect(() => {
    setFileTreeWidth((currentWidth) => reviewFileTreeWidth(currentWidth, width));
  }, [width]);

  const scrollToReviewFile = useCallback((path: string) => {
    const section = diffSectionRefs.current.get(path);
    if (!section) {
      return;
    }
    section.scrollIntoView({ block: "start", behavior: "auto" });
  }, []);

  const handleSelectedPathChange = useCallback(
    (path: string) => {
      selectionSourceRef.current = "navigation";
      onSelectedPathChange(path);
      scrollToReviewFile(path);
    },
    [onSelectedPathChange, scrollToReviewFile],
  );

  const setDiffSectionRef = useCallback((path: string, section: HTMLElement | null) => {
    if (section) {
      diffSectionRefs.current.set(path, section);
      return;
    }
    diffSectionRefs.current.delete(path);
  }, []);

  const setDiffScrollNode = useCallback((node: HTMLElement | null) => {
    diffScrollRef.current = node;
    setDiffScrollElement(node);
  }, []);

  const setDiffPathNearViewport = useCallback((path: string, nearViewport: boolean) => {
    setNearbyDiffPaths((current) => {
      const alreadyNearViewport = current.has(path);
      if (alreadyNearViewport === nearViewport) {
        return current;
      }
      const next = new Set(current);
      if (nearViewport) {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });
  }, []);

  const updateSelectedPathFromScroll = useCallback(() => {
    const scrollContainer = diffScrollRef.current;
    if (!scrollContainer) {
      return;
    }
    const viewportRect = scrollContainer.getBoundingClientRect();
    const sections = files
      .map((file) => {
        const section = diffSectionRefs.current.get(file.path);
        if (!section) {
          return null;
        }
        const rect = section.getBoundingClientRect();
        return { path: file.path, top: rect.top, bottom: rect.bottom };
      })
      .filter((section) => section !== null);
    const nextPath = reviewActiveFilePath(
      sections,
      { top: viewportRect.top, bottom: viewportRect.bottom },
      selectedPath,
    );
    if (nextPath && nextPath !== selectedPath) {
      selectionSourceRef.current = "scroll";
      onSelectedPathChange(nextPath);
    }
  }, [files, onSelectedPathChange, selectedPath]);

  const handleDiffScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) {
      return;
    }
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      updateSelectedPathFromScroll();
    });
  }, [updateSelectedPathFromScroll]);

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!selectedPath) {
      return;
    }
    const source = selectionSourceRef.current;
    selectionSourceRef.current = null;
    if (source === "navigation" || source === "scroll") {
      return;
    }
    scrollToReviewFile(selectedPath);
  }, [files, scrollToReviewFile, selectedPath]);

  useEffect(() => {
    setNearbyDiffPaths(new Set());
  }, [diffLoadablePaths]);

  useEffect(() => {
    for (const path of diffPathsToLoad) {
      loadDiff(path);
    }
  }, [diffPathsToLoad, loadDiff]);

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border bg-card text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <GitCompareArrows className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-medium">Changes</div>
          <div className="flex min-w-0 items-center gap-1.5 text-base text-muted-foreground">
            <span className="shrink-0">{reviewChangedFilesText(listState.files.length)}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 rounded-md text-muted-foreground"
              aria-controls={fileTreeId}
              aria-expanded={fileTreeVisible}
              aria-label={fileTreeToggleLabel}
              title={fileTreeToggleLabel}
              onClick={() => setFileTreeVisible((visible) => !visible)}
            >
              {fileTreeVisible ? <PanelLeftClose className="size-3.5" /> : <PanelLeftOpen className="size-3.5" />}
            </Button>
            <span className="truncate">{reviewScopeContext(scope, listState)}</span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0 rounded-md"
          aria-label="Refresh changes"
          title="Refresh changes"
          disabled={listState.status === "loading"}
          onClick={() => void loadFiles()}
        >
          <RefreshCw className={cn("size-3.5", listState.status === "loading" && "animate-spin")} />
        </Button>
      </header>

      <div className="flex shrink-0 gap-1 border-b border-border px-2 py-1.5">
        <ScopeButton active={scope === "thread"} onClick={() => onScopeChange("thread")}>
          Thread
        </ScopeButton>
        <ScopeButton
          active={scope === "turn"}
          disabled={!effectiveTurnId}
          onClick={() => onScopeChange("turn", effectiveTurnId)}
        >
          Turn
        </ScopeButton>
        <ScopeButton
          active={scope === "branch"}
          disabled={!branchReviewAvailable}
          onClick={() => onScopeChange("branch")}
        >
          Branch
        </ScopeButton>
      </div>

      {listState.status === "error" && <PanelError message={listState.error} />}

      <div
        className="review-panel-content grid min-h-0 flex-1"
        data-file-tree-visible={fileTreeVisible ? "true" : undefined}
        data-file-tree-resizing={fileTreeResizing ? "true" : undefined}
        style={reviewPanelStyle}
      >
        <aside
          id={fileTreeId}
          className="review-file-tree-region relative min-h-0 overflow-hidden bg-background"
          aria-hidden={!fileTreeVisible}
          inert={!fileTreeVisible}
        >
          <div className="h-full min-w-0">
            <ReviewFileTree
              key={reviewFileTreeModelKey}
              files={files}
              selectedPath={selectedPath}
              onSelectedPathChange={handleSelectedPathChange}
            />
          </div>
          <div
            className="no-drag absolute inset-y-0 right-0 z-20 -mr-1 w-2 cursor-col-resize bg-transparent hover:bg-border"
            aria-label="Resize changed files"
            aria-orientation="vertical"
            aria-valuemax={reviewFileTreeWidth(width, width)}
            aria-valuemin={reviewFileTreeWidthBounds.min}
            aria-valuenow={effectiveFileTreeWidth}
            role="separator"
            onPointerDown={beginFileTreeResize}
          />
        </aside>
        <DiffVirtualizerScrollArea onScroll={handleDiffScroll} onScrollRootChange={setDiffScrollNode}>
          <DiffStream
            diffStatesByPath={diffStatesByPath}
            files={files}
            scrollRoot={diffScrollElement}
            onLoadFull={loadFullDiff}
            onRefresh={loadDiff}
            onNearViewportChange={setDiffPathNearViewport}
            onSectionRef={setDiffSectionRef}
          />
        </DiffVirtualizerScrollArea>
      </div>
    </div>
  );
}

type ReviewPanelStyle = CSSProperties & {
  "--review-file-tree-width": string;
};

function DiffVirtualizerScrollArea({
  children,
  onScroll,
  onScrollRootChange,
}: {
  children: React.ReactNode;
  onScroll: React.UIEventHandler<HTMLElement>;
  onScrollRootChange: (node: HTMLElement | null) => void;
}): React.JSX.Element {
  const [virtualizer] = useState(() =>
    typeof window === "undefined"
      ? undefined
      : new DiffsVirtualizer({
          overscrollSize: 1_200,
          intersectionObserverMargin: 4_800,
        }),
  );
  const setRoot = useCallback(
    (node: HTMLElement | null) => {
      if (node) {
        onScrollRootChange(node);
        virtualizer?.setup(node);
        return;
      }
      virtualizer?.cleanUp();
      onScrollRootChange(null);
    },
    [onScrollRootChange, virtualizer],
  );

  return (
    <VirtualizerContext.Provider value={virtualizer}>
      <section
        ref={setRoot}
        className="workspace-scrollbar min-h-0 min-w-0 flex-1 overflow-auto bg-background"
        onScroll={onScroll}
      >
        {children}
      </section>
    </VirtualizerContext.Provider>
  );
}

const reviewFileTreeUnsafeCSS = `
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

  [data-file-tree-search-container] {
    padding-inline: 0.75rem;
    margin-bottom: 0.5rem;
  }

  [data-file-tree-search-input] {
    box-sizing: border-box;
    height: 2rem;
    margin-block: 0.5rem 0;
    padding-inline: 0.75rem;
    line-height: 1.5;
    color: var(--color-foreground);
    background-color: var(--color-background);
    border-color: var(--color-input);
    border-radius: var(--radius);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
  }

  [data-file-tree-search-input]::placeholder {
    color: var(--color-muted-foreground);
    opacity: 1;
  }

  [data-file-tree-search-input]:focus-visible,
  [data-file-tree-search-input][data-file-tree-search-input-fake-focus='true'] {
    border-color: var(--color-ring);
    outline: none;
    box-shadow:
      0 1px 2px rgb(0 0 0 / 0.05),
      0 0 0 3px color-mix(in oklab, var(--color-ring) 50%, transparent);
  }
`;

// @pierre/trees stores unsafeCSS on the FileTree model at construction time.
// During Fast Refresh, remount just this child when the injected styles change.
const reviewFileTreeModelKey = import.meta.env.DEV ? reviewFileTreeUnsafeCSS : undefined;

function selectOnlyReviewFile(model: FileTreeModel, path: string): boolean {
  const item = model.getItem(path);
  if (!item) {
    return false;
  }
  for (const selectedPath of model.getSelectedPaths()) {
    if (selectedPath !== path) {
      model.getItem(selectedPath)?.deselect();
    }
  }
  if (!item.isSelected()) {
    item.select();
  }
  return true;
}

function ReviewFileTree({
  files,
  selectedPath,
  onSelectedPathChange,
}: {
  files: ReviewFile[];
  selectedPath: string;
  onSelectedPathChange: (path: string) => void;
}): React.JSX.Element {
  const fileMap = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);
  const fileMapRef = useRef(fileMap);
  const modelRef = useRef<FileTreeModel | null>(null);
  const normalizingSelectionRef = useRef(false);
  const selectRef = useRef(onSelectedPathChange);
  const selectedPathRef = useRef(selectedPath);
  fileMapRef.current = fileMap;
  selectRef.current = onSelectedPathChange;
  selectedPathRef.current = selectedPath;

  const { model } = useFileTree({
    paths: [],
    flattenEmptyDirectories: true,
    initialExpansion: "open",
    itemHeight: 32,
    search: true,
    stickyFolders: true,
    gitStatus: [],
    onSelectionChange: (paths) => {
      if (normalizingSelectionRef.current) {
        return;
      }
      const nextPath = reviewLatestSelectedFilePath(paths, fileMapRef.current.keys(), selectedPathRef.current);
      if (nextPath && (paths.length !== 1 || paths[0] !== nextPath)) {
        const model = modelRef.current;
        if (model) {
          normalizingSelectionRef.current = true;
          try {
            selectOnlyReviewFile(model, nextPath);
          } finally {
            normalizingSelectionRef.current = false;
          }
        }
      }
      if (nextPath && nextPath !== selectedPathRef.current) {
        selectRef.current(nextPath);
      }
    },
    renderRowDecoration: ({ item }) => {
      const file = fileMapRef.current.get(item.path);
      if (!file) {
        return null;
      }
      return {
        text: fileStats(file),
        title: `${file.additions} additions, ${file.deletions} deletions`,
      };
    },
    unsafeCSS: reviewFileTreeUnsafeCSS,
  });
  modelRef.current = model;

  const paths = useMemo(() => files.map((file) => file.path), [files]);
  const gitStatus = useMemo<GitStatusEntry[]>(
    () => files.map((file) => ({ path: file.path, status: fileTreeGitStatus(file.status) })),
    [files],
  );

  useEffect(() => {
    model.resetPaths(paths, { initialExpandedPaths: directoryPaths(paths) });
    model.setGitStatus(gitStatus);
  }, [gitStatus, model, paths]);

  useEffect(() => {
    if (!selectedPath) {
      return;
    }
    normalizingSelectionRef.current = true;
    try {
      if (!selectOnlyReviewFile(model, selectedPath)) {
        return;
      }
    } finally {
      normalizingSelectionRef.current = false;
    }
    model.scrollToPath(selectedPath, { focus: false, offset: "nearest" });
  }, [model, selectedPath]);

  if (files.length === 0) {
    return <div className="px-3 py-4 text-base text-muted-foreground">No changes found.</div>;
  }

  return <FileTree model={model} className="block h-full w-full" />;
}

function DiffStream({
  diffStatesByPath,
  files,
  scrollRoot,
  onRefresh,
  onLoadFull,
  onNearViewportChange,
  onSectionRef,
}: {
  diffStatesByPath: Record<string, ReviewDiffState>;
  files: ReviewFile[];
  scrollRoot: HTMLElement | null;
  onLoadFull: (path: string) => void;
  onRefresh: (path: string, options?: { force?: boolean }) => void;
  onNearViewportChange: (path: string, nearViewport: boolean) => void;
  onSectionRef: (path: string, section: HTMLElement | null) => void;
}): React.JSX.Element {
  if (files.length === 0) {
    return <CenteredText>No changed files to review.</CenteredText>;
  }

  return (
    <div className="min-w-full divide-y divide-border">
      {files.map((file) => (
        <DiffFileSection
          key={file.path}
          diffState={diffStatesByPath[file.path] ?? { status: "idle", patch: "" }}
          file={file}
          scrollRoot={scrollRoot}
          onLoadFull={onLoadFull}
          onNearViewportChange={onNearViewportChange}
          onRefresh={onRefresh}
          onSectionRef={onSectionRef}
        />
      ))}
    </div>
  );
}

function DiffFileSection({
  diffState,
  file,
  scrollRoot,
  onRefresh,
  onLoadFull,
  onNearViewportChange,
  onSectionRef,
}: {
  diffState: ReviewDiffState;
  file: ReviewFile;
  scrollRoot: HTMLElement | null;
  onLoadFull: (path: string) => void;
  onRefresh: (path: string, options?: { force?: boolean }) => void;
  onNearViewportChange: (path: string, nearViewport: boolean) => void;
  onSectionRef: (path: string, section: HTMLElement | null) => void;
}): React.JSX.Element {
  const [sectionNode, setSectionNode] = useState<HTMLElement | null>(null);
  const setSection = useCallback(
    (section: HTMLElement | null) => {
      setSectionNode(section);
      onSectionRef(file.path, section);
    },
    [file.path, onSectionRef],
  );

  useEffect(() => {
    if (!scrollRoot || !sectionNode || file.binary) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) {
          onNearViewportChange(file.path, entry.isIntersecting);
        }
      },
      {
        root: scrollRoot,
        rootMargin: "900px 0px",
        threshold: 0,
      },
    );
    observer.observe(sectionNode);
    return () => {
      observer.disconnect();
      onNearViewportChange(file.path, false);
    };
  }, [file.binary, file.path, onNearViewportChange, scrollRoot, sectionNode]);

  return (
    <section
      ref={setSection}
      className="review-diff-file-section scroll-mt-0 bg-background"
      data-review-file-path={file.path}
    >
      <DiffFileBody
        diffState={diffState}
        file={file}
        onLoadFull={() => onLoadFull(file.path)}
        onRefresh={() => onRefresh(file.path, { force: true })}
      />
    </section>
  );
}

function DiffFileBody({
  diffState,
  file,
  onRefresh,
  onLoadFull,
}: {
  diffState: ReviewDiffState;
  file: ReviewFile;
  onLoadFull: () => void;
  onRefresh: () => void;
}): React.JSX.Element {
  if (file.binary) {
    return (
      <>
        <FallbackFileHeader file={file} />
        <InlineText>Binary file cannot be previewed.</InlineText>
      </>
    );
  }
  if (diffState.status === "error") {
    return (
      <>
        <FallbackFileHeader file={file} />
        <div className="space-y-3 p-4">
          <PanelError message={diffState.error} inline />
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="size-3.5" />
            Retry
          </Button>
        </div>
      </>
    );
  }
  if (diffState.status === "loading" && !diffState.patch) {
    return (
      <>
        <FallbackFileHeader file={file} loading />
        <InlineText>Loading diff...</InlineText>
      </>
    );
  }
  if (!diffState.patch) {
    return (
      <>
        <FallbackFileHeader file={file} />
        <InlineText>Loading diff...</InlineText>
      </>
    );
  }
  if (diffState.status === "ready" && diffState.truncated) {
    return (
      <>
        <FallbackFileHeader file={file} />
        <div className="space-y-3 p-4">
          <PanelError message="This diff is too large to render completely in the first page." inline />
          <Button variant="outline" size="sm" onClick={onLoadFull}>
            <FileDiff className="size-3.5" />
            Load full diff
          </Button>
        </div>
      </>
    );
  }
  return <PatchDiff patch={diffState.patch} options={diffOptions} disableWorkerPool className="block min-w-full" />;
}

function FallbackFileHeader({ file, loading = false }: { file: ReviewFile; loading?: boolean }): React.JSX.Element {
  return (
    <div className="flex min-h-11 items-center gap-2 border-b border-border px-3">
      <FileDiff className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-medium">{file.path}</div>
        {file.oldPath && <div className="truncate text-base text-muted-foreground">Renamed from {file.oldPath}</div>}
      </div>
      <StatusPill status={file.status} />
      {loading && <RefreshCw className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
    </div>
  );
}

function ScopeButton({
  active,
  disabled,
  children,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "h-8 rounded-md px-2.5 text-base font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
        active && "bg-accent text-accent-foreground",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: VcsChangeStatus }): React.JSX.Element | null {
  const label = reviewFileTreeStatusLabel(status);
  if (!label) {
    return null;
  }
  return (
    <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-base font-medium text-muted-foreground">
      {label}
    </span>
  );
}

function fileTreeGitStatus(status: VcsChangeStatus): GitStatus {
  return status === "provider_native" ? "modified" : status;
}

function PanelError({ message, inline = false }: { message: string; inline?: boolean }): React.JSX.Element {
  return (
    <div className={cn(!inline && "border-b border-border px-3 py-2")}>
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-base text-destructive">
        <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0 flex-1">{message}</span>
      </div>
    </div>
  );
}

function CenteredText({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center p-4 text-center text-base text-muted-foreground">
      {children}
    </div>
  );
}

function InlineText({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="p-4 text-base text-muted-foreground">{children}</div>;
}

function fileStats(file: Pick<ReviewFile, "additions" | "deletions">): string {
  if (file.additions === 0 && file.deletions === 0) {
    return "";
  }
  return `+${file.additions} -${file.deletions}`;
}

function reviewScopeContext(scope: RouteReviewScope, listState: ReviewListState): string {
  if (listState.status === "loading") {
    return "Loading...";
  }
  if (listState.status === "error") {
    return "Unable to load changes";
  }
  if (scope === "branch" && listState.status === "ready") {
    const branch = listState.branch ?? "branch";
    const base = listState.baseRef ?? "base";
    return `${branch} compared with ${base}`;
  }
  if (scope === "turn") {
    return "in this turn";
  }
  return "in this thread";
}

function directoryPaths(paths: string[]): string[] {
  const directories = new Set<string>();
  for (const path of paths) {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join("/"));
    }
  }
  return Array.from(directories);
}

const diffOptions = {
  diffStyle: "split",
  hunkSeparators: "line-info-basic",
  overflow: "scroll",
  stickyHeader: true,
  theme: {
    dark: "pierre-dark-soft",
    light: "pierre-light",
  },
  themeType: "system",
  unsafeCSS: `
    :host {
      --diffs-font-family: var(--font-code);
      --diffs-font-size: var(--font-size-code);
      --diffs-line-height: calc(var(--font-size-code) + 7px);
    }
  `,
} as const;

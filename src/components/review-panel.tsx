import { FileTree, useFileTree } from "@pierre/trees/react";
import { Virtualizer as DiffsVirtualizer } from "@pierre/diffs";
import { PatchDiff, VirtualizerContext } from "@pierre/diffs/react";
import type { FileTree as FileTreeModel, GitStatus, GitStatusEntry } from "@pierre/trees";
import { LayoutAlignLeftIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircle,
  ChevronRight,
  Columns2,
  Eye,
  EyeOff,
  FileDiff,
  MoreHorizontal,
  RefreshCw,
  Rows2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
} from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useReviewChanges, type ReviewDiffState, type ReviewFile } from "@/hooks/use-review-changes";
import { useHorizontalResize } from "@/hooks/use-horizontal-resize";
import {
  reviewActiveFilePath,
  reviewBranchAreaFiles,
  reviewChangedFilesHeadline,
  reviewChangedFilesTotals,
  reviewFileTreeDefaultVisible,
  reviewDiffPathsToLoad,
  reviewFileTreeStatusLabel,
  reviewFileTreeToggleLabel,
  reviewFileTreeWidth,
  reviewFileTreeWidthBounds,
  reviewLatestSelectedFilePath,
  type ReviewBranchAreaFilter,
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
  const [diffViewMode, setDiffViewMode] = useState<ReviewDiffViewMode>("split");
  const [diffsCollapsed, setDiffsCollapsed] = useState(false);
  const [diffCollapseOverrides, setDiffCollapseOverrides] = useState<Record<string, boolean>>({});
  const [showWhitespace, setShowWhitespace] = useState(true);
  const [branchAreaFilter, setBranchAreaFilter] = useState<ReviewBranchAreaFilter>("all");
  const effectiveBranchAreaFilter = scope === "branch" ? branchAreaFilter : "all";
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
    branchAreaFilter: effectiveBranchAreaFilter,
    turnId,
    selectedPath,
    ignoreWhitespace: !showWhitespace,
    appServerMethods,
    threadHunks,
    threadObservedChanges,
    threadLatestTurnId,
    onSelectedPathChange,
  });
  const [fileTreeVisible, setFileTreeVisible] = useState(reviewFileTreeDefaultVisible);
  const [fileTreeWidth, setFileTreeWidth] = useState<number>(reviewFileTreeWidthBounds.defaultValue);
  const [fileTreeResizing, setFileTreeResizing] = useState(false);
  const [diffScrollElement, setDiffScrollElement] = useState<HTMLElement | null>(null);
  const [nearbyDiffPaths, setNearbyDiffPaths] = useState<Set<string>>(() => new Set());
  const fileTreeId = useId();
  const diffScrollRef = useRef<HTMLElement | null>(null);
  const diffSectionRefs = useRef<Map<string, HTMLElement> | null>(null);
  if (!diffSectionRefs.current) {
    diffSectionRefs.current = new Map<string, HTMLElement>();
  }
  const diffSections = diffSectionRefs.current;
  const selectionSourceRef = useRef<"navigation" | "scroll" | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  // Section bounds in scroll-content coordinates, measured lazily and reused
  // across scroll frames so scrolling never forces per-section layout reads.
  const sectionBoundsRef = useRef<Map<string, { top: number; bottom: number }> | null>(null);
  const sectionResizeObserverRef = useRef<ResizeObserver | null>(null);
  if (!sectionResizeObserverRef.current && typeof ResizeObserver !== "undefined") {
    sectionResizeObserverRef.current = new ResizeObserver(() => {
      sectionBoundsRef.current = null;
    });
  }
  const fileTreeToggleLabel = reviewFileTreeToggleLabel(fileTreeVisible);
  const effectiveFileTreeWidth = reviewFileTreeWidth(fileTreeWidth, width);
  const reviewPanelStyle = { "--review-file-tree-width": `${effectiveFileTreeWidth}px` } as ReviewPanelStyle;
  const reviewFiles = useMemo(
    () => reviewBranchAreaFiles(files, effectiveBranchAreaFilter),
    [effectiveBranchAreaFilter, files],
  );
  const reviewTotals = useMemo(() => reviewChangedFilesTotals(reviewFiles), [reviewFiles]);
  // PatchDiff treats options identity as input, so keep it stable until the actual renderer settings change.
  const reviewDiffOptions = useMemo(
    () =>
      getReviewDiffOptions({
        collapsed: diffsCollapsed,
        diffStyle: diffViewMode,
      }),
    [diffViewMode, diffsCollapsed],
  );
  const diffLoadablePaths = useMemo(
    () => reviewFiles.filter((file) => !file.binary).map((file) => file.path),
    [reviewFiles],
  );
  const currentNearbyDiffPaths = useMemo(() => {
    const loadablePaths = new Set(diffLoadablePaths);
    return new Set([...nearbyDiffPaths].filter((path) => loadablePaths.has(path)));
  }, [diffLoadablePaths, nearbyDiffPaths]);
  const diffPathsToLoad = useMemo(
    () =>
      reviewDiffPathsToLoad({
        files: diffLoadablePaths,
        selectedPath,
        nearbyPaths: currentNearbyDiffPaths,
        diffStatesByPath,
      }),
    [currentNearbyDiffPaths, diffLoadablePaths, diffStatesByPath, selectedPath],
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

  const scrollToReviewFile = useCallback(
    (path: string) => {
      const section = diffSections.get(path);
      if (!section) {
        return;
      }
      section.scrollIntoView({ block: "start", behavior: "auto" });
    },
    [diffSections],
  );

  const handleSelectedPathChange = useCallback(
    (path: string) => {
      selectionSourceRef.current = "navigation";
      onSelectedPathChange(path);
      scrollToReviewFile(path);
    },
    [onSelectedPathChange, scrollToReviewFile],
  );

  const setDiffSectionRef = useCallback(
    (path: string, section: HTMLElement | null) => {
      sectionBoundsRef.current = null;
      const previous = diffSections.get(path);
      if (previous) {
        sectionResizeObserverRef.current?.unobserve(previous);
      }
      if (section) {
        diffSections.set(path, section);
        sectionResizeObserverRef.current?.observe(section);
        return;
      }
      diffSections.delete(path);
    },
    [diffSections],
  );

  useEffect(
    () => () => {
      sectionResizeObserverRef.current?.disconnect();
    },
    [],
  );

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

  const measureSectionBounds = useCallback(
    (scrollContainer: HTMLElement) => {
      const containerRect = scrollContainer.getBoundingClientRect();
      const offset = scrollContainer.scrollTop - containerRect.top;
      const bounds = new Map<string, { top: number; bottom: number }>();
      for (const [path, section] of diffSections) {
        const rect = section.getBoundingClientRect();
        bounds.set(path, { top: rect.top + offset, bottom: rect.bottom + offset });
      }
      return bounds;
    },
    [diffSections],
  );

  const updateSelectedPathFromScroll = useCallback(() => {
    const scrollContainer = diffScrollRef.current;
    if (!scrollContainer) {
      return;
    }
    sectionBoundsRef.current ??= measureSectionBounds(scrollContainer);
    const sectionBounds = sectionBoundsRef.current;
    const sections: Array<{ path: string; top: number; bottom: number }> = [];
    for (const file of reviewFiles) {
      const bounds = sectionBounds.get(file.path);
      if (bounds) {
        sections.push({ path: file.path, top: bounds.top, bottom: bounds.bottom });
      }
    }
    const viewportTop = scrollContainer.scrollTop;
    const nextPath = reviewActiveFilePath(
      sections,
      { top: viewportTop, bottom: viewportTop + scrollContainer.clientHeight },
      selectedPath,
    );
    if (nextPath && nextPath !== selectedPath) {
      selectionSourceRef.current = "scroll";
      onSelectedPathChange(nextPath);
    }
  }, [measureSectionBounds, onSelectedPathChange, reviewFiles, selectedPath]);

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
  }, [reviewFiles, scrollToReviewFile, selectedPath]);

  function selectReviewScope(nextScope: RouteReviewScope, nextTurnId?: string): void {
    setBranchAreaFilter("all");
    onScopeChange(nextScope, nextTurnId);
  }

  function selectBranchArea(nextFilter: ReviewBranchAreaFilter): void {
    setBranchAreaFilter(nextFilter);
    onScopeChange("branch");
    if (scope !== "branch") {
      return;
    }
    const nextFiles = reviewBranchAreaFiles(files, nextFilter);
    if (selectedPath && nextFiles.some((file) => file.path === selectedPath)) {
      return;
    }
    onSelectedPathChange(nextFiles[0]?.path ?? "");
  }

  function refreshReview(): void {
    void loadFiles();
    for (const file of reviewFiles) {
      if (!file.binary) {
        loadDiff(file.path, { force: true });
      }
    }
  }

  function setAllDiffsCollapsed(collapsed: boolean): void {
    setDiffsCollapsed(collapsed);
    setDiffCollapseOverrides({});
  }

  function setDiffFileCollapsed(path: string, collapsed: boolean): void {
    setDiffCollapseOverrides((current) => ({
      ...current,
      [path]: collapsed,
    }));
  }

  useEffect(() => {
    for (const path of diffPathsToLoad) {
      loadDiff(path);
    }
  }, [diffPathsToLoad, loadDiff]);

  const fileTreeToggleButton = (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 shrink-0 rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground [&_svg]:size-4"
      aria-controls={fileTreeId}
      aria-expanded={fileTreeVisible}
      aria-label={fileTreeToggleLabel}
      title={fileTreeToggleLabel}
      onClick={() => setFileTreeVisible((visible) => !visible)}
    >
      <HugeiconsIcon icon={LayoutAlignLeftIcon} strokeWidth={1.7} />
    </Button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-card text-foreground">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-card px-3">
        {fileTreeToggleButton}
        <ScopeButton active={scope === "thread"} onClick={() => selectReviewScope("thread")}>
          Thread
        </ScopeButton>
        <ScopeButton
          active={scope === "turn"}
          disabled={!effectiveTurnId}
          onClick={() => selectReviewScope("turn", effectiveTurnId)}
        >
          Turn
        </ScopeButton>
        <ScopeButton
          active={scope === "branch" && branchAreaFilter === "all"}
          disabled={!branchReviewAvailable}
          onClick={() => selectBranchArea("all")}
        >
          Branch
        </ScopeButton>
        <ScopeButton
          active={scope === "branch" && branchAreaFilter === "staged"}
          disabled={!branchReviewAvailable}
          onClick={() => selectBranchArea("staged")}
        >
          Staged
        </ScopeButton>
        <ScopeButton
          active={scope === "branch" && branchAreaFilter === "unstaged"}
          disabled={!branchReviewAvailable}
          onClick={() => selectBranchArea("unstaged")}
        >
          Unstaged
        </ScopeButton>
        <div className="min-w-0 flex-1" />
        <ReviewOptionsMenu
          collapsed={diffsCollapsed}
          diffViewMode={diffViewMode}
          showWhitespace={showWhitespace}
          onCollapsedChange={setAllDiffsCollapsed}
          onDiffViewModeChange={setDiffViewMode}
          onRefresh={refreshReview}
          onShowWhitespaceChange={setShowWhitespace}
        />
      </div>

      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-base">
          <span className="shrink-0 font-medium">{reviewChangedFilesHeadline(reviewFiles.length)}</span>
        </div>
        <span className="flex shrink-0 items-center gap-2 font-mono text-sm">
          <span className="text-emerald-600">+{reviewTotals.additions}</span>
          <span className="text-red-600">-{reviewTotals.deletions}</span>
        </span>
      </header>

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
              files={reviewFiles}
              selectedPath={selectedPath}
              onSelectedPathChange={handleSelectedPathChange}
            />
          </div>
          <hr
            className="no-drag absolute inset-y-0 right-0 z-20 -mr-1 w-2 cursor-col-resize border-0 bg-transparent hover:bg-border"
            aria-label="Resize changed files"
            aria-orientation="vertical"
            aria-valuemax={reviewFileTreeWidth(width, width)}
            aria-valuemin={reviewFileTreeWidthBounds.min}
            aria-valuenow={effectiveFileTreeWidth}
            onPointerDown={beginFileTreeResize}
          />
        </aside>
        <DiffVirtualizerScrollArea onScroll={handleDiffScroll} onScrollRootChange={setDiffScrollNode}>
          <DiffStream
            diffStatesByPath={diffStatesByPath}
            collapseOverrides={diffCollapseOverrides}
            diffOptions={reviewDiffOptions}
            fallbackCollapsed={diffsCollapsed}
            files={reviewFiles}
            ignoringWhitespace={!showWhitespace}
            scrollRoot={diffScrollElement}
            onCollapsedChange={setDiffFileCollapsed}
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

type ReviewDiffViewMode = "split" | "unified";
type ReviewDiffOptions = NonNullable<ComponentProps<typeof PatchDiff>["options"]>;

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
  collapseOverrides,
  diffStatesByPath,
  diffOptions,
  fallbackCollapsed,
  files,
  ignoringWhitespace,
  scrollRoot,
  onCollapsedChange,
  onRefresh,
  onLoadFull,
  onNearViewportChange,
  onSectionRef,
}: {
  collapseOverrides: Record<string, boolean>;
  diffStatesByPath: Record<string, ReviewDiffState>;
  diffOptions: ReviewDiffOptions;
  fallbackCollapsed: boolean;
  files: ReviewFile[];
  ignoringWhitespace: boolean;
  scrollRoot: HTMLElement | null;
  onCollapsedChange: (path: string, collapsed: boolean) => void;
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
          collapsed={collapseOverrides[file.path] ?? fallbackCollapsed}
          diffState={diffStatesByPath[file.path] ?? { status: "idle", patch: "" }}
          diffOptions={diffOptions}
          file={file}
          ignoringWhitespace={ignoringWhitespace}
          scrollRoot={scrollRoot}
          onCollapsedChange={onCollapsedChange}
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
  collapsed,
  diffState,
  diffOptions,
  file,
  ignoringWhitespace,
  scrollRoot,
  onCollapsedChange,
  onRefresh,
  onLoadFull,
  onNearViewportChange,
  onSectionRef,
}: {
  collapsed: boolean;
  diffState: ReviewDiffState;
  diffOptions: ReviewDiffOptions;
  file: ReviewFile;
  ignoringWhitespace: boolean;
  scrollRoot: HTMLElement | null;
  onCollapsedChange: (path: string, collapsed: boolean) => void;
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
      className="review-diff-file-section scroll-mt-0 border-border bg-background last:border-b"
      data-review-file-path={file.path}
    >
      <DiffFileBody
        collapsed={collapsed}
        diffState={diffState}
        diffOptions={diffOptions}
        file={file}
        ignoringWhitespace={ignoringWhitespace}
        onLoadFull={() => onLoadFull(file.path)}
        onCollapsedChange={() => onCollapsedChange(file.path, !collapsed)}
        onRefresh={() => onRefresh(file.path, { force: true })}
      />
    </section>
  );
}

function DiffFileBody({
  collapsed,
  diffState,
  diffOptions,
  file,
  ignoringWhitespace,
  onCollapsedChange,
  onRefresh,
  onLoadFull,
}: {
  collapsed: boolean;
  diffState: ReviewDiffState;
  diffOptions: ReviewDiffOptions;
  file: ReviewFile;
  ignoringWhitespace: boolean;
  onCollapsedChange: () => void;
  onLoadFull: () => void;
  onRefresh: () => void;
}): React.JSX.Element {
  // Preserve options identity for PatchDiff while still allowing each file to override collapse state.
  const fileDiffOptions = useMemo(() => ({ ...diffOptions, collapsed }), [collapsed, diffOptions]);

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
        <InlineText>Loading diff…</InlineText>
      </>
    );
  }
  if (!diffState.patch) {
    const whitespaceIgnoredForFile = ignoringWhitespace && file.source !== "hunk";
    const emptyMessage =
      diffState.status === "ready"
        ? whitespaceIgnoredForFile
          ? "No non-whitespace changes to show."
          : "No diff content to show."
        : "Loading diff...";
    return (
      <>
        <FallbackFileHeader file={file} />
        <InlineText>{emptyMessage}</InlineText>
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
  return (
    <PatchDiff
      patch={diffState.patch}
      options={fileDiffOptions}
      renderHeaderPrefix={() => (
        <DiffFileCollapseButton collapsed={collapsed} filePath={file.path} onToggle={onCollapsedChange} />
      )}
      disableWorkerPool
      className="block min-w-full"
    />
  );
}

function DiffFileCollapseButton({
  collapsed,
  filePath,
  onToggle,
}: {
  collapsed: boolean;
  filePath: string;
  onToggle: () => void;
}): React.JSX.Element {
  const label = collapsed ? `Expand ${filePath}` : `Collapse ${filePath}`;

  return (
    <button
      type="button"
      className="flex size-7 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
    >
      <ChevronRight className={cn("size-4 transition-transform", !collapsed && "rotate-90")} />
    </button>
  );
}

function ReviewOptionsMenu({
  collapsed,
  diffViewMode,
  showWhitespace,
  onCollapsedChange,
  onDiffViewModeChange,
  onRefresh,
  onShowWhitespaceChange,
}: {
  collapsed: boolean;
  diffViewMode: ReviewDiffViewMode;
  showWhitespace: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onDiffViewModeChange: (mode: ReviewDiffViewMode) => void;
  onRefresh: () => void;
  onShowWhitespaceChange: (showWhitespace: boolean) => void;
}): React.JSX.Element {
  const nextDiffViewMode = diffViewMode === "split" ? "unified" : "split";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[popup-open]:bg-muted/40 data-[popup-open]:text-foreground"
        aria-label="Review options"
        title="Review options"
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" className="min-w-60">
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={onRefresh}>
            <RefreshCw className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">Refresh</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onDiffViewModeChange(nextDiffViewMode)}>
            {diffViewMode === "split" ? (
              <Rows2 className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <Columns2 className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1">
              {diffViewMode === "split" ? "Use above/below view" : "Use split view"}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onCollapsedChange(!collapsed)}>
            <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground", !collapsed && "rotate-90")} />
            <span className="min-w-0 flex-1">{collapsed ? "Expand all diffs" : "Collapse all diffs"}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onShowWhitespaceChange(!showWhitespace)}>
            {showWhitespace ? (
              <EyeOff className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <Eye className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1">{showWhitespace ? "Hide whitespace" : "Show whitespace"}</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
        "h-7 rounded-full px-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
        active && "bg-accent/60 text-foreground hover:bg-accent/60",
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

function getReviewDiffOptions({
  collapsed,
  diffStyle,
}: {
  collapsed: boolean;
  diffStyle: ReviewDiffViewMode;
}): ReviewDiffOptions {
  return {
    collapsed,
    diffStyle,
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
        --diffs-header-font-family: var(--font-ui);
        --diffs-font-family: var(--font-code);
        --diffs-font-size: var(--font-size-code);
        --diffs-line-height: calc(var(--font-size-code) + 12px);
      }

      [data-diffs-header=default] {
        cursor: default;
        font-size: var(--font-size-ui);
        line-height: 1.5;
        padding-inline: 12px;
      }

      [data-diffs-header=default] * {
        cursor: default;
      }

      [data-change-icon] {
        box-sizing: border-box;
        width: 28px;
        height: 28px;
        padding: 5px;
      }

      [data-header-content] slot[name='header-prefix'] + [data-change-icon] {
        display: none;
      }

      [data-header-content] [data-title],
      [data-header-content] [data-prev-name] {
        font-weight: 500;
      }
    `,
  };
}

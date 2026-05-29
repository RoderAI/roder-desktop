import { FileTree, useFileTree } from "@pierre/trees/react";
import { PatchDiff } from "@pierre/diffs/react";
import type { GitStatusEntry } from "@pierre/trees";
import { AlertCircle, FileDiff, GitCompareArrows, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  useReviewChanges,
  type ReviewDiffState,
  type ReviewFile,
  type ReviewListState,
} from "@/hooks/use-review-changes";
import type { RouteReviewScope } from "@/lib/route-search";
import { cn } from "@/lib/utils";
import type { GitChangeStatus, HunkRecord, WorkspaceChangeObservation } from "@/types/roder";

type ReviewPanelProps = {
  threadId: string;
  workspace: string;
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
  workspace,
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
    diffState,
    effectiveTurnId,
    files,
    listState,
    loadDiff,
    loadFiles,
    loadFullDiff,
    selectedFile,
  } = useReviewChanges({
    threadId,
    workspace,
    scope,
    turnId,
    selectedPath,
    appServerMethods,
    threadHunks,
    threadObservedChanges,
    threadLatestTurnId,
    onSelectedPathChange,
  });
  const wideLayout = width >= 680;

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border bg-card text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <GitCompareArrows className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-medium">Changes</div>
          <div className="truncate text-base text-muted-foreground">{reviewSubtitle(scope, listState)}</div>
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

      <div className={cn("flex min-h-0 flex-1", wideLayout ? "flex-row" : "flex-col")}>
        <aside
          className={cn(
            "min-h-0 shrink-0 bg-sidebar/70",
            wideLayout ? "w-60 border-r border-border" : "h-56 border-b border-border",
          )}
        >
          <ReviewFileTree files={files} selectedPath={selectedPath} onSelectedPathChange={onSelectedPathChange} />
        </aside>
        <section className="flex min-w-0 flex-1 flex-col bg-background">
          <DiffHeader file={selectedFile} diffState={diffState} />
          <div className="min-h-0 flex-1 overflow-auto">
            <DiffBody
              diffState={diffState}
              selectedFile={selectedFile}
              onLoadFull={loadFullDiff}
              onRefresh={() => void loadDiff()}
            />
          </div>
        </section>
      </div>
    </div>
  );
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
  const selectRef = useRef(onSelectedPathChange);
  fileMapRef.current = fileMap;
  selectRef.current = onSelectedPathChange;

  const { model } = useFileTree({
    paths: [],
    flattenEmptyDirectories: true,
    initialExpansion: "open",
    itemHeight: 28,
    search: true,
    stickyFolders: true,
    gitStatus: [],
    onSelectionChange: (paths) => {
      const nextPath = paths.find((path) => fileMapRef.current.has(path));
      if (nextPath) {
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
    unsafeCSS: `
      :host {
        --trees-fg-override: hsl(var(--sidebar-foreground));
        --trees-muted-fg-override: hsl(var(--muted-foreground));
        --trees-selected-bg-override: hsl(var(--sidebar-accent));
        --trees-border-color-override: hsl(var(--border));
        font-family: inherit;
        font-size: 12px;
      }
    `,
  });

  const paths = useMemo(() => files.map((file) => file.path), [files]);
  const gitStatus = useMemo<GitStatusEntry[]>(
    () => files.map((file) => ({ path: file.path, status: file.status })),
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
    const item = model.getItem(selectedPath);
    if (!item) {
      return;
    }
    item.select();
    model.scrollToPath(selectedPath, { focus: false, offset: "nearest" });
  }, [model, selectedPath]);

  if (files.length === 0) {
    return <div className="px-3 py-4 text-base text-muted-foreground">No changes found.</div>;
  }

  return <FileTree model={model} className="block h-full w-full" />;
}

function DiffHeader({ file, diffState }: { file: ReviewFile | null; diffState: ReviewDiffState }): React.JSX.Element {
  return (
    <div className="flex min-h-11 shrink-0 items-center gap-2 border-b border-border px-3">
      <FileDiff className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-medium">{file?.path ?? "Select a file"}</div>
        {file?.oldPath && <div className="truncate text-base text-muted-foreground">Renamed from {file.oldPath}</div>}
      </div>
      {file && <StatusPill status={file.status} />}
      {diffState.status === "loading" && <RefreshCw className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
    </div>
  );
}

function DiffBody({
  diffState,
  selectedFile,
  onRefresh,
  onLoadFull,
}: {
  diffState: ReviewDiffState;
  selectedFile: ReviewFile | null;
  onLoadFull: () => void;
  onRefresh: () => void;
}): React.JSX.Element {
  if (!selectedFile) {
    return <CenteredText>Select a changed file to review its diff.</CenteredText>;
  }
  if (diffState.status === "error") {
    return (
      <div className="space-y-3 p-4">
        <PanelError message={diffState.error} inline />
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="size-3.5" />
          Retry
        </Button>
      </div>
    );
  }
  if (diffState.status === "loading" && !diffState.patch) {
    return <CenteredText>Loading diff...</CenteredText>;
  }
  if (!diffState.patch) {
    return <CenteredText>No patch text is available for this file.</CenteredText>;
  }
  if (diffState.status === "ready" && diffState.truncated) {
    return (
      <div className="space-y-3 p-4">
        <PanelError message="This diff is too large to render completely in the first page." inline />
        <Button variant="outline" size="sm" onClick={onLoadFull}>
          <FileDiff className="size-3.5" />
          Load full diff
        </Button>
      </div>
    );
  }
  return <PatchDiff patch={diffState.patch} options={diffOptions} disableWorkerPool className="block min-w-full" />;
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

function StatusPill({ status }: { status: GitChangeStatus }): React.JSX.Element {
  return (
    <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-base font-medium text-muted-foreground">
      {statusLabel(status)}
    </span>
  );
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

function fileStats(file: Pick<ReviewFile, "additions" | "deletions">): string {
  if (file.additions === 0 && file.deletions === 0) {
    return "";
  }
  return `+${file.additions} -${file.deletions}`;
}

function statusLabel(status: GitChangeStatus): string {
  if (status === "untracked") {
    return "new";
  }
  return status;
}

function reviewSubtitle(scope: RouteReviewScope, listState: ReviewListState): string {
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
    return `${listState.files.length} ${plural(listState.files.length, "file")} in this turn`;
  }
  return `${listState.files.length} ${plural(listState.files.length, "file")} in this thread`;
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

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

const diffOptions = {
  diffStyle: "unified",
  hunkSeparators: "line-info-basic",
  overflow: "scroll",
  stickyHeader: true,
  theme: {
    dark: "pierre-dark-soft",
    light: "pierre-light",
  },
  themeType: "system",
} as const;

import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { FilePanelSidebar, filePanelSidebarState } from "@/components/file-panel/file-panel-sidebar";
import { OpenFileTabs } from "@/components/file-panel/file-panel-tabs";
import { FileViewer } from "@/components/file-panel/file-viewer";
import { useFilePanelSearch } from "@/components/file-panel/use-file-panel-search";
import { useOpenFileTabs } from "@/components/file-panel/use-open-file-tabs";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { useFilePanelTree } from "@/hooks/use-file-panel-tree";
import {
  filePanelDirectoryChain,
  filePanelRootItems,
  filePanelTreePathForIndexedPath,
  filePanelWorkspaceFilesAvailable,
  filePanelWorkspaceKey,
  type FilePanelIndexedPath,
  type FilePanelSelectionIntent,
} from "@/lib/file-panel";
import { cn } from "@/lib/utils";
import type { WorkspaceRoot } from "@/types/roder";

export { FileMarkdownPreview } from "@/components/file-panel/file-viewer";

export type FilePanelProps = {
  workspaceId: string;
  roots: WorkspaceRoot[];
  selectedRootId: string;
  appServerMethods: string[];
  selectionIntent?: FilePanelSelectionIntent | null;
};

export function FilePanel({
  workspaceId,
  roots,
  selectedRootId,
  appServerMethods,
  selectionIntent = null,
}: FilePanelProps): React.JSX.Element {
  const filesystemAvailable = filePanelWorkspaceFilesAvailable(appServerMethods);
  const orderedRoots = orderWorkspaceRoots(roots, selectedRootId);
  const workspaceKey = filePanelWorkspaceKey(workspaceId, orderedRoots, selectedRootId, filesystemAvailable);
  const scopedSelectionIntent = selectionIntent?.workspaceId === workspaceId ? selectionIntent : null;

  return (
    <FilePanelSession
      key={workspaceKey}
      workspaceId={workspaceId}
      roots={orderedRoots}
      filesystemAvailable={filesystemAvailable}
      selectionIntent={scopedSelectionIntent}
    />
  );
}

function FilePanelSession({
  workspaceId,
  roots,
  filesystemAvailable,
  selectionIntent,
}: {
  workspaceId: string;
  roots: WorkspaceRoot[];
  filesystemAvailable: boolean;
  selectionIntent: FilePanelSelectionIntent | null;
}): React.JSX.Element {
  const { state, refresh, loadDirectory } = useFilePanelTree({ workspaceId, roots, available: filesystemAvailable });
  const rootItems = filePanelRootItems(roots);
  const [expandedTreePaths, setExpandedTreePaths] = useState<string[]>([]);
  const fileSearch = useFilePanelSearch({ workspaceId, filesystemAvailable });
  const fileTabs = useOpenFileTabs({ workspaceId, rootItems });
  const visibleIndexedPaths = fileSearch.searching ? fileSearch.searchState.indexedPaths : state.indexedPaths;
  const sidebarState = filePanelSidebarState(state.status, fileSearch.searchState.status, fileSearch.searching);
  const directoryErrorCount = state.status === "ready" ? state.directoryErrors.length : 0;

  function openDirectory(indexedPath: FilePanelIndexedPath): void {
    const directoryChain = filePanelDirectoryChain(indexedPath);
    const treePaths = directoryChain.flatMap(
      (directoryPath) => filePanelTreePathForIndexedPath(roots, directoryPath) ?? [],
    );
    if (treePaths.length > 0) {
      setExpandedTreePaths((currentPaths) => [...new Set([...currentPaths, ...treePaths])]);
    }
    void loadDirectoryChain(directoryChain, loadDirectory);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      {selectionIntent && (
        <FilePanelSelectionIntentConsumer
          key={selectionIntent.id}
          intent={selectionIntent}
          onOpenFile={fileTabs.openFile}
          onOpenDirectory={openDirectory}
        />
      )}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <OpenFileTabs
          tabs={fileTabs.openTabs}
          activeKey={fileTabs.activeTabKey}
          onSelect={fileTabs.setActiveTabKey}
          onClose={fileTabs.closeFileTab}
        />
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
          <div className="px-3 py-2">
            <input
              value={fileSearch.search}
              type="search"
              placeholder="Search files"
              className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-base font-medium outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              aria-label="Search files"
              disabled={state.status === "unavailable" || state.status === "empty"}
              onChange={(event) => fileSearch.searchWorkspaceFiles(event.currentTarget.value)}
            />
            {fileSearch.searchResultLimitSummary && (
              <div className="mt-1.5 px-0.5 text-sm font-medium text-muted-foreground">
                {fileSearch.searchResultLimitSummary}
              </div>
            )}
          </div>
          <FilePanelSidebar
            roots={roots}
            indexedPaths={visibleIndexedPaths}
            search={fileSearch.search}
            state={sidebarState}
            directoryErrorCount={directoryErrorCount}
            onOpenFile={fileTabs.openFile}
            onOpenDirectory={openDirectory}
            expandedTreePaths={expandedTreePaths}
          />
        </aside>
        <FileViewer state={fileTabs.viewState} onMarkdownViewModeChange={fileTabs.setActiveFileMarkdownViewMode} />
      </div>
    </div>
  );
}

function FilePanelSelectionIntentConsumer({
  intent,
  onOpenFile,
  onOpenDirectory,
}: {
  intent: FilePanelSelectionIntent;
  onOpenFile: (indexedPath: FilePanelIndexedPath) => void;
  onOpenDirectory: (indexedPath: FilePanelIndexedPath) => void;
}): null {
  useMountEffect(() => {
    if (intent.indexedPath.kind === "directory") {
      onOpenDirectory(intent.indexedPath);
      return;
    }
    onOpenFile(intent.indexedPath);
  });
  return null;
}

async function loadDirectoryChain(
  directoryChain: readonly FilePanelIndexedPath[],
  loadDirectory: (indexedPath: FilePanelIndexedPath) => Promise<void>,
): Promise<void> {
  for (const directoryPath of directoryChain) {
    await loadDirectory(directoryPath);
  }
}

function orderWorkspaceRoots(roots: WorkspaceRoot[], selectedRootId: string): WorkspaceRoot[] {
  if (!selectedRootId) {
    return roots;
  }
  return roots.toSorted((left, right) => {
    if (left.id === selectedRootId) {
      return -1;
    }
    if (right.id === selectedRootId) {
      return 1;
    }
    return 0;
  });
}

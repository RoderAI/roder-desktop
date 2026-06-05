import { useRef, useState } from "react";
import { filePreviewReadLimitBytes, maxRenderedFileBytes } from "@/components/file-panel/constants";
import type { FileViewState, OpenFileTab, OpenFileViewState } from "@/components/file-panel/types";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  decodeWorkspaceFileContent,
  filePanelDefaultMarkdownViewMode,
  filePanelSelectionKey,
  filePanelSupportsMarkdownPreview,
  filePanelTabTitle,
  nextFilePanelActiveTabKey,
  type FilePanelIndexedPath,
  type FilePanelMarkdownViewMode,
  type FilePanelRootItem,
  type FilePanelSelection,
} from "@/lib/file-panel";
import { roderIpc } from "@/lib/roder-ipc";

export function useOpenFileTabs({
  rootItems,
  workspaceId,
}: {
  rootItems: readonly FilePanelRootItem[];
  workspaceId: string;
}): {
  activeTabKey: string | null;
  closeFileTab: (tabKey: string) => void;
  openFile: (indexedPath: FilePanelIndexedPath) => void;
  openTabs: OpenFileTab[];
  setActiveFileMarkdownViewMode: (mode: FilePanelMarkdownViewMode) => void;
  setActiveTabKey: (tabKey: string | null) => void;
  viewState: FileViewState;
} {
  const [openTabs, setOpenTabs] = useState<OpenFileTab[]>([]);
  const [activeTabKey, setActiveTabKey] = useState<string | null>(null);
  const readRequestSeq = useRef(0);
  const tabReadRequests = useRef(new Map<string, number>());
  const activeTab = openTabs.find((tab) => tab.key === activeTabKey);
  const viewState: FileViewState = activeTab?.state ?? { status: "empty" };

  useMountEffect(() => {
    return () => {
      tabReadRequests.current.clear();
      readRequestSeq.current += 1;
    };
  });

  function openFile(indexedPath: FilePanelIndexedPath): void {
    if (indexedPath.kind !== "file") {
      return;
    }
    const selection = { rootId: indexedPath.rootId, relativePath: indexedPath.relativePath };
    const label = fileSelectionLabel(rootItems, selection);
    const title = filePanelTabTitle(selection);
    const tabKey = filePanelSelectionKey(selection);
    setActiveTabKey(tabKey);
    if (openTabs.some((tab) => tab.key === tabKey) || tabReadRequests.current.has(tabKey)) {
      return;
    }
    const requestId = (readRequestSeq.current += 1);
    tabReadRequests.current.set(tabKey, requestId);
    upsertOpenFileTab(setOpenTabs, { key: tabKey, title, state: { status: "loading", selection, label } });
    void roderIpc
      .readWorkspaceFile({
        workspaceId,
        rootId: selection.rootId,
        path: selection.relativePath,
        offset: 0,
        limit: filePreviewReadLimitBytes,
      })
      .then((result) => {
        if (tabReadRequests.current.get(tabKey) !== requestId) {
          return;
        }
        const content = decodeWorkspaceFileContent(result, { maxBytes: maxRenderedFileBytes });
        if (content.status === "text") {
          updateOpenFileTabState(setOpenTabs, tabKey, {
            status: "text",
            selection,
            label,
            content,
            markdownViewMode: filePanelDefaultMarkdownViewMode(selection.relativePath),
          });
        } else if (content.status === "binary") {
          updateOpenFileTabState(setOpenTabs, tabKey, { status: "binary", selection, label, bytes: content.bytes });
        } else {
          updateOpenFileTabState(setOpenTabs, tabKey, {
            status: "too-large",
            selection,
            label,
            bytes: content.bytes,
          });
        }
      })
      .catch((error: unknown) => {
        if (tabReadRequests.current.get(tabKey) !== requestId) {
          return;
        }
        updateOpenFileTabState(setOpenTabs, tabKey, {
          status: "error",
          selection,
          label,
          error: errorMessage(error),
        });
      });
  }

  function closeFileTab(tabKey: string): void {
    tabReadRequests.current.delete(tabKey);
    setOpenTabs((currentTabs) => {
      setActiveTabKey((currentActiveKey) => nextFilePanelActiveTabKey(currentTabs, currentActiveKey, tabKey));
      return currentTabs.filter((tab) => tab.key !== tabKey);
    });
  }

  function setActiveFileMarkdownViewMode(mode: FilePanelMarkdownViewMode): void {
    const tabKey = activeTabKey;
    if (!tabKey) {
      return;
    }
    setOpenTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.key === tabKey &&
        tab.state.status === "text" &&
        filePanelSupportsMarkdownPreview(tab.state.selection.relativePath)
          ? { ...tab, state: { ...tab.state, markdownViewMode: mode } }
          : tab,
      ),
    );
  }

  return {
    activeTabKey,
    closeFileTab,
    openFile,
    openTabs,
    setActiveFileMarkdownViewMode,
    setActiveTabKey,
    viewState,
  };
}

function upsertOpenFileTab(
  setOpenTabs: React.Dispatch<React.SetStateAction<OpenFileTab[]>>,
  nextTab: OpenFileTab,
): void {
  setOpenTabs((currentTabs) => {
    if (currentTabs.some((tab) => tab.key === nextTab.key)) {
      return currentTabs.map((tab) => (tab.key === nextTab.key ? nextTab : tab));
    }
    return [...currentTabs, nextTab];
  });
}

function updateOpenFileTabState(
  setOpenTabs: React.Dispatch<React.SetStateAction<OpenFileTab[]>>,
  tabKey: string,
  nextState: OpenFileViewState,
): void {
  setOpenTabs((currentTabs) =>
    currentTabs.map((tab) =>
      tab.key === tabKey ? { ...tab, state: nextState, title: filePanelTabTitle(nextState.selection) } : tab,
    ),
  );
}

function fileSelectionLabel(rootItems: readonly FilePanelRootItem[], selection: FilePanelSelection): string {
  const root = rootItems.find((candidate) => candidate.id === selection.rootId);
  return root ? `${root.label}/${selection.relativePath}` : selection.relativePath;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to read file.";
}

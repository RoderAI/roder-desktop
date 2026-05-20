import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { AgentWaitCards } from "@/components/agent-wait-card";
import { BrowserPanel } from "@/components/browser-panel";
import { CanvasPanel } from "@/components/canvas-panel";
import { Composer } from "@/components/composer";
import { ExtensionActivityRail } from "@/components/extensions/extension-activity-rail";
import { ExtensionsPanel } from "@/components/extensions/extensions-panel";
import { PluginsMarketplacePanel } from "@/components/plugins/plugins-marketplace-panel";
import { SettingsView } from "@/components/settings-view";
import { TerminalPanel } from "@/components/terminal-panel";
import { TopBar, type ToolPanel } from "@/components/top-bar";
import { Transcript } from "@/components/transcript";
import { useExtensionThemes } from "@/hooks/use-extension-themes";
import { useRoderAgent } from "@/hooks/use-roder-agent";
import { useThemeApplication } from "@/hooks/use-theme-application";
import { getSidebarExtensions } from "@/lib/extension-sidebar";
import { useExtensionsStore } from "@/stores/extensions-store";
import { useThemeStore } from "@/stores/theme-store";
import type { DesktopAttachment, RoderThread } from "@/types/roder";

type MainView = "chat" | "plugins";

export function App(): React.JSX.Element {
  const {
    activeThreadId,
    appearance,
    archiveThread: archiveAgentThread,
    busy,
    error,
    messages,
    models,
    newProject: createProjectThread,
    newThread: createAgentThread,
    openWorkspaceFolder,
    restart,
    selectedModel,
    selectedPolicyMode,
    selectedReasoning,
    selectedWorkspaceCwd,
    selectThread: selectAgentThread,
    sendPrompt: sendAgentPrompt,
    setSelectedModel,
    setSelectedPolicyMode,
    setSelectedReasoning,
    setSelectedWorkspaceCwd,
    status,
    stopTurn,
    threads,
    waitRequests,
    workspaceRecents,
    resolveApproval,
    resolveUserInput,
    exitPlan,
  } = useRoderAgent();
  const settingsOpen = useThemeStore((state) => state.settingsOpen);
  const closeSettings = useThemeStore((state) => state.closeSettings);
  useExtensionThemes();
  useThemeApplication(appearance);
  const [followSignal, setFollowSignal] = useState(0);
  const [mainView, setMainView] = useState<MainView>("chat");
  const [activeTool, setActiveTool] = useState<ToolPanel>(null);
  const [selectedExtensionId, setSelectedExtensionId] = useState<string | null>(null);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(274);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toolPanelWidth, setToolPanelWidth] = useState(560);
  const [composerAttachments, setComposerAttachments] = useState<DesktopAttachment[]>([]);
  const extensions = useExtensionsStore((state) => state.extensions);
  const sidebarExtensions = useMemo(() => getSidebarExtensions(extensions), [extensions]);
  const selectedExtension = sidebarExtensions.find((extension) => extension.id === selectedExtensionId) ?? sidebarExtensions[0];
  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  const activeWorkspaceCwd = activeThread?.cwd ?? selectedWorkspaceCwd ?? status.cwd ?? "";
  const folderOptions = useMemo(() => buildFolderOptions(threads, activeWorkspaceCwd), [activeWorkspaceCwd, threads]);
  const threadOptions = useMemo(() => {
    const selectedFolder = normalizePath(activeWorkspaceCwd);
    return threads
      .filter((thread) => !thread.id.startsWith("demo-") && normalizePath(thread.cwd) === selectedFolder)
      .sort((left, right) => normalizedTimestamp(right.updatedAt) - normalizedTimestamp(left.updatedAt));
  }, [activeWorkspaceCwd, threads]);
  const followBottom = useCallback(() => setFollowSignal((value) => value + 1), []);
  const showChat = useCallback(() => setMainView("chat"), []);
  const selectThread = useCallback(
    (threadId: string) => {
      showChat();
      followBottom();
      void selectAgentThread(threadId);
    },
    [followBottom, selectAgentThread, showChat],
  );
  const archiveThread = useCallback(
    (threadId: string) => {
      showChat();
      void archiveAgentThread(threadId);
    },
    [archiveAgentThread, showChat],
  );
  const selectFolder = useCallback(
    (path: string) => {
      showChat();
      const normalizedPath = normalizePath(path);
      const latestThread = threads
        .filter((thread) => !thread.id.startsWith("demo-") && normalizePath(thread.cwd) === normalizedPath)
        .sort((left, right) => normalizedTimestamp(right.updatedAt) - normalizedTimestamp(left.updatedAt))[0];

      setSelectedWorkspaceCwd(path);
      if (latestThread) {
        selectThread(latestThread.id);
      }
    },
    [selectThread, setSelectedWorkspaceCwd, showChat, threads],
  );
  const newThread = useCallback(() => {
    showChat();
    followBottom();
    void createAgentThread();
  }, [createAgentThread, followBottom, showChat]);
  const newThreadInFolder = useCallback((path: string) => {
    showChat();
    followBottom();
    setSelectedWorkspaceCwd(path);
    void createAgentThread();
  }, [createAgentThread, followBottom, setSelectedWorkspaceCwd, showChat]);
  const newProject = useCallback(() => {
    showChat();
    followBottom();
    void createProjectThread();
  }, [createProjectThread, followBottom, showChat]);
  useEffect(() => {
    return window.roderDesktop.onAppCommand((appCommand) => {
      if (appCommand.command === "newProject") {
        newProject();
        return;
      }
      if (appCommand.command === "newThread") {
        newThread();
      }
    });
  }, [newProject, newThread]);
  const attachToComposer = useCallback(
    (attachment: DesktopAttachment) => {
      setComposerAttachments((attachments) =>
        attachments.some((existing) => existing.path === attachment.path) ? attachments : [...attachments, attachment],
      );
      followBottom();
    },
    [followBottom],
  );
  const sendPrompt = useCallback(
    async (prompt: string, attachments: DesktopAttachment[]) => {
      followBottom();
      await sendAgentPrompt(prompt, attachments);
    },
    [followBottom, sendAgentPrompt],
  );
  useEffect(() => {
    if (sidebarExtensions.length === 0) {
      setSelectedExtensionId(null);
      return;
    }
    if (!selectedExtensionId || !sidebarExtensions.some((extension) => extension.id === selectedExtensionId)) {
      setSelectedExtensionId(sidebarExtensions[0].id);
    }
  }, [sidebarExtensions, selectedExtensionId]);
  const toggleExtensionsPanel = useCallback(() => {
    showChat();
    if (activeTool === "extensions") {
      setActiveTool(null);
      return;
    }
    setSelectedExtensionId((extensionId) => extensionId ?? selectedExtension?.id ?? null);
    setActiveTool("extensions");
  }, [activeTool, selectedExtension, showChat]);
  const selectExtensionFromRail = useCallback((extensionId: string) => {
    showChat();
    setSelectedExtensionId(extensionId);
    setActiveTool("extensions");
  }, [showChat]);
  const toggleToolPanel = useCallback((toolName: NonNullable<ToolPanel>) => {
    showChat();
    setActiveTool((tool) => (tool === toolName ? null : toolName));
  }, [showChat]);
  const openPlugins = useCallback(() => {
    closeSettings();
    setActiveTool(null);
    setMainView("plugins");
  }, [closeSettings]);
  const beginSidebarResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    beginHorizontalResize(event, leftSidebarWidth, (startWidth, deltaX) => {
      setLeftSidebarWidth(clamp(startWidth + deltaX, 220, 420));
    });
  }, [leftSidebarWidth]);
  const beginToolPanelResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    beginHorizontalResize(event, toolPanelWidth, (startWidth, deltaX) => {
      setToolPanelWidth(clamp(startWidth - deltaX, 360, 820));
    });
  }, [toolPanelWidth]);
  const sidebarRailStyle = { "--sidebar-width": `${leftSidebarWidth}px` } as SidebarRailStyle;

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-background">
      {settingsOpen && <SettingsView />}
      <div
        className="sidebar-shell shrink-0"
        data-open={sidebarOpen ? "true" : undefined}
        style={sidebarRailStyle}
        aria-hidden={!sidebarOpen}
      >
        <AppSidebar
          threads={threads}
          activeThreadId={activeThreadId}
          activeView={mainView}
          width={leftSidebarWidth}
          onSelectThread={selectThread}
          onArchiveThread={archiveThread}
          onNewProject={newProject}
          onNewThread={newThread}
          onNewThreadInFolder={newThreadInFolder}
          onOpenPlugins={openPlugins}
        />
      </div>
      {sidebarOpen && (
        <>
          <div
            className="no-drag relative z-30 -ml-1 -mr-1 h-screen w-2 shrink-0 cursor-col-resize bg-transparent hover:bg-border"
            aria-label="Resize thread sidebar"
            role="separator"
            onPointerDown={beginSidebarResize}
          />
        </>
      )}
      <section className="flex min-w-0 flex-1 flex-col">
        {mainView === "plugins" ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <PluginsMarketplacePanel />
          </div>
        ) : (
          <>
            <TopBar
              thread={activeThread}
              threads={threadOptions}
              folders={folderOptions}
              activeFolderPath={activeWorkspaceCwd}
              status={status}
              activeTool={activeTool}
              sidebarOpen={sidebarOpen}
              onRestart={() => void restart()}
              onToggleSidebar={() => setSidebarOpen((open) => !open)}
              onSelectFolder={selectFolder}
              onSelectThread={selectThread}
              onToggleTerminal={() => toggleToolPanel("terminal")}
              onToggleBrowser={() => toggleToolPanel("browser")}
              onToggleCanvas={() => toggleToolPanel("canvas")}
              onToggleExtensions={toggleExtensionsPanel}
            />
            <div className="flex min-h-0 flex-1">
              <div className="flex min-w-0 flex-1 flex-col">
                <Transcript messages={messages} followSignal={followSignal} />
                <AgentWaitCards
                  requests={waitRequests}
                  onResolveApproval={resolveApproval}
                  onResolveUserInput={resolveUserInput}
                  onExitPlan={exitPlan}
                />
                {error && (
                  <div className="mx-auto mb-3 w-full max-w-[980px] px-8 text-base text-destructive">{error}</div>
                )}
                <Composer
                  busy={busy}
                  models={models}
                  selectedModel={selectedModel}
                  selectedPolicyMode={selectedPolicyMode}
                  selectedReasoning={selectedReasoning}
                  selectedWorkspaceCwd={selectedWorkspaceCwd}
                  statusCwd={status.cwd}
                  workspaceRecents={workspaceRecents}
                  threads={threads}
                  attachments={composerAttachments}
                  onSelectedModelChange={setSelectedModel}
                  onSelectedPolicyModeChange={(mode) => void setSelectedPolicyMode(mode)}
                  onSelectedReasoningChange={setSelectedReasoning}
                  onWorkspaceSelect={setSelectedWorkspaceCwd}
                  onOpenWorkspaceFolder={() => void openWorkspaceFolder()}
                  onScrollToBottom={followBottom}
                  onAttachmentsChange={setComposerAttachments}
                  onSend={sendPrompt}
                  onStop={stopTurn}
                />
              </div>
              {activeTool && (
                <div className="relative h-full min-w-0 shrink-0" style={{ width: toolPanelWidth }}>
                  <div
                    className="no-drag absolute inset-y-0 left-0 z-30 w-2 cursor-col-resize bg-transparent hover:bg-border"
                    aria-label="Resize tool panel"
                    role="separator"
                    onPointerDown={beginToolPanelResize}
                  />
                  {activeTool === "terminal" && <TerminalPanel />}
                  {activeTool === "browser" && <BrowserPanel onAttach={attachToComposer} />}
                  {activeTool === "canvas" && <CanvasPanel onAttach={attachToComposer} />}
                  {activeTool === "extensions" && <ExtensionsPanel selectedExtensionId={selectedExtensionId} onSelectedExtensionChange={setSelectedExtensionId} />}
                </div>
              )}
              <ExtensionActivityRail active={activeTool === "extensions"} activeExtensionId={selectedExtensionId} onSelectExtension={selectExtensionFromRail} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

type SidebarRailStyle = CSSProperties & {
  "--sidebar-width": string;
};

function basename(path: string | undefined): string | undefined {
  return path?.split("/").filter(Boolean).pop();
}

type FolderOption = {
  path: string;
  name: string;
  updatedAt: number;
  threadCount: number;
};

function buildFolderOptions(threads: RoderThread[], activePath: string): FolderOption[] {
  const folders = new Map<string, FolderOption>();
  const activeFolderPath = normalizePath(activePath);

  if (activeFolderPath) {
    folders.set(activeFolderPath, {
      path: activeFolderPath,
      name: workspaceName(activeFolderPath),
      updatedAt: Date.now(),
      threadCount: 0,
    });
  }

  for (const thread of threads) {
    if (thread.id.startsWith("demo-")) {
      continue;
    }
    const path = normalizePath(thread.cwd);
    const existing = folders.get(path);
    folders.set(path, {
      path,
      name: existing?.name ?? workspaceName(path),
      updatedAt: Math.max(existing?.updatedAt ?? 0, normalizedTimestamp(thread.updatedAt)),
      threadCount: (existing?.threadCount ?? 0) + 1,
    });
  }

  return [...folders.values()].sort((left, right) => {
    if (left.path === activeFolderPath) {
      return -1;
    }
    if (right.path === activeFolderPath) {
      return 1;
    }
    return right.updatedAt - left.updatedAt || left.name.localeCompare(right.name);
  });
}

function normalizePath(path: string | undefined): string {
  return (path || "").replace(/\/+$/, "") || path || "";
}

function workspaceName(path: string): string {
  return basename(path) ?? "workspace";
}

function normalizedTimestamp(timestamp: number): number {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 0;
  }
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

function beginHorizontalResize(
  event: React.PointerEvent<HTMLDivElement>,
  startWidth: number,
  update: (startWidth: number, deltaX: number) => void,
): void {
  event.preventDefault();
  const startX = event.clientX;

  function onPointerMove(moveEvent: PointerEvent): void {
    update(startWidth, moveEvent.clientX - startX);
  }

  function onPointerUp(): void {
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }

  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp, { once: true });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

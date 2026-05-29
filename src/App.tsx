import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryStates } from "nuqs";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { AppShellProvider } from "@/components/app-shell-context";
import { BrowserPanel } from "@/components/browser-panel";
import { CanvasPanel } from "@/components/canvas-panel";
import { ExtensionActivityRail } from "@/components/extensions/extension-activity-rail";
import { ExtensionsPanel } from "@/components/extensions/extensions-panel";
import { TerminalPanel } from "@/components/terminal-panel";
import { TopBar, type ToolPanel } from "@/components/top-bar";
import { useExtensionThemes } from "@/hooks/use-extension-themes";
import { useRoderAgent } from "@/hooks/use-roder-agent";
import { useThemeApplication } from "@/hooks/use-theme-application";
import { getSidebarExtensions } from "@/lib/extension-sidebar";
import { archiveRouteAfterThreadRemoval, defaultPluginsRoute, isPluginsRoutePath } from "@/lib/route-selection";
import { isThreadRunning, shouldShowThreadWorkingIndicator } from "@/lib/roder-thread";
import { routeSearchParsers, sidebarWidthBounds, toolPanelWidthBounds } from "@/lib/route-search";
import { useExtensionsStore } from "@/stores/extensions-store";
import { useSkillsStore } from "@/stores/skills-store";
import type { DesktopAttachment, RoderThread } from "@/types/roder";

export function App(): React.JSX.Element {
  const agent = useRoderAgent();
  const {
    activeThreadId,
    appearance,
    archiveThread: archiveAgentThread,
    messages,
    newProject: createProjectThread,
    restart,
    selectedWorkspaceCwd,
    selectThread: selectAgentThread,
    sendPrompt: sendAgentPrompt,
    setSelectedWorkspaceCwd,
    status,
    threads,
    waitRequests,
  } = agent;
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [routeSearch, setRouteSearch] = useQueryStates(routeSearchParsers);
  useExtensionThemes();
  useThemeApplication(appearance);
  const [followSignal, setFollowSignal] = useState(0);
  const [canScrollTranscriptToBottom, setCanScrollTranscriptToBottom] = useState(false);
  const [composerFocusSignal, setComposerFocusSignal] = useState(0);
  const [composerAttachments, setComposerAttachments] = useState<DesktopAttachment[]>([]);
  const extensions = useExtensionsStore((state) => state.extensions);
  const skillsLoaded = useSkillsStore((state) => state.loaded);
  const skillsLoading = useSkillsStore((state) => state.loading);
  const loadSkills = useSkillsStore((state) => state.load);
  const sidebarExtensions = useMemo(() => getSidebarExtensions(extensions), [extensions]);
  const activeTool = routeSearch.tool;
  const selectedExtensionId = routeSearch.extension || null;
  const selectedExtension =
    sidebarExtensions.find((extension) => extension.id === selectedExtensionId) ?? sidebarExtensions[0];
  const effectiveSelectedExtensionId = selectedExtension?.id ?? null;
  const sidebarOpen = routeSearch.sidebar;
  const leftSidebarWidth = routeSearch.leftWidth;
  const toolPanelWidth = routeSearch.rightWidth;
  const isPluginsRoute = isPluginsRoutePath(pathname);
  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  const activeThreadBusy = isThreadRunning(activeThread);
  const showWorkingIndicator = shouldShowThreadWorkingIndicator(activeThread, waitRequests.length, messages);
  const activeWorkspaceCwd = activeThread?.cwd ?? selectedWorkspaceCwd ?? status.cwd ?? "";
  const folderOptions = useMemo(() => buildFolderOptions(threads, activeWorkspaceCwd), [activeWorkspaceCwd, threads]);
  const threadOptions = useMemo(() => {
    const selectedFolder = normalizePath(activeWorkspaceCwd);
    return threads
      .filter((thread) => !thread.id.startsWith("demo-") && normalizePath(thread.cwd) === selectedFolder)
      .sort((left, right) => normalizedTimestamp(right.updatedAt) - normalizedTimestamp(left.updatedAt));
  }, [activeWorkspaceCwd, threads]);
  const followBottom = useCallback(() => setFollowSignal((value) => value + 1), []);
  const selectThread = useCallback(
    (threadId: string) => {
      followBottom();
      void navigate({ to: "/threads/$threadId", params: { threadId }, search: true });
      void selectAgentThread(threadId, { pushHistory: false });
    },
    [followBottom, navigate, selectAgentThread],
  );
  const archiveThread = useCallback(
    (threadId: string) => {
      const target = archiveRouteAfterThreadRemoval({
        activeThreadId,
        archivedThreadId: threadId,
        threads,
      });
      if (target?.route === "thread") {
        void navigate({
          to: "/threads/$threadId",
          params: { threadId: target.threadId },
          replace: true,
          search: true,
        });
      } else if (target?.route === "new") {
        void navigate({ to: "/new", replace: true, search: true });
      }
      void archiveAgentThread(threadId);
    },
    [activeThreadId, archiveAgentThread, navigate, threads],
  );
  const selectFolder = useCallback(
    (path: string) => {
      const normalizedPath = normalizePath(path);
      const latestThread = threads
        .filter((thread) => !thread.id.startsWith("demo-") && normalizePath(thread.cwd) === normalizedPath)
        .sort((left, right) => normalizedTimestamp(right.updatedAt) - normalizedTimestamp(left.updatedAt))[0];

      setSelectedWorkspaceCwd(path);
      if (latestThread) {
        selectThread(latestThread.id);
        return;
      }
      void navigate({ to: "/new", search: true });
      void selectAgentThread("", { pushHistory: false });
    },
    [navigate, selectAgentThread, selectThread, setSelectedWorkspaceCwd, threads],
  );
  const newThread = useCallback(() => {
    followBottom();
    setComposerFocusSignal((value) => value + 1);
    void navigate({ to: "/new", search: true });
    void selectAgentThread("", { pushHistory: false });
  }, [followBottom, navigate, selectAgentThread]);
  const newThreadInFolder = useCallback(
    (path: string) => {
      followBottom();
      setComposerFocusSignal((value) => value + 1);
      setSelectedWorkspaceCwd(path);
      void navigate({ to: "/new", search: true });
      void selectAgentThread("", { pushHistory: false });
    },
    [followBottom, navigate, selectAgentThread, setSelectedWorkspaceCwd],
  );
  const newProject = useCallback(() => {
    followBottom();
    void navigate({ to: "/new", search: true });
    void createProjectThread();
  }, [createProjectThread, followBottom, navigate]);
  useEffect(() => {
    return window.roderDesktop.onAppCommand((appCommand) => {
      if (appCommand.command === "newProject") {
        newProject();
        return;
      }
      if (appCommand.command === "newThread") {
        newThread();
        return;
      }
      if (appCommand.command === "openSettings") {
        void navigate({ to: "/settings/$section", params: { section: "general" }, search: true });
      }
    });
  }, [navigate, newProject, newThread]);
  useEffect(() => {
    if (status.state === "ready" && !skillsLoaded && !skillsLoading) {
      void loadSkills();
    }
  }, [loadSkills, skillsLoaded, skillsLoading, status.state]);
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
  const toggleExtensionsPanel = useCallback(() => {
    if (activeTool === "extensions") {
      void setRouteSearch({ tool: null }, { history: "replace" });
      return;
    }
    void setRouteSearch({ tool: "extensions", extension: selectedExtension?.id ?? "" }, { history: "replace" });
  }, [activeTool, selectedExtension, setRouteSearch]);
  const selectExtensionFromRail = useCallback(
    (extensionId: string) => {
      void setRouteSearch({ tool: "extensions", extension: extensionId }, { history: "replace" });
    },
    [setRouteSearch],
  );
  const toggleToolPanel = useCallback(
    (toolName: NonNullable<ToolPanel>) => {
      void setRouteSearch({ tool: activeTool === toolName ? null : toolName }, { history: "replace" });
    },
    [activeTool, setRouteSearch],
  );
  const openPlugins = useCallback(() => {
    void navigate({ to: defaultPluginsRoute(), search: true });
  }, [navigate]);
  const beginSidebarResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      beginHorizontalResize(event, leftSidebarWidth, (startWidth, deltaX) => {
        void setRouteSearch(
          { leftWidth: clamp(startWidth + deltaX, sidebarWidthBounds.min, sidebarWidthBounds.max) },
          { history: "replace" },
        );
      });
    },
    [leftSidebarWidth, setRouteSearch],
  );
  const beginToolPanelResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      beginHorizontalResize(event, toolPanelWidth, (startWidth, deltaX) => {
        void setRouteSearch(
          { rightWidth: clamp(startWidth - deltaX, toolPanelWidthBounds.min, toolPanelWidthBounds.max) },
          { history: "replace" },
        );
      });
    },
    [setRouteSearch, toolPanelWidth],
  );
  const sidebarRailStyle = { "--sidebar-width": `${leftSidebarWidth}px` } as SidebarRailStyle;
  const appShellContext = useMemo(
    () => ({
      agent,
      activeThread,
      activeThreadBusy,
      activeWorkspaceCwd,
      canScrollTranscriptToBottom,
      composerAttachments,
      composerFocusSignal,
      folderOptions,
      followSignal,
      routeSearch,
      selectedExtensionId: effectiveSelectedExtensionId,
      setCanScrollTranscriptToBottom,
      setComposerAttachments,
      setRouteSearch,
      showWorkingIndicator,
      threadOptions,
      attachToComposer,
      followBottom,
      sendPrompt,
    }),
    [
      activeThread,
      activeThreadBusy,
      activeWorkspaceCwd,
      agent,
      attachToComposer,
      canScrollTranscriptToBottom,
      composerAttachments,
      composerFocusSignal,
      folderOptions,
      followBottom,
      followSignal,
      routeSearch,
      effectiveSelectedExtensionId,
      sendPrompt,
      setRouteSearch,
      showWorkingIndicator,
      threadOptions,
    ],
  );

  return (
    <AppShellProvider value={appShellContext}>
      <div className="relative flex h-screen w-screen overflow-hidden bg-background">
        <div
          className="sidebar-shell shrink-0"
          data-open={sidebarOpen ? "true" : undefined}
          style={sidebarRailStyle}
          aria-hidden={!sidebarOpen}
        >
          <AppSidebar
            threads={threads}
            activeThreadId={activeThreadId}
            activeView={isPluginsRoute ? "plugins" : "chat"}
            width={leftSidebarWidth}
            onSelectThread={selectThread}
            onArchiveThread={archiveThread}
            onNewProject={newProject}
            onNewThread={newThread}
            onNewThreadInFolder={newThreadInFolder}
            onOpenPlugins={openPlugins}
            onOpenSettings={() =>
              void navigate({ to: "/settings/$section", params: { section: "general" }, search: true })
            }
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
          {isPluginsRoute ? (
            <div className="min-h-0 flex-1 overflow-hidden">
              <Outlet />
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
                onToggleSidebar={() => void setRouteSearch({ sidebar: !sidebarOpen }, { history: "replace" })}
                onSelectFolder={selectFolder}
                onSelectThread={selectThread}
                onToggleTerminal={() => toggleToolPanel("terminal")}
                onToggleBrowser={() => toggleToolPanel("browser")}
                onToggleCanvas={() => toggleToolPanel("canvas")}
                onToggleExtensions={toggleExtensionsPanel}
              />
              <div className="flex min-h-0 flex-1">
                <div className="flex min-w-0 flex-1 flex-col">
                  <Outlet />
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
                    {activeTool === "extensions" && (
                      <ExtensionsPanel
                        selectedExtensionId={effectiveSelectedExtensionId}
                        selectedPanelId={routeSearch.extensionPanel || null}
                        onSelectedPanelChange={(extensionPanel) =>
                          void setRouteSearch({ extensionPanel }, { history: "replace" })
                        }
                      />
                    )}
                  </div>
                )}
                <ExtensionActivityRail
                  active={activeTool === "extensions"}
                  activeExtensionId={effectiveSelectedExtensionId}
                  onSelectExtension={selectExtensionFromRail}
                  onOpenSettings={() =>
                    void navigate({ to: "/settings/$section", params: { section: "extensions" }, search: true })
                  }
                />
              </div>
            </>
          )}
        </section>
      </div>
    </AppShellProvider>
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

import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryStates, type SetValues } from "nuqs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppShellContextValue } from "@/components/app-shell-context";
import type { AppShellLayoutProps } from "@/components/app-shell-layout";
import { useExtensionThemes } from "@/hooks/use-extension-themes";
import { clamp, useHorizontalResize } from "@/hooks/use-horizontal-resize";
import { useRoderAgent } from "@/hooks/use-roder-agent";
import { useThreadHunkSummary } from "@/hooks/use-thread-hunk-summary";
import { useThemeApplication } from "@/hooks/use-theme-application";
import { archiveRouteAfterThreadRemoval, defaultPluginsRoute, isPluginsRoutePath } from "@/lib/route-selection";
import { isThreadRunning, shouldShowThreadWorkingIndicator } from "@/lib/roder-thread";
import {
  closeWorkspacePanelShell,
  closeWorkspacePanelTab,
  mergeRouteSearchUpdate,
  openWorkspacePanelShell,
  openWorkspacePanelTab,
  routeSearchParsers,
  selectWorkspacePanelTab,
  sidebarWidthBounds,
  toolPanelWidthBounds,
  type RouteReviewScope,
  type RouteWorkspacePanel,
} from "@/lib/route-search";
import { buildFolderOptions, buildThreadOptions, latestThreadInFolder } from "@/lib/workspace-thread-options";
import type { DesktopAttachment } from "@/types/roder";

type AppShellController = {
  appShellContext: AppShellContextValue;
  layoutProps: AppShellLayoutProps;
};

const mainPanelMinWidth = 500;
const sidebarResizeHandleWidth = 8;

export function useAppShellController(): AppShellController {
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
  const [routeSearch, setRawRouteSearch] = useQueryStates(routeSearchParsers);
  const setRouteSearch = useCallback<SetValues<typeof routeSearchParsers>>(
    (update, options) => setRawRouteSearch((current) => mergeRouteSearchUpdate(current, update), options),
    [setRawRouteSearch],
  );
  useExtensionThemes();
  useThemeApplication(appearance);
  const [followSignal, setFollowSignal] = useState(0);
  const [canScrollTranscriptToBottom, setCanScrollTranscriptToBottom] = useState(false);
  const [composerFocusSignal, setComposerFocusSignal] = useState(0);
  const [composerAttachments, setComposerAttachments] = useState<DesktopAttachment[]>([]);
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === "undefined" ? 0 : window.innerWidth));
  const toolPanelElementRef = useRef<HTMLElement | null>(null);
  const activePanel = routeSearch.panelActive;
  const workspacePanelOpen = routeSearch.panelOpen;
  const selectedExtensionId = routeSearch.extension || null;
  const sidebarOpen = routeSearch.sidebar;
  const leftSidebarWidth = routeSearch.leftWidth;
  const toolPanelMaxWidth = toolPanelMaxWidthForViewport(viewportWidth, sidebarOpen, leftSidebarWidth);
  const routeToolPanelWidth = clamp(routeSearch.rightWidth, toolPanelWidthBounds.min, toolPanelMaxWidth);
  const toolPanelWidth = routeToolPanelWidth;
  const isPluginsRoute = isPluginsRoutePath(pathname);
  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  const activeThreadBusy = isThreadRunning(activeThread);
  const showWorkingIndicator = shouldShowThreadWorkingIndicator(activeThread, waitRequests.length, messages);
  const activeWorkspaceCwd = activeThread?.cwd ?? selectedWorkspaceCwd ?? status.cwd ?? "";
  const activeWorkspaceRef = useMemo(
    () => ({
      workspaceId: activeThread?.workspaceId ?? agent.selectedWorkspaceId ?? "",
      rootId: activeThread?.rootId ?? agent.selectedRootId ?? "",
    }),
    [activeThread?.rootId, activeThread?.workspaceId, agent.selectedRootId, agent.selectedWorkspaceId],
  );
  const hunkSummary = useThreadHunkSummary(activeThreadId, agent.hunkRevision);
  const folderOptions = useMemo(() => buildFolderOptions(threads, activeWorkspaceCwd), [activeWorkspaceCwd, threads]);
  const threadOptions = useMemo(() => buildThreadOptions(threads, activeWorkspaceCwd), [activeWorkspaceCwd, threads]);
  const followBottom = useCallback(() => setFollowSignal((value) => value + 1), []);
  const selectThread = useCallback(
    (threadId: string) => {
      void navigate({ to: "/threads/$threadId", params: { threadId }, search: true });
      void selectAgentThread(threadId, { pushHistory: false });
    },
    [navigate, selectAgentThread],
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
      const latestThread = latestThreadInFolder(threads, path);

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
    function syncViewportWidth(): void {
      setViewportWidth(window.innerWidth);
    }

    syncViewportWidth();
    window.addEventListener("resize", syncViewportWidth);
    return () => window.removeEventListener("resize", syncViewportWidth);
  }, []);
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
  const attachToComposer = useCallback(
    (attachment: DesktopAttachment) => {
      setComposerAttachments((attachments) =>
        attachments.some((existing) => existing.path === attachment.path) ? attachments : [...attachments, attachment],
      );
      setComposerFocusSignal((value) => value + 1);
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
  const selectExtensionFromRail = useCallback(
    (extensionId: string) => {
      void setRouteSearch((current) => ({ ...openWorkspacePanelTab(current, "extensions"), extension: extensionId }), {
        history: "replace",
      });
    },
    [setRouteSearch],
  );
  const selectWorkspacePanel = useCallback(
    (panel: RouteWorkspacePanel) => {
      void setRouteSearch((current) => selectWorkspacePanelTab(current, panel), { history: "replace" });
    },
    [setRouteSearch],
  );
  const openWorkspacePanel = useCallback(
    (panel: RouteWorkspacePanel) => {
      void setRouteSearch((current) => openWorkspacePanelTab(current, panel), { history: "replace" });
    },
    [setRouteSearch],
  );
  const openWorkspacePanelShellOnly = useCallback(() => {
    void setRouteSearch(openWorkspacePanelShell(), { history: "replace" });
  }, [setRouteSearch]);
  const closeWorkspacePanelShellOnly = useCallback(() => {
    void setRouteSearch(closeWorkspacePanelShell(), { history: "replace" });
  }, [setRouteSearch]);
  const closeWorkspacePanel = useCallback(
    (panel: RouteWorkspacePanel) => {
      void setRouteSearch((current) => closeWorkspacePanelTab(current, panel), { history: "replace" });
    },
    [setRouteSearch],
  );
  const openReview = useCallback(
    (scope: RouteReviewScope, turnId = "") => {
      const retainedTurnId = turnId || routeSearch.reviewTurnId || hunkSummary.latestTurnId;
      void setRouteSearch(
        (current) => ({
          ...openWorkspacePanelTab(current, "review"),
          reviewScope: scope,
          reviewTurnId: retainedTurnId,
          reviewPath: "",
        }),
        { history: "replace" },
      );
    },
    [hunkSummary.latestTurnId, routeSearch.reviewTurnId, setRouteSearch],
  );
  const changeReviewScope = useCallback(
    (scope: RouteReviewScope, turnId = "") => {
      openReview(scope, turnId);
    },
    [openReview],
  );
  useEffect(() => {
    if (
      activePanel === "review" &&
      routeSearch.reviewScope === "turn" &&
      !routeSearch.reviewTurnId &&
      hunkSummary.latestTurnId
    ) {
      void setRouteSearch({ reviewTurnId: hunkSummary.latestTurnId }, { history: "replace" });
    }
  }, [activePanel, hunkSummary.latestTurnId, routeSearch.reviewScope, routeSearch.reviewTurnId, setRouteSearch]);
  const openPlugins = useCallback(() => {
    void navigate({ to: defaultPluginsRoute(), search: true });
  }, [navigate]);
  const openSettings = useCallback(
    (section: string) => {
      void navigate({ to: "/settings/$section", params: { section }, search: true });
    },
    [navigate],
  );
  const resizeSidebar = useCallback(
    (startWidth: number, deltaX: number) => {
      void setRouteSearch(
        { leftWidth: clamp(startWidth + deltaX, sidebarWidthBounds.min, sidebarWidthBounds.max) },
        { history: "replace" },
      );
    },
    [setRouteSearch],
  );
  const resizeToolPanel = useCallback(
    (startWidth: number, deltaX: number) => {
      const nextWidth = toolPanelWidthFromDrag(startWidth, deltaX, toolPanelMaxWidth);
      if (toolPanelElementRef.current) {
        toolPanelElementRef.current.style.setProperty("--right-workspace-panel-width", `${nextWidth}px`);
      }
    },
    [toolPanelMaxWidth],
  );
  const commitToolPanelResize = useCallback(
    (startWidth: number, deltaX: number) => {
      const nextWidth = toolPanelWidthFromDrag(startWidth, deltaX, toolPanelMaxWidth);
      if (toolPanelElementRef.current) {
        toolPanelElementRef.current.style.setProperty("--right-workspace-panel-width", `${nextWidth}px`);
        toolPanelElementRef.current.style.willChange = "";
        toolPanelElementRef.current = null;
      }
      void setRouteSearch({ rightWidth: nextWidth }, { history: "replace" });
    },
    [setRouteSearch, toolPanelMaxWidth],
  );
  const beginSidebarResize = useHorizontalResize(leftSidebarWidth, resizeSidebar);
  const beginToolPanelElementResize = useHorizontalResize(toolPanelWidth, resizeToolPanel, {
    onCommit: commitToolPanelResize,
  });
  const beginToolPanelResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const toolPanelElement = event.currentTarget.parentElement;
      if (toolPanelElement instanceof HTMLElement) {
        toolPanelElementRef.current = toolPanelElement;
        toolPanelElement.style.setProperty("--right-workspace-panel-width", `${toolPanelWidth}px`);
        toolPanelElement.style.willChange = "width";
      }
      beginToolPanelElementResize(event);
    },
    [beginToolPanelElementResize, toolPanelWidth],
  );
  const appShellContext = useMemo(
    () => ({
      agent,
      activeThread,
      activeThreadBusy,
      activeWorkspaceCwd,
      activeWorkspaceRef,
      canScrollTranscriptToBottom,
      composerAttachments,
      composerFocusSignal,
      folderOptions,
      followSignal,
      hunkSummary,
      routeSearch,
      selectedExtensionId,
      setCanScrollTranscriptToBottom,
      setComposerAttachments,
      setRouteSearch,
      showWorkingIndicator,
      threadOptions,
      attachToComposer,
      followBottom,
      openReview,
      sendPrompt,
    }),
    [
      activeThread,
      activeThreadBusy,
      activeWorkspaceCwd,
      activeWorkspaceRef,
      agent,
      attachToComposer,
      canScrollTranscriptToBottom,
      composerAttachments,
      composerFocusSignal,
      folderOptions,
      followBottom,
      followSignal,
      hunkSummary,
      openReview,
      routeSearch,
      selectedExtensionId,
      sendPrompt,
      setRouteSearch,
      showWorkingIndicator,
      threadOptions,
    ],
  );

  return {
    appShellContext,
    layoutProps: {
      activeThread,
      activeThreadId,
      activeThreadGoal: agent.activeThreadGoal,
      activePanel,
      activeWorkspaceCwd,
      activeWorkspaceRef,
      folderOptions,
      isPluginsRoute,
      leftSidebarWidth,
      hunkSummary,
      reviewPath: routeSearch.reviewPath,
      reviewScope: routeSearch.reviewScope,
      reviewTurnId: routeSearch.reviewTurnId,
      panelTabs: routeSearch.panelTabs,
      selectedExtensionId,
      selectedExtensionPanelId: routeSearch.extensionPanel || null,
      sidebarOpen,
      status,
      threadOptions,
      threads,
      toolPanelWidth,
      workspacePanelOpen,
      onArchiveThread: archiveThread,
      onAttachToComposer: attachToComposer,
      onBeginSidebarResize: beginSidebarResize,
      onBeginToolPanelResize: beginToolPanelResize,
      onNewProject: newProject,
      onNewThread: newThread,
      onNewThreadInFolder: newThreadInFolder,
      onOpenPlugins: openPlugins,
      onOpenWorkspacePanel: openWorkspacePanel,
      onOpenWorkspacePanelShell: openWorkspacePanelShellOnly,
      onCloseWorkspacePanel: closeWorkspacePanel,
      onCloseWorkspacePanelShell: closeWorkspacePanelShellOnly,
      onOpenSettings: openSettings,
      onRestart: () => void restart(),
      onSelectExtension: selectExtensionFromRail,
      onSelectFolder: selectFolder,
      onSelectThread: selectThread,
      onSelectedExtensionPanelChange: (extensionPanel) =>
        void setRouteSearch({ extensionPanel }, { history: "replace" }),
      onReviewPathChange: (reviewPath) => void setRouteSearch({ reviewPath }, { history: "replace" }),
      onReviewScopeChange: changeReviewScope,
      onSelectWorkspacePanel: selectWorkspacePanel,
      onToggleSidebar: () => void setRouteSearch({ sidebar: !sidebarOpen }, { history: "replace" }),
    },
  };
}

function toolPanelWidthFromDrag(startWidth: number, deltaX: number, maxWidth: number): number {
  return clamp(startWidth - deltaX, toolPanelWidthBounds.min, maxWidth);
}

function toolPanelMaxWidthForViewport(viewportWidth: number, sidebarOpen: boolean, leftSidebarWidth: number): number {
  const leftChromeWidth = sidebarOpen ? leftSidebarWidth + sidebarResizeHandleWidth : 0;
  const availableWidth = viewportWidth - leftChromeWidth - mainPanelMinWidth;
  return clamp(availableWidth, toolPanelWidthBounds.min, toolPanelWidthBounds.max);
}

import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryStates, type SetValues } from "nuqs";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  mergeRouteSearchUpdate,
  routeSearchParsers,
  sidebarWidthBounds,
  toolPanelWidthBounds,
  type RouteReviewScope,
  type RouteToolPanel,
} from "@/lib/route-search";
import { buildFolderOptions, buildThreadOptions, latestThreadInFolder } from "@/lib/workspace-thread-options";
import type { DesktopAttachment } from "@/types/roder";

type AppShellController = {
  appShellContext: AppShellContextValue;
  layoutProps: AppShellLayoutProps;
};

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
  const activeTool = routeSearch.tool;
  const selectedExtensionId = routeSearch.extension || null;
  const sidebarOpen = routeSearch.sidebar;
  const leftSidebarWidth = routeSearch.leftWidth;
  const toolPanelWidth = routeSearch.rightWidth;
  const isPluginsRoute = isPluginsRoutePath(pathname);
  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  const activeThreadBusy = isThreadRunning(activeThread);
  const showWorkingIndicator = shouldShowThreadWorkingIndicator(activeThread, waitRequests.length, messages);
  const activeWorkspaceCwd = activeThread?.cwd ?? selectedWorkspaceCwd ?? status.cwd ?? "";
  const hunkSummary = useThreadHunkSummary(activeThreadId, agent.hunkRevision);
  const folderOptions = useMemo(() => buildFolderOptions(threads, activeWorkspaceCwd), [activeWorkspaceCwd, threads]);
  const threadOptions = useMemo(() => buildThreadOptions(threads, activeWorkspaceCwd), [activeWorkspaceCwd, threads]);
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
    void setRouteSearch({ tool: "extensions" }, { history: "replace" });
  }, [activeTool, setRouteSearch]);
  const selectExtensionFromRail = useCallback(
    (extensionId: string) => {
      void setRouteSearch({ tool: "extensions", extension: extensionId }, { history: "replace" });
    },
    [setRouteSearch],
  );
  const toggleToolPanel = useCallback(
    (toolName: RouteToolPanel) => {
      void setRouteSearch({ tool: activeTool === toolName ? null : toolName }, { history: "replace" });
    },
    [activeTool, setRouteSearch],
  );
  const openReview = useCallback(
    (scope: RouteReviewScope, turnId = "") => {
      const retainedTurnId = turnId || routeSearch.reviewTurnId || hunkSummary.latestTurnId;
      void setRouteSearch(
        {
          tool: "review",
          reviewScope: scope,
          reviewTurnId: retainedTurnId,
          reviewPath: "",
        },
        { history: "replace" },
      );
    },
    [hunkSummary.latestTurnId, routeSearch.reviewTurnId, setRouteSearch],
  );
  const toggleBranchReview = useCallback(() => {
    if (activeTool === "review" && routeSearch.reviewScope === "branch") {
      void setRouteSearch({ tool: null }, { history: "replace" });
      return;
    }
    openReview("branch");
  }, [activeTool, openReview, routeSearch.reviewScope, setRouteSearch]);
  const changeReviewScope = useCallback(
    (scope: RouteReviewScope, turnId = "") => {
      openReview(scope, turnId);
    },
    [openReview],
  );
  useEffect(() => {
    if (
      activeTool === "review" &&
      routeSearch.reviewScope === "turn" &&
      !routeSearch.reviewTurnId &&
      hunkSummary.latestTurnId
    ) {
      void setRouteSearch({ reviewTurnId: hunkSummary.latestTurnId }, { history: "replace" });
    }
  }, [activeTool, hunkSummary.latestTurnId, routeSearch.reviewScope, routeSearch.reviewTurnId, setRouteSearch]);
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
      void setRouteSearch(
        { rightWidth: clamp(startWidth - deltaX, toolPanelWidthBounds.min, toolPanelWidthBounds.max) },
        { history: "replace" },
      );
    },
    [setRouteSearch],
  );
  const beginSidebarResize = useHorizontalResize(leftSidebarWidth, resizeSidebar);
  const beginToolPanelResize = useHorizontalResize(toolPanelWidth, resizeToolPanel);
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
      activeTool,
      activeWorkspaceCwd,
      folderOptions,
      isPluginsRoute,
      leftSidebarWidth,
      hunkSummary,
      reviewPath: routeSearch.reviewPath,
      reviewScope: routeSearch.reviewScope,
      reviewTurnId: routeSearch.reviewTurnId,
      selectedExtensionId,
      selectedExtensionPanelId: routeSearch.extensionPanel || null,
      sidebarOpen,
      status,
      threadOptions,
      threads,
      toolPanelWidth,
      onArchiveThread: archiveThread,
      onAttachToComposer: attachToComposer,
      onBeginSidebarResize: beginSidebarResize,
      onBeginToolPanelResize: beginToolPanelResize,
      onNewProject: newProject,
      onNewThread: newThread,
      onNewThreadInFolder: newThreadInFolder,
      onOpenPlugins: openPlugins,
      onOpenSettings: openSettings,
      onRestart: () => void restart(),
      onSelectExtension: selectExtensionFromRail,
      onSelectFolder: selectFolder,
      onSelectThread: selectThread,
      onSelectedExtensionPanelChange: (extensionPanel) =>
        void setRouteSearch({ extensionPanel }, { history: "replace" }),
      onReviewPathChange: (reviewPath) => void setRouteSearch({ reviewPath }, { history: "replace" }),
      onReviewScopeChange: changeReviewScope,
      onToggleBrowser: () => toggleToolPanel("browser"),
      onToggleCanvas: () => toggleToolPanel("canvas"),
      onToggleExtensions: toggleExtensionsPanel,
      onToggleReview: toggleBranchReview,
      onToggleSidebar: () => void setRouteSearch({ sidebar: !sidebarOpen }, { history: "replace" }),
      onToggleTerminal: () => toggleToolPanel("terminal"),
    },
  };
}

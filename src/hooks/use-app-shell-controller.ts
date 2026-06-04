import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryStates, type SetValues } from "nuqs";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppShellContextValue } from "@/components/app-shell-context";
import type { AppShellLayoutProps } from "@/components/app-shell-layout";
import { useExtensionThemes } from "@/hooks/use-extension-themes";
import { useRoderAgent } from "@/hooks/use-roder-agent";
import { useThreadHunkSummary } from "@/hooks/use-thread-hunk-summary";
import { mergedCommandDescriptors } from "@/lib/native-commands";
import type { NativeCommandOutput } from "@/lib/native-command-formatters";
import { runNativeCommandInvocation, type LocalTranscriptOffset } from "@/lib/native-command-router";
import { roderIpc } from "@/lib/roder-ipc";
import { commandInvocation, slashCommandLikeText, type CommandInvocation } from "@/lib/roder-commands";
import { useThemeApplication } from "@/hooks/use-theme-application";
import {
  activeWorkspaceCwdForPathname,
  archiveRouteAfterThreadRemoval,
  defaultPluginsRoute,
  isPluginsRoutePath,
} from "@/lib/route-selection";
import { isThreadRunning, shouldShowThreadWorkingIndicator } from "@/lib/roder-thread";
import {
  closeWorkspacePanelShell,
  closeWorkspacePanelTab,
  mergeRouteSearchUpdate,
  openWorkspacePanelShell,
  openWorkspacePanelTab,
  routeSearchParsers,
  selectWorkspacePanelTab,
  type RouteReviewScope,
  type RouteWorkspacePanel,
} from "@/lib/route-search";
import { buildFolderOptions, buildThreadOptions, latestThreadInFolder } from "@/lib/workspace-thread-options";
import { useCommandsStore } from "@/stores/commands-store";
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
    models,
    newProject: createProjectThread,
    restart,
    runCommandInvocation,
    selectedWorkspaceCwd,
    selectThread: selectAgentThread,
    sendPrompt: sendAgentPrompt,
    setSelectedModel,
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
  const [nativeModelPickerOpen, setNativeModelPickerOpen] = useState(false);
  const [nativeCommandOutput, setNativeCommandOutput] = useState<NativeCommandOutput | null>(null);
  const [localTranscriptOffset, setLocalTranscriptOffset] = useState<LocalTranscriptOffset | null>(null);
  const [composerAttachments, setComposerAttachments] = useState<DesktopAttachment[]>([]);
  const activePanel = routeSearch.panelActive;
  const workspacePanelOpen = routeSearch.panelOpen;
  const selectedExtensionId = routeSearch.extension || null;
  const sidebarOpen = routeSearch.sidebar;
  const isPluginsRoute = isPluginsRoutePath(pathname);
  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  const activeThreadBusy = isThreadRunning(activeThread);
  const showWorkingIndicator = shouldShowThreadWorkingIndicator(activeThread, waitRequests.length, messages);
  const activeWorkspaceCwd = activeWorkspaceCwdForPathname({
    pathname,
    activeThreadCwd: activeThread?.cwd,
    selectedWorkspaceCwd,
    statusCwd: status.cwd,
  });
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
  useEffect(() => {
    setNativeCommandOutput(null);
    setNativeModelPickerOpen(false);
  }, [activeThreadId]);

  const hideNativeModelPicker = useCallback(() => {
    setNativeModelPickerOpen(false);
  }, []);

  const closeNativeModelPicker = useCallback(() => {
    setNativeModelPickerOpen(false);
    setComposerFocusSignal((value) => value + 1);
  }, []);

  const selectNativeCommandModel = useCallback(
    (modelId: string, modelProvider?: string) => {
      setSelectedModel(modelId, modelProvider);
      setNativeModelPickerOpen(false);
      setNativeCommandOutput(null);
      setComposerFocusSignal((value) => value + 1);
    },
    [setSelectedModel],
  );

  const runNativeCommand = useCallback(
    async (invocation: CommandInvocation): Promise<boolean> => {
      return runNativeCommandInvocation({
        actions: {
          closeModelPicker: hideNativeModelPicker,
          openModelPicker: () => setNativeModelPickerOpen(true),
          sendPrompt: sendAgentPrompt,
          setCommandOutput: setNativeCommandOutput,
          setLocalTranscriptOffset,
          setSelectedModel,
        },
        invocation,
        ipc: roderIpc,
        state: {
          activeThreadBusy,
          activeThreadId,
          messages,
          models,
        },
      });
    },
    [activeThreadBusy, activeThreadId, hideNativeModelPicker, messages, models, sendAgentPrompt, setSelectedModel],
  );

  const runCommandOrNativeInvocation = useCallback(
    async (invocation: CommandInvocation): Promise<void> => {
      if (await runNativeCommand(invocation)) {
        return;
      }
      await runCommandInvocation(invocation);
    },
    [runCommandInvocation, runNativeCommand],
  );

  // These send handlers are part of the memoized app-shell context value, so keep their identity stable.
  const sendPrompt = useCallback(
    async (prompt: string, attachments: DesktopAttachment[]) => {
      followBottom();
      let commands = mergedCommandDescriptors(useCommandsStore.getState().commands);
      if (attachments.length === 0 && slashCommandLikeText(prompt) && !useCommandsStore.getState().loaded) {
        await useCommandsStore.getState().load();
        commands = mergedCommandDescriptors(useCommandsStore.getState().commands);
      }
      const invocation = attachments.length === 0 ? commandInvocation(prompt, commands) : null;
      if (invocation) {
        await runCommandOrNativeInvocation(invocation);
        return;
      }
      await sendAgentPrompt(prompt, attachments);
    },
    [followBottom, runCommandOrNativeInvocation, sendAgentPrompt],
  );
  const sendCommandInvocation = useCallback(
    async (invocation: CommandInvocation) => {
      followBottom();
      await runCommandOrNativeInvocation(invocation);
    },
    [followBottom, runCommandOrNativeInvocation],
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
      nativeModelPickerOpen,
      nativeCommandOutput,
      folderOptions,
      followSignal,
      hunkSummary,
      routeSearch,
      selectedExtensionId,
      setCanScrollTranscriptToBottom,
      setComposerAttachments,
      setRouteSearch,
      showWorkingIndicator,
      localTranscriptOffset,
      threadOptions,
      attachToComposer,
      closeNativeModelPicker,
      followBottom,
      openReview,
      selectNativeCommandModel,
      sendCommandInvocation,
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
      nativeModelPickerOpen,
      nativeCommandOutput,
      folderOptions,
      followBottom,
      followSignal,
      hunkSummary,
      openReview,
      routeSearch,
      selectedExtensionId,
      sendCommandInvocation,
      sendPrompt,
      setRouteSearch,
      showWorkingIndicator,
      localTranscriptOffset,
      threadOptions,
      closeNativeModelPicker,
      selectNativeCommandModel,
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
      hunkSummary,
      reviewPath: routeSearch.reviewPath,
      reviewScope: routeSearch.reviewScope,
      reviewTurnId: routeSearch.reviewTurnId,
      panelTabs: routeSearch.panelTabs,
      selectedExtensionId,
      selectedExtensionPanelId: routeSearch.extensionPanel || null,
      initialWorkspacePanelWidth: routeSearch.rightWidth,
      sidebarOpen,
      status,
      threadOptions,
      threads,
      workspacePanelOpen,
      onArchiveThread: archiveThread,
      onAttachToComposer: attachToComposer,
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

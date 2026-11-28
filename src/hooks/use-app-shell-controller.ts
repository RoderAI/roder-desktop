import { useMatch, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryStates, type SetValues } from "nuqs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppShellContextValue } from "@/components/app-shell-context";
import type { AppShellLayoutProps } from "@/components/app-shell-layout";
import { useExtensionThemes } from "@/hooks/use-extension-themes";
import { activeThreadMessagesSnapshot, useRoderAgent } from "@/hooks/use-roder-agent";
import { useThreadHunkSummary } from "@/hooks/use-thread-hunk-summary";
import { loadedTurnIdsKey } from "@/lib/thread-hunk-loading";
import type { FilePanelIndexedPath, FilePanelSelectionIntent } from "@/lib/file-panel";
import { mergedCommandDescriptors } from "@/lib/native-commands";
import type { NativeCommandOutput } from "@/lib/native-command-formatters";
import { runNativeCommandInvocation, type LocalTranscriptOffset } from "@/lib/native-command-router";
import { roderIpc } from "@/lib/roder-ipc";
import { roderAgentsIpc } from "@/lib/roder-agents-ipc";
import {
  createProjectRoderAgent,
  type ProjectRoderAgentConfig,
  type CreatedProjectThread,
} from "@/lib/project-roder-agent";
import { useRoderStore } from "@/stores/roder-store";
import { commandInvocation, slashCommandLikeText, type CommandInvocation } from "@/lib/roder-commands";
import { useThemeApplication } from "@/hooks/use-theme-application";
import {
  activeWorkspaceContextForRoute,
  archiveRouteAfterThreadRemoval,
  defaultPluginsRoute,
  fullPageRouteForPathname,
  isNewRoutePath,
  isPluginsRoutePath,
  stageNewThreadAfterNavigation,
} from "@/lib/route-selection";
import { isThreadRunning } from "@/lib/roder-thread";
import {
  closeWorkspacePanelShell,
  closeWorkspacePanelTab,
  mergeRouteSearchUpdate,
  normalizeWorkspacePanelState,
  openWorkspacePanelTab,
  routeSearchParsers,
  selectWorkspacePanelTab,
  toggleWorkspacePanelShell,
  workspacePanelForThreadSelection,
  type RouteReviewScope,
  type RouteWorkspacePanel,
  type WorkspacePanelState,
} from "@/lib/route-search";
import { buildFolderOptions, buildThreadOptions, latestThreadInFolder } from "@/lib/workspace-thread-options";
import { useCloudMachinesStore } from "@/stores/cloud-machines-store";
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
    models,
    newProject: createProjectThread,
    restart,
    runCommandInvocation,
    selectedWorkspaceCwd,
    selectThread: selectAgentThread,
    sendPrompt: sendAgentPrompt,
    setSelectedModel,
    setSelectedWorkspaceCwd,
    stageNewThread: stageAgentNewThread,
    status,
    threads,
  } = agent;
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [routeSearch, setRawRouteSearch] = useQueryStates(routeSearchParsers);
  const setRouteSearch = useCallback<SetValues<typeof routeSearchParsers>>(
    (update, options) => setRawRouteSearch((current) => mergeRouteSearchUpdate(current, update), options),
    [setRawRouteSearch],
  );
  const threadRouteMatch = useMatch({ from: "/threads/$threadId", shouldThrow: false });
  useExtensionThemes();
  useThemeApplication(appearance);
  const [followSignal, setFollowSignal] = useState(0);
  const [canScrollTranscriptToBottom, setCanScrollTranscriptToBottom] = useState(false);
  const [composerFocusSignal, setComposerFocusSignal] = useState(0);
  const [nativeModelPickerOpen, setNativeModelPickerOpen] = useState(false);
  const [nativeCommandOutput, setNativeCommandOutput] = useState<NativeCommandOutput | null>(null);
  const [localTranscriptOffset, setLocalTranscriptOffset] = useState<LocalTranscriptOffset | null>(null);
  const [composerAttachments, setComposerAttachments] = useState<DesktopAttachment[]>([]);
  const [projectConfigOpen, setProjectConfigOpen] = useState(false);
  const [projectInitialFolders, setProjectInitialFolders] = useState<string[]>([]);
  const [projectCreating, setProjectCreating] = useState(false);
  const [projectCreationError, setProjectCreationError] = useState<string | null>(null);
  const [createdProjectThread, setCreatedProjectThread] = useState<CreatedProjectThread | null>(null);
  const [fileSearchOpen, setFileSearchOpen] = useState(false);
  const [fileSearchSelectionIntent, setFileSearchSelectionIntent] = useState<FilePanelSelectionIntent | null>(null);
  const activePanel = routeSearch.panelActive;
  const panelTabs = routeSearch.panelTabs;
  const workspacePanelOpen = routeSearch.panelOpen;
  const selectedExtensionId = routeSearch.extension || null;
  const sidebarOpen = routeSearch.sidebar;
  const isPluginsRoute = isPluginsRoutePath(pathname);
  const isNewRoute = isNewRoutePath(pathname);
  const routeThreadId = threadRouteMatch?.params.threadId ?? "";
  const threadPanelStates = useRef(new Map<string, Pick<WorkspacePanelState, "panelTabs" | "panelActive">>());
  useEffect(() => {
    if (routeThreadId) {
      const { panelTabs: tabs, panelActive } = normalizeWorkspacePanelState(panelTabs, activePanel);
      threadPanelStates.current.set(routeThreadId, { panelTabs: tabs, panelActive });
    }
  }, [routeThreadId, panelTabs, activePanel]);
  const routeActiveThreadId = routeThreadId || (isNewRoute ? "" : activeThreadId);
  const activeThread = threads.find((thread) => thread.id === routeActiveThreadId);
  const activeThreadBusy = isThreadRunning(activeThread);
  const cloudMachines = useCloudMachinesStore((state) => state.machines);
  const selectedCloudMachineId = useCloudMachinesStore((state) => state.selectedMachineId);
  const selectCloudMachine = useCloudMachinesStore((state) => state.select);
  const activeWorkspaceContext = useMemo(
    () =>
      activeWorkspaceContextForRoute({
        isNewRoute,
        routeThread: activeThread,
        selectedWorkspaceCwd,
        selectedWorkspaceId: agent.selectedWorkspaceId,
        selectedRootId: agent.selectedRootId,
        statusCwd: status.cwd,
        workspaces: agent.workspaces,
        cloudMachines,
        selectedCloudMachineId,
      }),
    [
      activeThread,
      agent.selectedRootId,
      agent.selectedWorkspaceId,
      agent.workspaces,
      cloudMachines,
      isNewRoute,
      selectedCloudMachineId,
      selectedWorkspaceCwd,
      status.cwd,
    ],
  );
  const activeWorkspaceCwd = activeWorkspaceContext.cwd;
  const activeWorkspaceRef = activeWorkspaceContext.ref;
  const activeWorkspaceRoots = activeWorkspaceContext.roots;
  const activeRemoteWorkspace = activeWorkspaceContext.remote;
  const loadedTurnsKey = useRoderStore((state) => loadedTurnIdsKey(state.threadDetails[routeActiveThreadId]?.turns));
  const loadedTurnIds = JSON.parse(loadedTurnsKey) as string[];
  const hunkSummary = useThreadHunkSummary(
    routeActiveThreadId,
    agent.hunkRevision,
    workspacePanelOpen && activePanel === "review" && routeSearch.reviewScope === "thread"
      ? undefined
      : workspacePanelOpen && activePanel === "review" && routeSearch.reviewScope === "turn" && routeSearch.reviewTurnId
        ? [routeSearch.reviewTurnId]
        : loadedTurnIds,
  );
  const folderOptions = useMemo(() => buildFolderOptions(threads, activeWorkspaceCwd), [activeWorkspaceCwd, threads]);
  const threadOptions = useMemo(() => buildThreadOptions(threads, activeWorkspaceCwd), [activeWorkspaceCwd, threads]);
  const followBottom = useCallback(() => setFollowSignal((value) => value + 1), []);
  const selectThread = useCallback(
    (threadId: string, kind?: "roder") => {
      const remembered = kind === "roder" ? threadPanelStates.current.get(threadId) : undefined;
      void navigate({
        to: "/threads/$threadId",
        params: { threadId },
        search:
          threadId === routeThreadId
            ? true
            : (previous) => ({ ...previous, ...workspacePanelForThreadSelection(previous, remembered) }),
      });
      void selectAgentThread(threadId, { pushHistory: false });
    },
    [navigate, routeThreadId, selectAgentThread],
  );
  const archiveThread = useCallback(
    (threadId: string) => {
      const target = archiveRouteAfterThreadRemoval({
        activeThreadId: routeActiveThreadId,
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
    [archiveAgentThread, navigate, routeActiveThreadId, threads],
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
    (path: string, cloudMachineId?: string) => {
      if (cloudMachineId !== undefined) {
        selectCloudMachine(cloudMachineId);
      }
      followBottom();
      setComposerFocusSignal((value) => value + 1);
      void stageNewThreadAfterNavigation(() => navigate({ to: "/new", search: true }), stageAgentNewThread, path);
    },
    [followBottom, navigate, selectCloudMachine, stageAgentNewThread],
  );
  const openBrowserPreview = useCallback(
    (url: string) => {
      void setRouteSearch((current) => openWorkspacePanelTab(current, "browser"), { history: "replace" });
      void window.roderDesktop.browserNavigate(url);
    },
    [setRouteSearch],
  );
  const newProject = useCallback(() => {
    if (projectCreating) return;
    followBottom();
    void roderIpc.openWorkspaceFolder(activeWorkspaceCwd || selectedWorkspaceCwd || status.cwd).then((folder) => {
      if (!folder) {
        return;
      }
      setProjectInitialFolders([folder]);
      setProjectCreationError(null);
      setCreatedProjectThread(null);
      setProjectConfigOpen(true);
    });
  }, [activeWorkspaceCwd, followBottom, projectCreating, selectedWorkspaceCwd, status.cwd]);
  async function createConfiguredProject(params: ProjectRoderAgentConfig): Promise<void> {
    if (projectCreating) return;
    setProjectCreating(true);
    setProjectCreationError(null);
    try {
      const project = await createProjectRoderAgent(
        params,
        {
          createProject: createProjectThread,
          promote: roderAgentsIpc.promote,
          snapshot: useRoderStore.getState,
          onCreated: (project) => {
            setCreatedProjectThread(project);
            void navigate({ to: "/threads/$threadId", params: { threadId: project.threadId }, search: true });
          },
        },
        createdProjectThread,
      );
      await useRoderStore.getState().refreshThreadModel(project.threadId);
      followBottom();
      await navigate({ to: "/threads/$threadId", params: { threadId: project.threadId }, search: true });
      setProjectConfigOpen(false);
      setProjectInitialFolders([]);
      setCreatedProjectThread(null);
    } catch (cause) {
      setProjectCreationError(cause instanceof Error ? cause.message : String(cause));
    }
    setProjectCreating(false);
  }
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
        return;
      }
      if (appCommand.command === "openBrowser") {
        void setRouteSearch((current) => openWorkspacePanelTab(current, "browser"));
        return;
      }
      if (appCommand.command === "openFileSearch") {
        setFileSearchOpen(true);
      }
    });
  }, [navigate, newProject, newThread, setRouteSearch]);
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
  // Reset per-thread command UI when the thread changes (adjusted during render, not in an effect).
  const [commandUiThreadId, setCommandUiThreadId] = useState(routeActiveThreadId);
  if (commandUiThreadId !== routeActiveThreadId) {
    setCommandUiThreadId(routeActiveThreadId);
    setNativeCommandOutput(null);
    setNativeModelPickerOpen(false);
  }

  const hideNativeModelPicker = useCallback(() => {
    setNativeModelPickerOpen(false);
  }, []);

  const closeNativeModelPicker = useCallback(() => {
    setNativeModelPickerOpen(false);
    setComposerFocusSignal((value) => value + 1);
  }, []);

  const selectNativeCommandModel = useCallback(
    (modelId: string, modelProvider?: string) => {
      void setSelectedModel(modelId, modelProvider);
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
          activeThreadId: routeActiveThreadId,
          // Read lazily so the app shell doesn't re-render on every streaming delta.
          messages: activeThreadMessagesSnapshot(),
          models,
        },
      });
    },
    [activeThreadBusy, hideNativeModelPicker, models, routeActiveThreadId, sendAgentPrompt, setSelectedModel],
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
  const steerPrompt = useCallback(
    async (prompt: string, attachments: DesktopAttachment[]) => {
      followBottom();
      await agent.steerPrompt(prompt, attachments);
    },
    [agent, followBottom],
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
  const selectFileSearchPath = useCallback(
    (indexedPath: FilePanelIndexedPath) => {
      setFileSearchSelectionIntent((current) => ({
        id: (current?.id ?? 0) + 1,
        workspaceId: activeWorkspaceRef.workspaceId,
        indexedPath,
      }));
      void setRouteSearch((current) => openWorkspacePanelTab(current, "files"), { history: "replace" });
    },
    [activeWorkspaceRef.workspaceId, setRouteSearch],
  );

  useEffect(() => {
    return roderIpc.onNotification((notification) => {
      if (!isDesignCanvasNotification(notification.method)) {
        return;
      }
      void setRouteSearch((current) => openWorkspacePanelTab(current, "design"), { history: "replace" });
    });
  }, [setRouteSearch]);
  const toggleWorkspacePanelShellOnly = useCallback(() => {
    void setRouteSearch((current) => toggleWorkspacePanelShell(current), { history: "replace" });
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
      localTranscriptOffset,
      threadOptions,
      attachToComposer,
      closeNativeModelPicker,
      followBottom,
      newProject,
      openReview,
      selectNativeCommandModel,
      sendCommandInvocation,
      sendPrompt,
      steerPrompt,
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
      newProject,
      hunkSummary,
      openReview,
      routeSearch,
      selectedExtensionId,
      sendCommandInvocation,
      sendPrompt,
      steerPrompt,
      setRouteSearch,
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
      activeThreadId: routeActiveThreadId,
      activeThreadGoal: agent.activeThreadGoal,
      activePanel,
      activeWorkspaceCwd,
      activeWorkspaceRef,
      activeWorkspaceRoots,
      activeRemoteWorkspace,
      folderOptions,
      isPluginsRoute,
      fullPageRoute: fullPageRouteForPathname(pathname),
      hunkSummary,
      hasMoreThreads: agent.hasMoreThreads,
      loadingMoreThreads: agent.loadingMoreThreads,
      reviewPath: routeSearch.reviewPath,
      reviewScope: routeSearch.reviewScope,
      reviewTurnId: routeSearch.reviewTurnId,
      panelTabs: routeSearch.panelTabs,
      fileSearchOpen,
      fileSearchSelectionIntent,
      selectedExtensionId,
      selectedExtensionPanelId: routeSearch.extensionPanel || null,
      initialWorkspacePanelWidth: routeSearch.rightWidth,
      sidebarOpen,
      status,
      threadOptions,
      threads,
      workspacePanelOpen,
      projectConfigOpen,
      projectCreating,
      projectCreationError,
      projectCreated: createdProjectThread !== null,
      projectInitialFolders,
      onArchiveThread: archiveThread,
      onLoadMoreThreads: agent.loadMoreThreads,
      onAttachToComposer: attachToComposer,
      onCreateProject: createConfiguredProject,
      onFileSearchOpenChange: setFileSearchOpen,
      onFileSearchSelect: selectFileSearchPath,
      onProjectConfigOpenChange: setProjectConfigOpen,
      onNewProject: newProject,
      onNewThread: newThread,
      onNewThreadInFolder: newThreadInFolder,
      onOpenBrowserPreview: openBrowserPreview,
      onOpenPlugins: openPlugins,
      onOpenWorkspacePanel: openWorkspacePanel,
      onToggleWorkspacePanelShell: toggleWorkspacePanelShellOnly,
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
      onSendPrompt: sendPrompt,
      onSelectWorkspacePanel: selectWorkspacePanel,
      onToggleSidebar: () => void setRouteSearch({ sidebar: !sidebarOpen }, { history: "replace" }),
    },
  };
}

function isDesignCanvasNotification(method: string): boolean {
  return (
    method === "design/documentChanged" || method === "design/selectionChanged" || method === "design/exportCompleted"
  );
}

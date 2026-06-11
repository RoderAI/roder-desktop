import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { roderIpc } from "@/lib/roder-ipc";
import { activeTurnIdForThread, messagesFromThread } from "@/lib/roder-thread";
import { visibleModelsFor } from "@/lib/roder-models";
import { waitRequestsForThread } from "@/lib/roder-wait-requests";
import { useRoderStore } from "@/stores/roder-store";

export function useRoderAgent() {
  useRoderStoreBootstrap();
  const state = useRoderStore(useShallow(selectAgentState));
  const models = useMemo(
    () => visibleModelsFor(state.allModels, state.visibleModelIds),
    [state.allModels, state.visibleModelIds],
  );

  return useMemo(
    () => ({
      ...state,
      models,
    }),
    [models, state],
  );
}

function useRoderStoreBootstrap(): void {
  const bootstrap = useRoderStore((state) => state.bootstrap);
  const applyAppearance = useRoderStore((state) => state.applyAppearance);
  const applyStatus = useRoderStore((state) => state.applyStatus);
  const applyStderr = useRoderStore((state) => state.applyStderr);
  const applyNotification = useRoderStore((state) => state.applyNotification);

  useEffect(() => {
    const offAppearance = roderIpc.onAppearance(applyAppearance);
    const offStatus = roderIpc.onStatus(applyStatus);
    const offStderr = roderIpc.onStderr(applyStderr);
    const offNotification = roderIpc.onNotification(applyNotification);

    void roderIpc.appearance().then(applyAppearance);
    void bootstrap();

    return () => {
      offAppearance();
      offStatus();
      offStderr();
      offNotification();
    };
  }, [applyAppearance, applyNotification, applyStatus, applyStderr, bootstrap]);
}

function selectAgentState(state: ReturnType<typeof useRoderStore.getState>) {
  const activeThread =
    state.threadDetails[state.activeThreadId] ?? state.threads.find((thread) => thread.id === state.activeThreadId);
  const activeThreadGoal = state.threadGoalsByThread[state.activeThreadId] ?? null;
  const messages = messagesFromThread(activeThread);
  const waitRequests = waitRequestsForThread(state.pendingWaitRequestsByThread, state.activeThreadId);
  return {
    status: state.status,
    stderr: state.stderr,
    threads: state.threads,
    hasMoreThreads: Boolean(state.nextThreadCursor),
    loadingMoreThreads: state.loadingMoreThreads,
    activeThreadId: state.activeThreadId,
    activeThreadGoal: activeThreadGoal?.threadId === state.activeThreadId ? activeThreadGoal : null,
    queuedPrompts: state.queuedPromptsByThread[state.activeThreadId || "new-thread"] ?? [],
    messages,
    allModels: state.models,
    routingOptions: state.routingOptions,
    visibleModelIds: state.visibleModelIds,
    selectedModel: state.selectedModel,
    selectedModelProvider: state.selectedModelProvider,
    selectedSelectionMode: state.selectedSelectionMode,
    selectedReasoning: state.selectedReasoning,
    selectedPolicyMode: state.selectedPolicyMode,
    workspaces: state.workspaces,
    selectedWorkspaceId: state.selectedWorkspaceId,
    selectedRootId: state.selectedRootId,
    selectedWorkspaceCwd: state.selectedWorkspaceCwd,
    workspaceRecents: state.workspaceRecents,
    waitRequests,
    appearance: state.appearance,
    busy: state.busy,
    activeTurnId: activeTurnIdForThread(activeThread),
    hunkRevision: state.hunkRevisionByThread[state.activeThreadId] ?? 0,
    hydrated: state.hydrated,
    error: state.error,
    canGoBack: state.backStack.length > 0,
    canGoForward: state.forwardStack.length > 0,
    selectThread: state.selectThread,
    archiveThread: state.archiveThread,
    loadMoreThreads: state.loadMoreThreads,
    goBack: state.goBack,
    goForward: state.goForward,
    newProject: state.newProject,
    newThread: state.newThread,
    stageNewThread: state.stageNewThread,
    runCommandInvocation: state.runCommandInvocation,
    addQueuedPrompt: state.addQueuedPrompt,
    removeQueuedPrompt: state.removeQueuedPrompt,
    sendPrompt: state.sendPrompt,
    steerPrompt: state.steerPrompt,
    stopTurn: state.stopTurn,
    restart: state.restart,
    setSelectedModel: state.setSelectedModel,
    setSelectedAutoModel: state.setSelectedAutoModel,
    setSelectedReasoning: state.setSelectedReasoning,
    setSelectedPolicyMode: state.setSelectedPolicyMode,
    saveDefaults: state.saveDefaults,
    setSelectedWorkspaceCwd: state.setSelectedWorkspaceCwd,
    openWorkspaceFolder: state.openWorkspaceFolder,
    resolveApproval: state.resolveApproval,
    resolveUserInput: state.resolveUserInput,
    exitPlan: state.exitPlan,
  };
}

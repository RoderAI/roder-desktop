import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { roderIpc } from "@/lib/roder-ipc";
import {
  activeTurnIdForThread,
  messagesFromThread,
  shouldShowThreadWorkingIndicator,
} from "@/lib/roder-thread";
import { visibleModelsFor } from "@/lib/roder-models";
import { waitRequestsForThread } from "@/lib/roder-wait-requests";
import { useRoderStore } from "@/stores/roder-store";
import type { ConversationMessage, QueuedPrompt } from "@/types/roder";

const emptyQueuedPrompts: QueuedPrompt[] = [];

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

type RoderStoreState = ReturnType<typeof useRoderStore.getState>;

function activeThreadForState(state: RoderStoreState) {
  return state.threadDetails[state.activeThreadId] ?? state.threads.find((thread) => thread.id === state.activeThreadId);
}

/** Messages of the store-active thread. Subscribes narrowly so only consumers
 * of the transcript re-render on streaming deltas. */
export function useActiveThreadMessages(): ConversationMessage[] {
  return useRoderStore((state) => messagesFromThread(activeThreadForState(state)));
}

/** Snapshot (non-reactive) of the active thread's messages, for event handlers. */
export function activeThreadMessagesSnapshot(): ConversationMessage[] {
  return messagesFromThread(activeThreadForState(useRoderStore.getState()));
}

/** Working-indicator flag derived inside the selector so streaming deltas only
 * re-render subscribers when the boolean actually flips. */
export function useShowWorkingIndicator(routeActiveThreadId: string): boolean {
  return useRoderStore((state) => {
    const routeThread = state.threads.find((thread) => thread.id === routeActiveThreadId);
    const waitRequests = waitRequestsForThread(state.pendingWaitRequestsByThread, state.activeThreadId);
    const messages = messagesFromThread(activeThreadForState(state));
    return shouldShowThreadWorkingIndicator(routeThread, waitRequests.length, messages);
  });
}

function useRoderStoreBootstrap(): void {
  const bootstrap = useRoderStore((state) => state.bootstrap);
  const applyAppearance = useRoderStore((state) => state.applyAppearance);
  const applyStatus = useRoderStore((state) => state.applyStatus);
  const applyStderr = useRoderStore((state) => state.applyStderr);
  const applyNotification = useRoderStore((state) => state.applyNotification);
  const mcpAuthRequested = useRoderStore((state) => state.mcpAuthRequested);
  const mcpOAuthComplete = useRoderStore((state) => state.mcpOAuthComplete);

  useEffect(() => {
    const offAppearance = roderIpc.onAppearance(applyAppearance);
    const offStatus = roderIpc.onStatus(applyStatus);
    const offStderr = roderIpc.onStderr(applyStderr);
    const offNotification = roderIpc.onNotification(applyNotification);
    const offMcpAuthRequested = window.roderDesktop.onMcpAuthRequested(mcpAuthRequested);
    const offMcpOAuthCallback = window.roderDesktop.onMcpOAuthCallback(({ id, status, error }) => {
      mcpOAuthComplete(id, status, error);
    });

    void roderIpc.appearance().then(applyAppearance);
    void bootstrap();

    return () => {
      offAppearance();
      offStatus();
      offStderr();
      offNotification();
      offMcpAuthRequested();
      offMcpOAuthCallback();
    };
  }, [applyAppearance, applyNotification, applyStatus, applyStderr, bootstrap, mcpAuthRequested, mcpOAuthComplete]);
}

function selectAgentState(state: RoderStoreState) {
  const activeThread = activeThreadForState(state);
  const activeThreadGoal = state.threadGoalsByThread[state.activeThreadId] ?? null;
  const waitRequests = waitRequestsForThread(state.pendingWaitRequestsByThread, state.activeThreadId);
  return {
    status: state.status,
    stderr: state.stderr,
    threads: state.threads,
    hasMoreThreads: Boolean(state.nextThreadCursor),
    loadingMoreThreads: state.loadingMoreThreads,
    activeThreadId: state.activeThreadId,
    activeThreadGoal: activeThreadGoal?.threadId === state.activeThreadId ? activeThreadGoal : null,
    queuedPrompts: state.queuedPromptsByThread[state.activeThreadId || "new-thread"] ?? emptyQueuedPrompts,
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
    pendingMcpAuthRequests: state.pendingMcpAuthRequests,
    mcpAuthSkip: state.mcpAuthSkip,
    mcpAuthApiKeySubmit: state.mcpAuthApiKeySubmit,
    mcpOAuthStart: window.roderDesktop.mcpOAuthStart,
  };
}

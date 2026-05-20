import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { roderIpc } from "@/lib/roder-ipc";
import { visibleModelsFor } from "@/lib/roder-models";
import { useRoderStore } from "@/stores/roder-store";
import type { ConversationMessage } from "@/types/roder";

const emptyMessages: ConversationMessage[] = [];

export function useRoderAgent() {
  useRoderStoreBootstrap();
  const state = useRoderStore(useShallow(selectAgentState));
  const models = useMemo(() => visibleModelsFor(state.allModels, state.visibleModelIds), [state.allModels, state.visibleModelIds]);

  return {
    ...state,
    models,
  };
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
  const messages = state.messagesByThread[state.activeThreadId] ?? emptyMessages;
  return {
    status: state.status,
    stderr: state.stderr,
    threads: state.threads,
    activeThreadId: state.activeThreadId,
    messages,
    allModels: state.models,
    visibleModelIds: state.visibleModelIds,
    selectedModel: state.selectedModel,
    selectedReasoning: state.selectedReasoning,
    selectedPolicyMode: state.selectedPolicyMode,
    selectedWorkspaceCwd: state.selectedWorkspaceCwd,
    workspaceRecents: state.workspaceRecents,
    appearance: state.appearance,
    busy: state.busy,
    activeTurnId: state.activeTurnId,
    hydrated: state.hydrated,
    error: state.error,
    canGoBack: state.backStack.length > 0,
    canGoForward: state.forwardStack.length > 0,
    selectThread: state.selectThread,
    archiveThread: state.archiveThread,
    goBack: state.goBack,
    goForward: state.goForward,
    newProject: state.newProject,
    newThread: state.newThread,
    sendPrompt: state.sendPrompt,
    stopTurn: state.stopTurn,
    restart: state.restart,
    setSelectedModel: state.setSelectedModel,
    setSelectedReasoning: state.setSelectedReasoning,
    setSelectedPolicyMode: state.setSelectedPolicyMode,
    setSelectedWorkspaceCwd: state.setSelectedWorkspaceCwd,
    openWorkspaceFolder: state.openWorkspaceFolder,
  };
}

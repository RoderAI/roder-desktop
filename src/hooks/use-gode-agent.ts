import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { godeIpc } from "@/lib/gode-ipc";
import { visibleModelsFor } from "@/lib/gode-models";
import { useGodeStore } from "@/stores/gode-store";
import type { ConversationMessage } from "@/types/gode";

const emptyMessages: ConversationMessage[] = [];

export function useGodeAgent() {
  useGodeStoreBootstrap();
  const state = useGodeStore(useShallow(selectAgentState));
  const models = useMemo(() => visibleModelsFor(state.allModels, state.visibleModelIds), [state.allModels, state.visibleModelIds]);

  return {
    ...state,
    models,
  };
}

function useGodeStoreBootstrap(): void {
  const bootstrap = useGodeStore((state) => state.bootstrap);
  const applyAppearance = useGodeStore((state) => state.applyAppearance);
  const applyStatus = useGodeStore((state) => state.applyStatus);
  const applyStderr = useGodeStore((state) => state.applyStderr);
  const applyNotification = useGodeStore((state) => state.applyNotification);

  useEffect(() => {
    const offAppearance = godeIpc.onAppearance(applyAppearance);
    const offStatus = godeIpc.onStatus(applyStatus);
    const offStderr = godeIpc.onStderr(applyStderr);
    const offNotification = godeIpc.onNotification(applyNotification);

    void godeIpc.appearance().then(applyAppearance);
    void bootstrap();

    return () => {
      offAppearance();
      offStatus();
      offStderr();
      offNotification();
    };
  }, [applyAppearance, applyNotification, applyStatus, applyStderr, bootstrap]);
}

function selectAgentState(state: ReturnType<typeof useGodeStore.getState>) {
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
    goBack: state.goBack,
    goForward: state.goForward,
    newThread: state.newThread,
    sendPrompt: state.sendPrompt,
    stopTurn: state.stopTurn,
    restart: state.restart,
    setSelectedModel: state.setSelectedModel,
    cycleSelectedReasoning: state.cycleSelectedReasoning,
    setSelectedWorkspaceCwd: state.setSelectedWorkspaceCwd,
    openWorkspaceFolder: state.openWorkspaceFolder,
  };
}

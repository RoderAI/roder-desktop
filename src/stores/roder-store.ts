import { create } from "zustand";
import { persist } from "zustand/middleware";
import { roderIpc } from "@/lib/roder-ipc";
import {
  activeTurnIdForThread,
  assistantMessageId,
  messagesFromRoderItem,
  messagesFromThread,
  markThreadStatus,
  normalizeAssistantPhase,
  sortThreadsByUpdatedAt,
  upsertConversationMessage,
  upsertThread,
} from "@/lib/roder-thread";
import { reducePendingWaitRequests, setWaitRequestResolving, shouldDisplayStartedItem } from "@/lib/roder-wait-requests";
import { compactVisibleModelIds, effectiveSelectedModel, selectedModelProvider, visibleModelIdsFor, visibleModelsFor } from "@/lib/roder-models";
import { normalizeCwd, normalizeThreadCwd, normalizeThreadsCwd, requireAbsoluteCwd, upsertWorkspaceRecent } from "@/lib/roder-workspaces";
import type {
  ApprovalWaitRequest,
  ConversationMessage,
  DesktopAttachment,
  PendingWaitRequestsByThread,
  PolicyMode,
  PlanExitWaitRequest,
  RoderModel,
  RoderNotification,
  RoderItem,
  RoderStatus,
  RoderThread,
  NavigationEntry,
  ReasoningEffort,
  SystemAppearance,
  UserInputWaitRequest,
  WorkspaceFolder,
} from "@/types/roder";

type RoderStore = {
  status: RoderStatus;
  stderr: string[];
  threads: RoderThread[];
  threadDetails: Record<string, RoderThread>;
  messagesByThread: Record<string, ConversationMessage[]>;
  activeThreadId: string;
  backStack: NavigationEntry[];
  forwardStack: NavigationEntry[];
  models: RoderModel[];
  visibleModelIds: string[];
  selectedModel: string;
  selectedReasoning: ReasoningEffort;
  selectedPolicyMode: PolicyMode;
  selectedWorkspaceCwd: string;
  workspaceRecents: WorkspaceFolder[];
  pendingWaitRequestsByThread: PendingWaitRequestsByThread;
  appearance: SystemAppearance;
  busy: boolean;
  hydrated: boolean;
  error: string | null;
  bootstrap: () => Promise<void>;
  refreshThreads: () => Promise<void>;
  selectThread: (threadId: string, options?: { pushHistory?: boolean }) => Promise<void>;
  archiveThread: (threadId: string) => Promise<void>;
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  newProject: () => Promise<void>;
  newThread: () => Promise<void>;
  sendPrompt: (prompt: string, attachments?: DesktopAttachment[]) => Promise<void>;
  stopTurn: () => Promise<void>;
  restart: () => Promise<void>;
  setSelectedModel: (model: string) => void;
  setSelectedReasoning: (reasoning: ReasoningEffort) => void;
  setSelectedPolicyMode: (mode: PolicyMode) => Promise<void>;
  setModelVisibility: (modelId: string, visible: boolean) => void;
  resetVisibleModels: () => void;
  setSelectedWorkspaceCwd: (cwd: string) => void;
  openWorkspaceFolder: () => Promise<void>;
  resolveApproval: (request: ApprovalWaitRequest, approved: boolean) => Promise<void>;
  resolveUserInput: (request: UserInputWaitRequest, answers: Record<string, string>) => Promise<void>;
  exitPlan: (request: PlanExitWaitRequest, approved: boolean) => Promise<void>;
  applyAppearance: (appearance: SystemAppearance) => void;
  applyStatus: (status: RoderStatus) => void;
  applyStderr: (message: string) => void;
  applyNotification: (notification: RoderNotification) => void;
};

const initialStatus: RoderStatus = {
  state: "starting",
  binary: "unresolved",
};

function normalizeReasoningEffort(value: string | undefined): ReasoningEffort {
  if (value === "medium") {
    return "medium";
  }
  if (value === "high") {
    return "high";
  }
  if (value === "xhigh") {
    return "xhigh";
  }
  return "low";
}

function normalizePolicyMode(value: string | undefined): PolicyMode {
  if (value === "default" || value === "accept_all" || value === "plan" || value === "bypass") {
    return value;
  }
  if (value === "accept_edits" || value === "accept-edits" || value === "accept-all") {
    return "accept_all";
  }
  return "accept_all";
}

function realThreads(threads: RoderThread[]): RoderThread[] {
  return sortThreadsByUpdatedAt(threads.filter((thread) => !thread.id.startsWith("demo-")));
}

function firstThreadId(threads: RoderThread[], fallback: string): string {
  return threads[0]?.id ?? fallback;
}

function activeMessages(messagesByThread: Record<string, ConversationMessage[]>, threadId: string): ConversationMessage[] {
  return messagesByThread[threadId] ?? [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function notificationParams(notification: RoderNotification): Record<string, unknown> {
  return isRecord(notification.params) ? notification.params : {};
}

export const useRoderStore = create<RoderStore>()(
  persist(
    (set, get) => ({
      status: initialStatus,
      stderr: [],
      threads: [],
      threadDetails: {},
      messagesByThread: {},
      activeThreadId: "",
      backStack: [],
      forwardStack: [],
      models: [],
      visibleModelIds: [],
      selectedModel: "gpt-5.3-codex",
      selectedReasoning: "medium",
      selectedPolicyMode: "accept_all",
      selectedWorkspaceCwd: "",
      workspaceRecents: [],
      pendingWaitRequestsByThread: {},
      appearance: "light",
      busy: false,
      hydrated: false,
      error: null,

      bootstrap: async () => {
        set({ busy: true, error: null });
        try {
          const readyStatus = await roderIpc.start();
          const [status, threadResult, modelResult, threadState] = await Promise.all([
            roderIpc.status().then((current) => (current.state === "starting" ? readyStatus : current)),
            roderIpc.listThreads(100),
            roderIpc.listModels(),
            roderIpc.threadState(),
          ]);

          const threads = realThreads(normalizeThreadsCwd(threadResult.data, status.cwd));
          const current = get();
          const models = modelResult.models;
          const visibleModelIds = compactVisibleModelIds(models, visibleModelIdsFor(models, current.visibleModelIds));
          const visibleModels = visibleModelsFor(models, visibleModelIds);
          const activeThreadId = threads.some((thread) => thread.id === current.activeThreadId)
            ? current.activeThreadId
            : firstThreadId(threads, "");
          const activeThread = threads.find((thread) => thread.id === activeThreadId);
          const selectedWorkspaceCwd = normalizeCwd(current.selectedWorkspaceCwd || activeThread?.cwd || status.cwd || "", status.cwd);
          const currentSelectedModel = visibleModels.some((model) => model.id === current.selectedModel)
            ? current.selectedModel
            : visibleModels.find((model) => model.isDefault)?.id || visibleModels[0]?.id || "gpt-5.3-codex";
          const selectedPolicyMode = normalizePolicyMode(threadState.mode);

          set({
            status,
            threads,
            models,
            visibleModelIds,
            selectedWorkspaceCwd,
            workspaceRecents: upsertWorkspaceRecent(current.workspaceRecents, selectedWorkspaceCwd),
            selectedModel: currentSelectedModel,
            selectedReasoning: normalizeReasoningEffort(
              current.selectedReasoning || models.find((model) => model.id === currentSelectedModel)?.defaultReasoningEffort,
            ),
            selectedPolicyMode,
            activeThreadId,
            hydrated: true,
            busy: false,
            error: null,
          });

          if (activeThreadId) {
            await get().selectThread(activeThreadId, { pushHistory: false });
          }
        } catch (error) {
          set({
            status: { state: "error", binary: "unresolved", message: (error as Error).message },
            busy: false,
            hydrated: true,
            error: (error as Error).message,
          });
        }
      },

      refreshThreads: async () => {
        const result = await roderIpc.listThreads(100);
        set({ threads: realThreads(normalizeThreadsCwd(result.data ?? [], get().status.cwd)) });
      },

      selectThread: async (threadId, options = { pushHistory: true }) => {
        const current = get();
        if (threadId === current.activeThreadId && current.messagesByThread[threadId]) {
          return;
        }

        set({
          activeThreadId: threadId,
          backStack: options.pushHistory && current.activeThreadId
            ? [...current.backStack, { threadId: current.activeThreadId, at: Date.now() }].slice(-80)
            : current.backStack,
          forwardStack: options.pushHistory ? [] : current.forwardStack,
          error: null,
        });

        if (!threadId) {
          return;
        }

        try {
          const result = await roderIpc.readThread(threadId);
          if (!result.thread) {
            throw new Error("roder app-server did not return a thread");
          }
          const thread = normalizeThreadCwd(result.thread, get().status.cwd);
          set((state) => ({
            threadDetails: { ...state.threadDetails, [threadId]: thread },
            messagesByThread: { ...state.messagesByThread, [threadId]: messagesFromThread(thread) },
            threads: upsertThread(state.threads, thread),
            selectedWorkspaceCwd: thread.cwd,
            selectedModel: thread.model || state.selectedModel,
            workspaceRecents: upsertWorkspaceRecent(state.workspaceRecents, thread.cwd),
          }));
        } catch (error) {
          set({ error: (error as Error).message });
        }
      },

      archiveThread: async (threadId) => {
        if (!threadId) {
          return;
        }
        set({ error: null });
        try {
          await roderIpc.archiveThread(threadId);
          const current = get();
          const nextThreads = current.threads.filter((thread) => thread.id !== threadId);
          const nextActiveThreadId = current.activeThreadId === threadId
            ? firstThreadId(nextThreads, "")
            : current.activeThreadId;
          set((state) => {
            const { [threadId]: _archivedDetail, ...threadDetails } = state.threadDetails;
            const { [threadId]: _archivedMessages, ...messagesByThread } = state.messagesByThread;
            return {
              threads: state.threads.filter((thread) => thread.id !== threadId),
              threadDetails,
              messagesByThread,
              activeThreadId: nextActiveThreadId,
              backStack: state.backStack.filter((entry) => entry.threadId !== threadId),
              forwardStack: state.forwardStack.filter((entry) => entry.threadId !== threadId),
            };
          });
          if (current.activeThreadId === threadId && nextActiveThreadId) {
            await get().selectThread(nextActiveThreadId, { pushHistory: false });
          }
        } catch (error) {
          set({ error: (error as Error).message });
        }
      },

      goBack: async () => {
        const state = get();
        const previous = state.backStack.at(-1);
        if (!previous) {
          return;
        }
        set({
          backStack: state.backStack.slice(0, -1),
          forwardStack: [{ threadId: state.activeThreadId, at: Date.now() }, ...state.forwardStack].slice(0, 80),
        });
        await get().selectThread(previous.threadId, { pushHistory: false });
      },

      goForward: async () => {
        const state = get();
        const next = state.forwardStack[0];
        if (!next) {
          return;
        }
        set({
          forwardStack: state.forwardStack.slice(1),
          backStack: [...state.backStack, { threadId: state.activeThreadId, at: Date.now() }].slice(-80),
        });
        await get().selectThread(next.threadId, { pushHistory: false });
      },

      newProject: async () => {
        set({ error: null });
        try {
          const current = get();
          const folder = await roderIpc.openWorkspaceFolder(current.selectedWorkspaceCwd || current.status.cwd);
          if (!folder) {
            return;
          }
          set({ busy: true });
          await startThreadForWorkspace(folder, set, get);
        } catch (error) {
          set({ busy: false, error: (error as Error).message });
        }
      },

      newThread: async () => {
        set({ busy: true, error: null });
        try {
          const cwd = requireAbsoluteCwd(get().selectedWorkspaceCwd || get().status.cwd, get().status.cwd);
          await startThreadForWorkspace(cwd, set, get);
        } catch (error) {
          set({ busy: false, error: (error as Error).message });
        }
      },

      sendPrompt: async (prompt, attachments = []) => {
        const text = prompt.trim();
        if (!text && attachments.length === 0) {
          return;
        }

        let threadId = get().activeThreadId;
        const activeThread = get().threads.find((thread) => thread.id === threadId);
        const activeTurnId = activeTurnIdForThread(activeThread);
        const steering = threadId !== "" && activeTurnId !== "";
        let markedTurnStarting = false;
        set({ busy: true, error: null });

        try {
          if (!threadId) {
            const state = get();
            const cwd = requireAbsoluteCwd(state.selectedWorkspaceCwd || state.status.cwd, state.status.cwd);
            const model = effectiveSelectedModel(state.models, state.visibleModelIds, state.selectedModel);
            const selectedModel = model?.id ?? state.selectedModel;
            const result = await roderIpc.startThread(
              selectedModel,
              cwd,
              model?.modelProvider ?? selectedModelProvider(state.models, selectedModel),
              state.selectedReasoning,
            );
            if (!result.thread) {
              throw new Error("roder app-server did not return a thread");
            }
            const thread = normalizeThreadCwd(result.thread, get().status.cwd);
            threadId = thread.id;
            set((state) => ({
              threads: upsertThread(state.threads, thread),
              activeThreadId: threadId,
              selectedWorkspaceCwd: thread.cwd,
              selectedModel: thread.model || result.model || selectedModel,
              selectedReasoning: normalizeReasoningEffort(result.reasoning || state.selectedReasoning),
              workspaceRecents: upsertWorkspaceRecent(state.workspaceRecents, thread.cwd),
            }));
          }

          set((state) => ({
            messagesByThread: {
              ...state.messagesByThread,
              [threadId]: [
                ...activeMessages(state.messagesByThread, threadId),
                { id: crypto.randomUUID(), threadId, role: "user", text: userMessageText(text, attachments), status: "complete" },
              ],
            },
          }));

          if (steering) {
            await roderIpc.steerTurn(threadId, activeTurnId, text, attachments);
            return;
          }

          markedTurnStarting = true;
          set((state) => ({
            threads: markThreadStatus(state.threads, threadId, { type: "running", activeTurnId: null, activeFlags: [] }),
          }));
          const started = await roderIpc.startTurn(threadId, text, attachments);
          if (started.turnId) {
            set((state) => ({
              threads: markThreadStatus(state.threads, threadId, { type: "running", activeTurnId: started.turnId, activeFlags: [] }),
            }));
          }
        } catch (error) {
          set((state) => ({
            busy: steering ? state.busy : false,
            error: (error as Error).message,
            threads: markedTurnStarting
              ? markThreadStatus(state.threads, threadId, { type: "idle", activeTurnId: null, activeFlags: [] })
              : state.threads,
          }));
        }
      },

      stopTurn: async () => {
        const state = get();
        if (!state.activeThreadId) {
          return;
        }
        const activeThread = state.threads.find((thread) => thread.id === state.activeThreadId);
        try {
          await roderIpc.interruptTurn(state.activeThreadId, activeTurnIdForThread(activeThread) || undefined);
        } catch (error) {
          set({ error: (error as Error).message });
        }
      },

      restart: async () => {
        set({ busy: true, error: null });
        try {
          const status = await roderIpc.restart();
          set({ status, busy: false });
          await get().bootstrap();
        } catch (error) {
          set({ busy: false, error: (error as Error).message });
        }
      },

      setSelectedModel: (selectedModel) => set({ selectedModel }),
      setModelVisibility: (modelId, visible) => set((state) => {
        const currentVisibleIds = visibleModelIdsFor(state.models, state.visibleModelIds);
        const currentVisible = new Set(currentVisibleIds);
        if (visible) {
          currentVisible.add(modelId);
        } else {
          currentVisible.delete(modelId);
        }
        const nextVisibleIds = state.models.map((model) => model.id).filter((id) => currentVisible.has(id));
        if (nextVisibleIds.length === 0) {
          return {};
        }
        const selectedModel = nextVisibleIds.includes(state.selectedModel) ? state.selectedModel : nextVisibleIds[0] ?? state.selectedModel;
        return {
          visibleModelIds: compactVisibleModelIds(state.models, nextVisibleIds),
          selectedModel,
        };
      }),
      resetVisibleModels: () => set({ visibleModelIds: [] }),
      setSelectedReasoning: (selectedReasoning) => set({ selectedReasoning }),
      setSelectedPolicyMode: async (selectedPolicyMode) => {
        const mode = normalizePolicyMode(selectedPolicyMode);
        set({ selectedPolicyMode: mode, error: null });
        try {
          const result = await roderIpc.setThreadMode(mode, "desktop permission selector");
          set({ selectedPolicyMode: normalizePolicyMode(result.mode) });
        } catch (error) {
          set({ error: (error as Error).message });
        }
      },
      setSelectedWorkspaceCwd: (cwd) => set((state) => {
        const selectedWorkspaceCwd = normalizeCwd(cwd, state.status.cwd);
        return {
          selectedWorkspaceCwd,
          workspaceRecents: upsertWorkspaceRecent(state.workspaceRecents, selectedWorkspaceCwd),
        };
      }),
      openWorkspaceFolder: async () => {
        const state = get();
        const folder = await roderIpc.openWorkspaceFolder(state.selectedWorkspaceCwd || state.status.cwd);
        if (folder) {
          get().setSelectedWorkspaceCwd(folder);
        }
      },
      resolveApproval: async (request, approved) => {
        markWaitRequestResolving(set, request.threadId, request.id, true);
        try {
          await roderIpc.resolveApproval({ approvalId: request.approvalId, approved });
        } catch (error) {
          markWaitRequestResolving(set, request.threadId, request.id, false, (error as Error).message);
        }
      },
      resolveUserInput: async (request, answers) => {
        markWaitRequestResolving(set, request.threadId, request.id, true);
        try {
          await roderIpc.resolveUserInput({ requestId: request.requestId, answers });
        } catch (error) {
          markWaitRequestResolving(set, request.threadId, request.id, false, (error as Error).message);
        }
      },
      exitPlan: async (request, approved) => {
        markWaitRequestResolving(set, request.threadId, request.id, true);
        try {
          await roderIpc.exitPlan({ requestId: request.requestId, approved });
        } catch (error) {
          markWaitRequestResolving(set, request.threadId, request.id, false, (error as Error).message);
        }
      },
      applyAppearance: (appearance) => set({ appearance }),
      applyStatus: (status) => set((state) => ({
        status,
        selectedWorkspaceCwd: state.selectedWorkspaceCwd || status.cwd || "",
      })),
      applyStderr: (message) => set((state) => ({ stderr: [message, ...state.stderr].slice(0, 8) })),
      applyNotification: (notification) => set((state) => reduceNotification(state, notification)),
    }),
    {
      name: "roder-desktop-navigation",
      partialize: (state) => ({
        activeThreadId: state.activeThreadId,
        backStack: state.backStack,
        forwardStack: state.forwardStack,
        selectedModel: state.selectedModel,
        visibleModelIds: state.visibleModelIds,
        selectedReasoning: state.selectedReasoning,
        selectedPolicyMode: state.selectedPolicyMode,
        selectedWorkspaceCwd: state.selectedWorkspaceCwd,
        workspaceRecents: state.workspaceRecents,
      }),
    },
  ),
);

type RoderStoreSet = (partial: Partial<RoderStore> | ((state: RoderStore) => Partial<RoderStore>)) => void;

async function startThreadForWorkspace(cwd: string, set: RoderStoreSet, get: () => RoderStore): Promise<void> {
  const state = get();
  const threadCwd = requireAbsoluteCwd(cwd, state.status.cwd);
  const model = effectiveSelectedModel(state.models, state.visibleModelIds, state.selectedModel);
  const selectedModel = model?.id ?? state.selectedModel;
  const result = await roderIpc.startThread(
    selectedModel,
    threadCwd,
    model?.modelProvider ?? selectedModelProvider(state.models, selectedModel),
    state.selectedReasoning,
  );
  if (!result.thread) {
    throw new Error("roder app-server did not return a thread");
  }
  const thread = normalizeThreadCwd(result.thread, get().status.cwd);
  set((state) => ({
    threads: upsertThread(state.threads, thread),
    activeThreadId: thread.id,
    selectedWorkspaceCwd: thread.cwd,
    selectedModel: thread.model || result.model || selectedModel,
    selectedReasoning: normalizeReasoningEffort(result.reasoning || state.selectedReasoning),
    workspaceRecents: upsertWorkspaceRecent(state.workspaceRecents, thread.cwd),
    messagesByThread: { ...state.messagesByThread, [thread.id]: [] },
    backStack: state.activeThreadId ? [...state.backStack, { threadId: state.activeThreadId, at: Date.now() }].slice(-80) : state.backStack,
    forwardStack: [],
    busy: false,
  }));
}

function reduceNotification(state: RoderStore, notification: RoderNotification): Partial<RoderStore> {
  const params = notificationParams(notification);
  const pendingWaitRequestsByThread = reducePendingWaitRequests(state.pendingWaitRequestsByThread, notification, state.activeThreadId);
  const waitPatch = pendingWaitRequestsByThread === state.pendingWaitRequestsByThread ? {} : { pendingWaitRequestsByThread };

  if (notification.method === "thread/started" && isRecord(params.thread)) {
    const thread = normalizeThreadCwd(params.thread as RoderThread, state.status.cwd);
    return {
      ...waitPatch,
      threads: upsertThread(state.threads, thread),
      activeThreadId: state.activeThreadId || thread.id,
      selectedWorkspaceCwd: thread.cwd,
      workspaceRecents: upsertWorkspaceRecent(state.workspaceRecents, thread.cwd),
      messagesByThread: { ...state.messagesByThread, [thread.id]: state.messagesByThread[thread.id] ?? [] },
    };
  }

  if (notification.method === "item/started") {
    const item = isRecord(params.item) ? params.item : {};
    if (!shouldDisplayStartedItem(item)) {
      return waitPatch;
    }
    const threadId = String(params.threadId ?? state.activeThreadId);
    const [message] = messagesFromRoderItem(threadId, String(params.turnId ?? ""), item as RoderItem, "inProgress");
    if (!message || (message.role === "assistant" && !message.text)) {
      return waitPatch;
    }
    const nextMessages = [...activeMessages(state.messagesByThread, threadId)];
    upsertConversationMessage(nextMessages, message);
    return {
      ...waitPatch,
      messagesByThread: {
        ...state.messagesByThread,
        [threadId]: nextMessages,
      },
    };
  }

  if (notification.method === "turn/started") {
    const threadId = String(params.threadId ?? state.activeThreadId);
    const turn = isRecord(params.turn) ? params.turn : {};
    const turnId = String(turn.id ?? "");
    return {
      ...waitPatch,
      activeThreadId: state.activeThreadId || threadId,
      threads: markThreadStatus(state.threads, threadId, { type: "running", activeTurnId: turnId || null, activeFlags: [] }),
      busy: threadId === state.activeThreadId ? true : state.busy,
    };
  }

  if (notification.method === "item/agentMessage/delta") {
    const threadId = String(params.threadId ?? state.activeThreadId);
    const itemId = String(params.itemId ?? "");
    const delta = String(params.delta ?? "");
    const phase = normalizeAssistantPhase(typeof params.phase === "string" ? params.phase : undefined);
    const messageId = assistantMessageId(itemId, phase);
    const nextMessages = [...activeMessages(state.messagesByThread, threadId)];
    const index = nextMessages.findIndex((message) => message.id === messageId);
    if (index === -1) {
      nextMessages.push({
        id: messageId,
        threadId,
        turnId: String(params.turnId ?? ""),
        role: "assistant",
        text: delta,
        phase,
        status: "streaming",
      });
    } else {
      nextMessages[index] = { ...nextMessages[index], text: nextMessages[index].text + delta, status: "streaming", phase };
    }
    return {
      ...waitPatch,
      messagesByThread: {
        ...state.messagesByThread,
        [threadId]: nextMessages,
      },
    };
  }

  if (notification.method === "item/completed") {
    const item = isRecord(params.item) ? params.item : {};
    const threadId = String(params.threadId ?? state.activeThreadId);
    const messages = messagesFromRoderItem(threadId, String(params.turnId ?? ""), item as RoderItem, "completed");
    if (messages.length === 0) {
      return waitPatch;
    }
    const nextMessages = [...activeMessages(state.messagesByThread, threadId)];
    for (const message of messages) {
      upsertConversationMessage(nextMessages, message);
    }
    return {
      ...waitPatch,
      messagesByThread: {
        ...state.messagesByThread,
        [threadId]: nextMessages,
      },
    };
  }

  if (notification.method === "turn/completed") {
    const turn = isRecord(params.turn) ? params.turn : {};
    const threadId = String(params.threadId ?? state.activeThreadId);
    const turnId = String(turn.id ?? "");
    const nextMessages = activeMessages(state.messagesByThread, threadId).map((message) =>
      message.status === "streaming" ? { ...message, status: "complete" as const } : message,
    );
    const failedMessage = turnFailureMessage(threadId, turnId, turn);
    if (failedMessage) {
      upsertConversationMessage(nextMessages, failedMessage);
    }
    return {
      ...waitPatch,
      messagesByThread: {
        ...state.messagesByThread,
        [threadId]: nextMessages,
      },
      threads: markThreadStatus(state.threads, threadId, { type: "idle", activeTurnId: null, activeFlags: [] }),
      busy: threadId === state.activeThreadId ? false : state.busy,
    };
  }

  if (notification.method === "thread/status/changed") {
    const threadId = String(params.threadId ?? "");
    const status = isRecord(params.status) ? (params.status as RoderThread["status"]) : { type: "idle", activeTurnId: null, activeFlags: [] };
    return {
      ...waitPatch,
      threads: markThreadStatus(state.threads, threadId, status),
    };
  }

  return waitPatch;
}

function markWaitRequestResolving(
  set: (partial: Partial<RoderStore> | ((state: RoderStore) => Partial<RoderStore>)) => void,
  threadId: string,
  requestId: string,
  resolving: boolean,
  error?: string,
): void {
  set((state) => ({
    pendingWaitRequestsByThread: setWaitRequestResolving(state.pendingWaitRequestsByThread, threadId, requestId, resolving, error),
  }));
}

function turnFailureMessage(threadId: string, turnId: string, turn: Record<string, unknown>): ConversationMessage | null {
  if (turn.status !== "failed") {
    return null;
  }
  const error = isRecord(turn.error) ? turn.error : {};
  const message = typeof error.message === "string" && error.message.trim() ? error.message.trim() : "The agent turn failed.";
  return {
    id: `turn-error:${turnId || threadId}`,
    threadId,
    turnId,
    role: "system",
    text: message,
    status: "failed",
  };
}

function userMessageText(prompt: string, attachments: DesktopAttachment[]): string {
  const attachmentText = attachments.length > 0 ? `Attached ${attachments.length} file${attachments.length === 1 ? "" : "s"}: ${attachments.map((attachment) => attachment.name).join(", ")}` : "";
  return [prompt, attachmentText].filter(Boolean).join("\n\n");
}

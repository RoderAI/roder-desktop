import { create } from "zustand";
import { persist } from "zustand/middleware";
import { godeIpc } from "@/lib/gode-ipc";
import {
  assistantMessageId,
  messagesFromGodeItem,
  messagesFromThread,
  normalizeAssistantPhase,
  sortThreadsByUpdatedAt,
  upsertConversationMessage,
  upsertThread,
} from "@/lib/gode-thread";
import { compactVisibleModelIds, effectiveSelectedModel, selectedModelProvider, visibleModelIdsFor, visibleModelsFor } from "@/lib/gode-models";
import { normalizeCwd, normalizeThreadCwd, normalizeThreadsCwd, upsertWorkspaceRecent } from "@/lib/gode-workspaces";
import type {
  ConversationMessage,
  DesktopAttachment,
  GodeModel,
  GodeNotification,
  GodeItem,
  GodeStatus,
  GodeThread,
  NavigationEntry,
  ReasoningEffort,
  SystemAppearance,
  WorkspaceFolder,
} from "@/types/gode";

type GodeStore = {
  status: GodeStatus;
  stderr: string[];
  threads: GodeThread[];
  threadDetails: Record<string, GodeThread>;
  messagesByThread: Record<string, ConversationMessage[]>;
  activeThreadId: string;
  backStack: NavigationEntry[];
  forwardStack: NavigationEntry[];
  models: GodeModel[];
  visibleModelIds: string[];
  selectedModel: string;
  selectedReasoning: ReasoningEffort;
  selectedWorkspaceCwd: string;
  workspaceRecents: WorkspaceFolder[];
  appearance: SystemAppearance;
  busy: boolean;
  activeTurnId: string;
  hydrated: boolean;
  error: string | null;
  bootstrap: () => Promise<void>;
  refreshThreads: () => Promise<void>;
  selectThread: (threadId: string, options?: { pushHistory?: boolean }) => Promise<void>;
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  newThread: () => Promise<void>;
  sendPrompt: (prompt: string, attachments?: DesktopAttachment[]) => Promise<void>;
  stopTurn: () => Promise<void>;
  restart: () => Promise<void>;
  setSelectedModel: (model: string) => void;
  setModelVisibility: (modelId: string, visible: boolean) => void;
  resetVisibleModels: () => void;
  cycleSelectedReasoning: () => void;
  setSelectedWorkspaceCwd: (cwd: string) => void;
  openWorkspaceFolder: () => Promise<void>;
  applyAppearance: (appearance: SystemAppearance) => void;
  applyStatus: (status: GodeStatus) => void;
  applyStderr: (message: string) => void;
  applyNotification: (notification: GodeNotification) => void;
};

const initialStatus: GodeStatus = {
  state: "starting",
  binary: "unresolved",
};

const reasoningCycle: ReasoningEffort[] = ["low", "medium", "high", "xhigh"];

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

function nextReasoningEffort(value: ReasoningEffort): ReasoningEffort {
  const index = reasoningCycle.indexOf(value);
  return reasoningCycle[(index + 1) % reasoningCycle.length] ?? "low";
}

function realThreads(threads: GodeThread[]): GodeThread[] {
  return sortThreadsByUpdatedAt(threads.filter((thread) => !thread.id.startsWith("demo-")));
}

function firstThreadId(threads: GodeThread[], fallback: string): string {
  return threads[0]?.id ?? fallback;
}

function activeMessages(messagesByThread: Record<string, ConversationMessage[]>, threadId: string): ConversationMessage[] {
  return messagesByThread[threadId] ?? [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function notificationParams(notification: GodeNotification): Record<string, unknown> {
  return isRecord(notification.params) ? notification.params : {};
}

export const useGodeStore = create<GodeStore>()(
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
      selectedWorkspaceCwd: "",
      workspaceRecents: [],
      appearance: "light",
      busy: false,
      activeTurnId: "",
      hydrated: false,
      error: null,

      bootstrap: async () => {
        set({ busy: true, error: null });
        try {
          const readyStatus = await godeIpc.start();
          const [status, threadResult, modelResult] = await Promise.all([
            godeIpc.status().then((current) => (current.state === "starting" ? readyStatus : current)),
            godeIpc.listThreads(100),
            godeIpc.listModels(),
          ]);

          const threads = realThreads(normalizeThreadsCwd(threadResult.data ?? [], status.cwd));
          const current = get();
          const models = modelResult.models ?? [];
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
        const result = await godeIpc.listThreads(100);
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
          const result = await godeIpc.readThread(threadId);
          if (!result.thread) {
            throw new Error("gode app-server did not return a thread");
          }
          const thread = normalizeThreadCwd(result.thread, get().status.cwd);
          set((state) => ({
            threadDetails: { ...state.threadDetails, [threadId]: thread },
            messagesByThread: { ...state.messagesByThread, [threadId]: messagesFromThread(thread) },
            threads: upsertThread(state.threads, thread),
            selectedWorkspaceCwd: thread.cwd,
            workspaceRecents: upsertWorkspaceRecent(state.workspaceRecents, thread.cwd),
          }));
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

      newThread: async () => {
        set({ busy: true, error: null });
        try {
          const cwd = get().selectedWorkspaceCwd || get().status.cwd;
          const state = get();
          const model = effectiveSelectedModel(state.models, state.visibleModelIds, state.selectedModel);
          const selectedModel = model?.id ?? state.selectedModel;
          const result = await godeIpc.startThread(selectedModel, cwd, model?.modelProvider ?? selectedModelProvider(state.models, selectedModel));
          if (!result.thread) {
            throw new Error("gode app-server did not return a thread");
          }
          const thread = normalizeThreadCwd(result.thread, get().status.cwd);
          set((state) => ({
            threads: upsertThread(state.threads, thread),
            activeThreadId: thread.id,
            selectedWorkspaceCwd: thread.cwd,
            workspaceRecents: upsertWorkspaceRecent(state.workspaceRecents, thread.cwd),
            messagesByThread: { ...state.messagesByThread, [thread.id]: [] },
            backStack: state.activeThreadId ? [...state.backStack, { threadId: state.activeThreadId, at: Date.now() }].slice(-80) : state.backStack,
            forwardStack: [],
            busy: false,
          }));
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
        const steering = get().busy && threadId !== "" && get().activeTurnId !== "";
        set({ busy: true, error: null });

        try {
          if (!threadId) {
            const cwd = get().selectedWorkspaceCwd || get().status.cwd;
            const state = get();
            const model = effectiveSelectedModel(state.models, state.visibleModelIds, state.selectedModel);
            const selectedModel = model?.id ?? state.selectedModel;
            const result = await godeIpc.startThread(selectedModel, cwd, model?.modelProvider ?? selectedModelProvider(state.models, selectedModel));
            if (!result.thread) {
              throw new Error("gode app-server did not return a thread");
            }
            const thread = normalizeThreadCwd(result.thread, get().status.cwd);
            threadId = thread.id;
            set((state) => ({
              threads: upsertThread(state.threads, thread),
              activeThreadId: threadId,
              selectedWorkspaceCwd: thread.cwd,
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
            await godeIpc.steerTurn(threadId, get().activeTurnId, text, attachments);
            return;
          }

          await godeIpc.startTurn(threadId, text, attachments);
        } catch (error) {
          set({ busy: steering ? get().busy : false, error: (error as Error).message });
        }
      },

      stopTurn: async () => {
        const state = get();
        if (!state.activeThreadId || !state.activeTurnId) {
          return;
        }
        try {
          await godeIpc.interruptTurn(state.activeThreadId, state.activeTurnId);
        } catch (error) {
          set({ error: (error as Error).message });
        }
      },

      restart: async () => {
        set({ busy: true, error: null });
        try {
          const status = await godeIpc.restart();
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
      cycleSelectedReasoning: () => set((state) => ({ selectedReasoning: nextReasoningEffort(state.selectedReasoning) })),
      setSelectedWorkspaceCwd: (cwd) => set((state) => {
        const selectedWorkspaceCwd = normalizeCwd(cwd, state.status.cwd);
        return {
          selectedWorkspaceCwd,
          workspaceRecents: upsertWorkspaceRecent(state.workspaceRecents, selectedWorkspaceCwd),
        };
      }),
      openWorkspaceFolder: async () => {
        const state = get();
        const folder = await godeIpc.openWorkspaceFolder(state.selectedWorkspaceCwd || state.status.cwd);
        if (folder) {
          get().setSelectedWorkspaceCwd(folder);
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
      name: "gode-desktop-navigation",
      partialize: (state) => ({
        activeThreadId: state.activeThreadId,
        backStack: state.backStack,
        forwardStack: state.forwardStack,
        selectedModel: state.selectedModel,
        visibleModelIds: state.visibleModelIds,
        selectedReasoning: state.selectedReasoning,
        selectedWorkspaceCwd: state.selectedWorkspaceCwd,
        workspaceRecents: state.workspaceRecents,
      }),
    },
  ),
);

function reduceNotification(state: GodeStore, notification: GodeNotification): Partial<GodeStore> {
  const params = notificationParams(notification);

  if (notification.method === "thread/started" && isRecord(params.thread)) {
    const thread = normalizeThreadCwd(params.thread as GodeThread, state.status.cwd);
    return {
      threads: upsertThread(state.threads, thread),
      activeThreadId: thread.id,
      selectedWorkspaceCwd: thread.cwd,
      workspaceRecents: upsertWorkspaceRecent(state.workspaceRecents, thread.cwd),
      messagesByThread: { ...state.messagesByThread, [thread.id]: state.messagesByThread[thread.id] ?? [] },
    };
  }

  if (notification.method === "item/started") {
    const item = isRecord(params.item) ? params.item : {};
    if (item.type !== "agentMessage" && !String(item.type ?? "").startsWith("tool.")) {
      return {};
    }
    const threadId = String(params.threadId ?? state.activeThreadId);
    const [message] = messagesFromGodeItem(threadId, String(params.turnId ?? ""), item as GodeItem, "inProgress");
    if (!message || (message.role === "assistant" && !message.text)) {
      return {};
    }
    const nextMessages = [...activeMessages(state.messagesByThread, threadId)];
    upsertConversationMessage(nextMessages, message);
    return {
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
      activeThreadId: threadId || state.activeThreadId,
      activeTurnId: turnId || state.activeTurnId,
      busy: true,
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
      messagesByThread: {
        ...state.messagesByThread,
        [threadId]: nextMessages,
      },
    };
  }

  if (notification.method === "item/completed") {
    const item = isRecord(params.item) ? params.item : {};
    const threadId = String(params.threadId ?? state.activeThreadId);
    const messages = messagesFromGodeItem(threadId, String(params.turnId ?? ""), item as GodeItem, "completed");
    if (messages.length === 0) {
      return {};
    }
    const nextMessages = [...activeMessages(state.messagesByThread, threadId)];
    for (const message of messages) {
      upsertConversationMessage(nextMessages, message);
    }
    return {
      messagesByThread: {
        ...state.messagesByThread,
        [threadId]: nextMessages,
      },
    };
  }

  if (notification.method === "turn/completed") {
    const turn = isRecord(params.turn) ? params.turn : {};
    const turnId = String(turn.id ?? "");
    return {
      busy: false,
      activeTurnId: turnId === state.activeTurnId || !turnId ? "" : state.activeTurnId,
    };
  }

  if (notification.method === "thread/status/changed") {
    const threadId = String(params.threadId ?? "");
    const status = isRecord(params.status) ? (params.status as GodeThread["status"]) : { type: "idle" };
    return {
      threads: state.threads.map((thread) => (thread.id === threadId ? { ...thread, status } : thread)),
    };
  }

  return {};
}

function userMessageText(prompt: string, attachments: DesktopAttachment[]): string {
  const attachmentText = attachments.length > 0 ? `Attached ${attachments.length} file${attachments.length === 1 ? "" : "s"}: ${attachments.map((attachment) => attachment.name).join(", ")}` : "";
  return [prompt, attachmentText].filter(Boolean).join("\n\n");
}

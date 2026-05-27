import { create } from "zustand";
import { persist } from "zustand/middleware";
import { roderIpc } from "@/lib/roder-ipc";
import {
  applyThreadItemEvent,
  activeTurnIdForThread,
  markThreadStatus,
  sortThreadsByUpdatedAt,
  upsertThread,
} from "@/lib/roder-thread";
import { reducePendingWaitRequests, setWaitRequestResolving } from "@/lib/roder-wait-requests";
import { compactVisibleModelIds, effectiveSelectedModel, selectedModelProvider, visibleModelIdsFor, visibleModelsFor } from "@/lib/roder-models";
import { normalizeCwd, normalizeThreadCwd, normalizeThreadsCwd, requireAbsoluteCwd, upsertWorkspaceRecent } from "@/lib/roder-workspaces";
import type {
  ApprovalWaitRequest,
  DesktopAttachment,
  PendingWaitRequestsByThread,
  PolicyMode,
  PlanExitWaitRequest,
  RoderModel,
  RoderNotification,
  RoderStatus,
  RoderThread,
  RoderThreadItemEvent,
  RoderTurn,
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
  threadControlsByThread: Record<string, ThreadControlState>;
  activeThreadId: string;
  backStack: NavigationEntry[];
  forwardStack: NavigationEntry[];
  models: RoderModel[];
  visibleModelIds: string[];
  defaultModel: string;
  defaultReasoning: ReasoningEffort;
  defaultPolicyMode: PolicyMode;
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
  setDefaultModel: (model: string) => void;
  setDefaultReasoning: (reasoning: ReasoningEffort) => void;
  setDefaultPolicyMode: (mode: PolicyMode) => void;
  setSelectedModel: (model: string) => void;
  setSelectedReasoning: (reasoning: ReasoningEffort) => void;
  setSelectedPolicyMode: (mode: PolicyMode) => void;
  saveDefaults: () => Promise<void>;
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

type ThreadControlState = {
  model: string;
  reasoning: ReasoningEffort;
  policyMode: PolicyMode;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function notificationParams(notification: RoderNotification): Record<string, unknown> {
  return isRecord(notification.params) ? notification.params : {};
}

function isItemEventNotification(method: string): boolean {
  return method === "item/started"
    || method === "item/completed"
    || method === "item/agentMessage/delta"
    || method === "item/reasoning/textDelta"
    || method === "item/reasoning/summaryPartAdded"
    || method === "item/reasoning/summaryTextDelta";
}

function threadItemEventParam(params: Record<string, unknown>): RoderThreadItemEvent | null {
  if (
    typeof params.seq !== "number"
    || typeof params.eventId !== "string"
    || typeof params.threadId !== "string"
    || typeof params.turnId !== "string"
    || typeof params.timestamp !== "string"
    || !isRecord(params.event)
    || typeof params.event.type !== "string"
  ) {
    return null;
  }
  return params as RoderThreadItemEvent;
}

function threadForState(state: RoderStore, threadId: string): RoderThread | undefined {
  return state.threadDetails[threadId] ?? state.threads.find((thread) => thread.id === threadId);
}

function upsertTurn(thread: RoderThread | undefined, incoming: RoderTurn): RoderThread | undefined {
  if (!thread) {
    return thread;
  }
  const turns = thread.turns ? [...thread.turns] : [];
  const index = turns.findIndex((turn) => turn.id === incoming.id);
  if (index === -1) {
    turns.push(incoming);
  } else {
    turns[index] = { ...turns[index], ...incoming, items: incoming.items.length ? incoming.items : turns[index].items };
  }
  return { ...thread, turns };
}

function completeTurn(thread: RoderThread | undefined, turnId: string, turnPatch: Record<string, unknown>): RoderThread | undefined {
  if (!thread) {
    return thread;
  }
  const turns = thread.turns ? [...thread.turns] : [];
  const index = turns.findIndex((turn) => turn.id === turnId);
  const status = turnStatusParam(turnPatch.status);
  const error = turnErrorParam(turnPatch.error);
  const completedAt = typeof turnPatch.completedAt === "number" ? turnPatch.completedAt : null;
  const durationMs = typeof turnPatch.durationMs === "number" ? turnPatch.durationMs : null;
  const nextStatus = status === "failed" ? "failed" : "completed";
  const existing = index === -1
    ? {
        id: turnId,
        items: [],
        itemsView: "default",
        status: nextStatus,
        error,
        completedAt,
        durationMs,
      }
    : turns[index];
  const nextTurn: RoderTurn = {
    ...existing,
    status: nextStatus,
    error,
    completedAt,
    durationMs,
    items: existing.items.map((item) => item.status === "inProgress" ? { ...item, status: nextStatus } : item),
  };
  if (index === -1) {
    turns.push(nextTurn);
  } else {
    turns[index] = nextTurn;
  }
  return { ...thread, turns };
}

function turnStatusParam(value: unknown): RoderTurn["status"] {
  return value === "failed" ? "failed" : value === "inProgress" ? "inProgress" : "completed";
}

function turnErrorParam(value: unknown): RoderTurn["error"] {
  if (isRecord(value) && typeof value.message === "string") {
    return { message: value.message };
  }
  if (typeof value === "string" && value.trim()) {
    return { message: value };
  }
  return null;
}

function markThreadDetailStatus(
  threadDetails: Record<string, RoderThread>,
  threadId: string,
  status: RoderThread["status"],
): Record<string, RoderThread> {
  const thread = threadDetails[threadId];
  if (!thread) {
    return threadDetails;
  }
  return { ...threadDetails, [threadId]: { ...thread, status } };
}

export const useRoderStore = create<RoderStore>()(
  persist(
    (set, get) => ({
      status: initialStatus,
      stderr: [],
      threads: [],
      threadDetails: {},
      threadControlsByThread: {},
      activeThreadId: "",
      backStack: [],
      forwardStack: [],
      models: [],
      visibleModelIds: [],
      defaultModel: "",
      defaultReasoning: "medium",
      defaultPolicyMode: "accept_all",
      selectedModel: "",
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
          const [status, threadResult, modelResult, settings] = await Promise.all([
            roderIpc.status().then((current) => (current.state === "starting" ? readyStatus : current)),
            roderIpc.listThreads(100),
            roderIpc.listModels(),
            roderIpc.settings(),
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
          const currentSelectedModel = visibleModels.some((model) => model.id === settings.default_model)
            ? settings.default_model
            : visibleModels.find((model) => model.isDefault)?.id || visibleModels[0]?.id || settings.default_model;
          const defaultPolicyMode = normalizePolicyMode(settings.default_mode);
          const defaultReasoning = normalizeReasoningEffort(settings.default_reasoning || models.find((model) => model.id === currentSelectedModel)?.defaultReasoningEffort);

          set({
            status,
            threads,
            models,
            visibleModelIds,
            defaultModel: currentSelectedModel,
            defaultReasoning,
            defaultPolicyMode,
            selectedWorkspaceCwd,
            workspaceRecents: upsertWorkspaceRecent(current.workspaceRecents, selectedWorkspaceCwd),
            selectedModel: activeThread?.model || currentSelectedModel,
            selectedReasoning: defaultReasoning,
            selectedPolicyMode: defaultPolicyMode,
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
        if (threadId === current.activeThreadId && current.threadDetails[threadId]) {
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
            threads: upsertThread(state.threads, thread),
            selectedWorkspaceCwd: thread.cwd,
            selectedModel: state.threadControlsByThread[threadId]?.model || thread.model || state.defaultModel,
            selectedReasoning: state.threadControlsByThread[threadId]?.reasoning || state.defaultReasoning,
            selectedPolicyMode: state.threadControlsByThread[threadId]?.policyMode || state.defaultPolicyMode,
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
            return {
              threads: state.threads.filter((thread) => thread.id !== threadId),
              threadDetails,
              threadControlsByThread: removeThreadControls(state.threadControlsByThread, threadId),
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
        const activeThread = get().threadDetails[threadId] ?? get().threads.find((thread) => thread.id === threadId);
        const activeTurnId = activeTurnIdForThread(activeThread);
        const steering = threadId !== "" && activeTurnId !== "";
        let markedTurnStarting = false;
        set({ busy: true, error: null });

        try {
          if (!threadId) {
            const state = get();
            const cwd = requireAbsoluteCwd(state.selectedWorkspaceCwd || state.status.cwd, state.status.cwd);
            const model = effectiveSelectedModel(state.models, state.visibleModelIds, state.defaultModel);
            const selectedModel = model?.id ?? state.defaultModel;
            const result = await roderIpc.startThread(
              selectedModel,
              cwd,
              model?.modelProvider ?? selectedModelProvider(state.models, selectedModel),
              state.defaultReasoning,
            );
            if (!result.thread) {
              throw new Error("roder app-server did not return a thread");
            }
          const thread = normalizeThreadCwd(result.thread, get().status.cwd);
          threadId = thread.id;
          set((state) => ({
            threads: upsertThread(state.threads, thread),
            threadDetails: { ...state.threadDetails, [threadId]: thread },
            activeThreadId: threadId,
            selectedWorkspaceCwd: thread.cwd,
            selectedModel: thread.model || result.model || selectedModel,
            selectedReasoning: normalizeReasoningEffort(result.reasoning || state.defaultReasoning),
            selectedPolicyMode: state.defaultPolicyMode,
            threadControlsByThread: setThreadControls(state.threadControlsByThread, threadId, {
              model: thread.model || result.model || selectedModel,
              reasoning: normalizeReasoningEffort(result.reasoning || state.defaultReasoning),
              policyMode: state.defaultPolicyMode,
            }),
            workspaceRecents: upsertWorkspaceRecent(state.workspaceRecents, thread.cwd),
          }));
          }

          if (steering) {
            await roderIpc.steerTurn(threadId, activeTurnId, text, attachments);
            return;
          }

          markedTurnStarting = true;
          set((state) => ({
            threads: markThreadStatus(state.threads, threadId, { type: "running", activeTurnId: null, activeFlags: [] }),
            threadDetails: markThreadDetailStatus(state.threadDetails, threadId, { type: "running", activeTurnId: null, activeFlags: [] }),
          }));
          const turnState = get();
          const turnModel = effectiveSelectedModel(turnState.models, turnState.visibleModelIds, turnState.selectedModel);
          const selectedTurnModel = turnModel?.id ?? turnState.selectedModel;
          const started = await roderIpc.startTurn(threadId, text, attachments, {
            modelProvider: turnModel?.modelProvider ?? selectedModelProvider(turnState.models, selectedTurnModel),
            model: selectedTurnModel,
            reasoning: turnState.selectedReasoning,
            policyMode: turnState.selectedPolicyMode,
          });
          if (started.turnId) {
            set((state) => ({
              threads: markThreadStatus(state.threads, threadId, { type: "running", activeTurnId: started.turnId, activeFlags: [] }),
              threadDetails: markThreadDetailStatus(state.threadDetails, threadId, { type: "running", activeTurnId: started.turnId, activeFlags: [] }),
            }));
          }
        } catch (error) {
          set((state) => ({
            busy: steering ? state.busy : false,
            error: (error as Error).message,
            threads: markedTurnStarting
              ? markThreadStatus(state.threads, threadId, { type: "idle", activeTurnId: null, activeFlags: [] })
              : state.threads,
            threadDetails: markedTurnStarting
              ? markThreadDetailStatus(state.threadDetails, threadId, { type: "idle", activeTurnId: null, activeFlags: [] })
              : state.threadDetails,
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

      setDefaultModel: (defaultModel) => set({ defaultModel }),
      setDefaultReasoning: (defaultReasoning) => set({ defaultReasoning }),
      setDefaultPolicyMode: (defaultPolicyMode) => {
        const mode = normalizePolicyMode(defaultPolicyMode);
        set({ defaultPolicyMode: mode, error: null });
      },
      setSelectedModel: (selectedModel) => set((state) => ({
        selectedModel,
        threadControlsByThread: updateActiveThreadControls(state, { model: selectedModel }),
      })),
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
      setSelectedReasoning: (selectedReasoning) => set((state) => ({
        selectedReasoning,
        threadControlsByThread: updateActiveThreadControls(state, { reasoning: selectedReasoning }),
      })),
      setSelectedPolicyMode: (selectedPolicyMode) => {
        const mode = normalizePolicyMode(selectedPolicyMode);
        set((state) => ({
          selectedPolicyMode: mode,
          threadControlsByThread: updateActiveThreadControls(state, { policyMode: mode }),
          error: null,
        }));
      },
      saveDefaults: async () => {
        const state = get();
        const model = effectiveSelectedModel(state.models, state.visibleModelIds, state.defaultModel);
        const selectedModel = model?.id ?? state.defaultModel;
        const selectedProvider = model?.modelProvider ?? selectedModelProvider(state.models, selectedModel);
        if (!selectedModel || !selectedProvider) {
          const message = "Select a model before saving defaults";
          set({ error: message });
          throw new Error(message);
        }

        set({ error: null });
        const [selection, mode] = await Promise.all([
          roderIpc.selectProviderDefaults(selectedProvider, selectedModel, state.defaultReasoning),
          roderIpc.setDefaultMode(state.defaultPolicyMode),
        ]);

        set({
          defaultModel: selection.model || selectedModel,
          defaultReasoning: normalizeReasoningEffort(selection.reasoning || state.defaultReasoning),
          defaultPolicyMode: normalizePolicyMode(mode.default_mode || state.defaultPolicyMode),
        });
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
        visibleModelIds: state.visibleModelIds,
        selectedWorkspaceCwd: state.selectedWorkspaceCwd,
        workspaceRecents: state.workspaceRecents,
      }),
    },
  ),
);

type RoderStoreSet = (partial: Partial<RoderStore> | ((state: RoderStore) => Partial<RoderStore>)) => void;

function setThreadControls(
  controlsByThread: Record<string, ThreadControlState>,
  threadId: string,
  controls: ThreadControlState,
): Record<string, ThreadControlState> {
  return {
    ...controlsByThread,
    [threadId]: controls,
  };
}

function updateActiveThreadControls(
  state: RoderStore,
  patch: Partial<ThreadControlState>,
): Record<string, ThreadControlState> {
  if (!state.activeThreadId) {
    return state.threadControlsByThread;
  }
  const currentControls = state.threadControlsByThread[state.activeThreadId] ?? {
    model: state.selectedModel,
    reasoning: state.selectedReasoning,
    policyMode: state.selectedPolicyMode,
  };
  return setThreadControls(state.threadControlsByThread, state.activeThreadId, {
    ...currentControls,
    ...patch,
  });
}

function removeThreadControls(
  controlsByThread: Record<string, ThreadControlState>,
  threadId: string,
): Record<string, ThreadControlState> {
  const { [threadId]: _removed, ...remaining } = controlsByThread;
  return remaining;
}

async function startThreadForWorkspace(cwd: string, set: RoderStoreSet, get: () => RoderStore): Promise<void> {
  const state = get();
  const threadCwd = requireAbsoluteCwd(cwd, state.status.cwd);
  const model = effectiveSelectedModel(state.models, state.visibleModelIds, state.defaultModel);
  const selectedModel = model?.id ?? state.defaultModel;
  const result = await roderIpc.startThread(
    selectedModel,
    threadCwd,
    model?.modelProvider ?? selectedModelProvider(state.models, selectedModel),
    state.defaultReasoning,
  );
  if (!result.thread) {
    throw new Error("roder app-server did not return a thread");
  }
  const thread = normalizeThreadCwd(result.thread, get().status.cwd);
  set((state) => ({
    threads: upsertThread(state.threads, thread),
    threadDetails: { ...state.threadDetails, [thread.id]: thread },
    activeThreadId: thread.id,
    selectedWorkspaceCwd: thread.cwd,
    selectedModel: thread.model || result.model || selectedModel,
    selectedReasoning: normalizeReasoningEffort(result.reasoning || state.defaultReasoning),
    selectedPolicyMode: state.defaultPolicyMode,
    threadControlsByThread: setThreadControls(state.threadControlsByThread, thread.id, {
      model: thread.model || result.model || selectedModel,
      reasoning: normalizeReasoningEffort(result.reasoning || state.defaultReasoning),
      policyMode: state.defaultPolicyMode,
    }),
    workspaceRecents: upsertWorkspaceRecent(state.workspaceRecents, thread.cwd),
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
      threadDetails: { ...state.threadDetails, [thread.id]: state.threadDetails[thread.id] ?? thread },
      activeThreadId: state.activeThreadId || thread.id,
      selectedWorkspaceCwd: thread.cwd,
      workspaceRecents: upsertWorkspaceRecent(state.workspaceRecents, thread.cwd),
    };
  }

  if (notification.method === "turn/started") {
    const threadId = String(params.threadId ?? state.activeThreadId);
    const turn = isRecord(params.turn) ? params.turn : {};
    const turnId = String(turn.id ?? "");
    const nextThread = upsertTurn(threadForState(state, threadId), {
      id: turnId,
      items: [],
      itemsView: String(turn.itemsView ?? "default"),
      status: "inProgress",
      error: null,
      startedAt: typeof turn.startedAt === "number" ? turn.startedAt : null,
      completedAt: null,
      durationMs: null,
    });
    return {
      ...waitPatch,
      activeThreadId: state.activeThreadId || threadId,
      threads: markThreadStatus(state.threads, threadId, { type: "running", activeTurnId: turnId || null, activeFlags: [] }),
      threadDetails: nextThread ? { ...state.threadDetails, [threadId]: nextThread } : state.threadDetails,
      busy: threadId === state.activeThreadId ? true : state.busy,
    };
  }

  if (isItemEventNotification(notification.method)) {
    const itemEvent = threadItemEventParam(params);
    if (!itemEvent) {
      return waitPatch;
    }
    const thread = applyThreadItemEvent(threadForState(state, itemEvent.threadId), itemEvent);
    if (!thread) {
      return waitPatch;
    }
    return {
      ...waitPatch,
      threadDetails: { ...state.threadDetails, [itemEvent.threadId]: thread },
    };
  }

  if (notification.method === "turn/completed") {
    const turn = isRecord(params.turn) ? params.turn : {};
    const threadId = String(params.threadId ?? state.activeThreadId);
    const turnId = String(turn.id ?? "");
    const nextThread = completeTurn(threadForState(state, threadId), turnId, turn);
    return {
      ...waitPatch,
      threadDetails: nextThread ? { ...state.threadDetails, [threadId]: nextThread } : state.threadDetails,
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
      threadDetails: markThreadDetailStatus(state.threadDetails, threadId, status),
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

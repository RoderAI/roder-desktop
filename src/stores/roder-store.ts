import { create } from "zustand";
import { persist } from "zustand/middleware";
import { roderIpc } from "@/lib/roder-ipc";
import { commandInvocationText, type CommandInvocation } from "@/lib/roder-commands";
import {
  applyThreadItemEvent,
  activeTurnIdForThread,
  isThreadRunning,
  markThreadStatus,
  patchThread,
  sortThreadsByUpdatedAt,
  upsertThread,
} from "@/lib/roder-thread";
import { reducePendingWaitRequests, setWaitRequestResolving } from "@/lib/roder-wait-requests";
import {
  compactVisibleModelIds,
  effectiveSelectedModel,
  selectedModelProvider,
  visibleModelIdsFor,
  visibleModelsFor,
} from "@/lib/roder-models";
import {
  normalizeCwd,
  normalizeThreadCwd,
  normalizeThreadsCwd,
  requireAbsoluteCwd,
  upsertWorkspaceRecent,
} from "@/lib/roder-workspaces";
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
  RoderThreadGoal,
  RoderThreadItemEvent,
  RoderTurn,
  NavigationEntry,
  ReasoningEffort,
  SystemAppearance,
  UserInputWaitRequest,
  Workspace,
  WorkspaceFolder,
  WorkspaceRoot,
} from "@/types/roder";

type RoderStore = {
  status: RoderStatus;
  stderr: string[];
  threads: RoderThread[];
  threadDetails: Record<string, RoderThread>;
  threadGoalsByThread: Record<string, RoderThreadGoal>;
  threadControlsByThread: Record<string, ThreadControlState>;
  hunkRevisionByThread: Record<string, number>;
  activeThreadId: string;
  backStack: NavigationEntry[];
  forwardStack: NavigationEntry[];
  models: RoderModel[];
  visibleModelIds: string[];
  defaultModel: string;
  defaultModelProvider: string;
  defaultReasoning: ReasoningEffort;
  defaultPolicyMode: PolicyMode;
  selectedModel: string;
  selectedModelProvider: string;
  selectedReasoning: ReasoningEffort;
  selectedPolicyMode: PolicyMode;
  workspaces: Workspace[];
  selectedWorkspaceId: string;
  selectedRootId: string;
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
  runCommandInvocation: (invocation: CommandInvocation) => Promise<void>;
  sendPrompt: (prompt: string, attachments?: DesktopAttachment[]) => Promise<void>;
  stopTurn: () => Promise<void>;
  restart: () => Promise<void>;
  setDefaultModel: (model: string, provider?: string) => void;
  setDefaultReasoning: (reasoning: ReasoningEffort) => void;
  setDefaultPolicyMode: (mode: PolicyMode) => void;
  setSelectedModel: (model: string, provider?: string) => void;
  setSelectedReasoning: (reasoning: ReasoningEffort) => void;
  setSelectedPolicyMode: (mode: PolicyMode) => Promise<void>;
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
  modelProvider: string;
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
  return (
    method === "item/started" ||
    method === "item/completed" ||
    method === "item/agentMessage/delta" ||
    method === "item/reasoning/textDelta" ||
    method === "item/reasoning/summaryPartAdded" ||
    method === "item/reasoning/summaryTextDelta"
  );
}

function threadItemEventParam(params: Record<string, unknown>): RoderThreadItemEvent | null {
  if (
    typeof params.seq !== "number" ||
    typeof params.eventId !== "string" ||
    typeof params.threadId !== "string" ||
    typeof params.turnId !== "string" ||
    typeof params.timestamp !== "string" ||
    !isRecord(params.event) ||
    typeof params.event.type !== "string"
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

function completeTurn(
  thread: RoderThread | undefined,
  turnId: string,
  turnPatch: Record<string, unknown>,
): RoderThread | undefined {
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
  const existing =
    index === -1
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
    items: existing.items.map((item) => (item.status === "inProgress" ? { ...item, status: nextStatus } : item)),
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

function patchThreadDetails(
  threadDetails: Record<string, RoderThread>,
  threadId: string,
  patch: Partial<RoderThread>,
): Record<string, RoderThread> {
  const thread = threadDetails[threadId];
  if (!thread) {
    return threadDetails;
  }
  return { ...threadDetails, [threadId]: { ...thread, ...patch } };
}

export const useRoderStore = create<RoderStore>()(
  persist(
    (set, get) => ({
      status: initialStatus,
      stderr: [],
      threads: [],
      threadDetails: {},
      threadGoalsByThread: {},
      threadControlsByThread: {},
      hunkRevisionByThread: {},
      activeThreadId: "",
      backStack: [],
      forwardStack: [],
      models: [],
      visibleModelIds: [],
      defaultModel: "",
      defaultModelProvider: "",
      defaultReasoning: "medium",
      defaultPolicyMode: "accept_all",
      selectedModel: "",
      selectedModelProvider: "",
      selectedReasoning: "medium",
      selectedPolicyMode: "accept_all",
      workspaces: [],
      selectedWorkspaceId: "",
      selectedRootId: "",
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
          const [status, threadResult, modelResult, settings, workspaceResult] = await Promise.all([
            roderIpc.status().then((current) => (current.state === "starting" ? readyStatus : current)),
            roderIpc.listThreads(100),
            roderIpc.listModels(),
            roderIpc.settings(),
            listWorkspacesForBootstrap(),
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
          const workspaces = workspaceResult.workspaces ?? [];
          const workspaceSelection = resolveWorkspaceSelection(workspaces, {
            workspaceId: current.selectedWorkspaceId || activeThread?.workspaceId || "",
            rootId: current.selectedRootId || activeThread?.rootId || "",
            path: current.selectedWorkspaceCwd || activeThread?.cwd || status.cwd || "",
            baseCwd: status.cwd,
          });
          const selectedWorkspaceCwd = workspaceSelection?.root.path
            ? normalizeCwd(workspaceSelection.root.path, status.cwd)
            : normalizeCwd(current.selectedWorkspaceCwd || activeThread?.cwd || status.cwd || "", status.cwd);
          const currentSelectedModelRecord =
            visibleModels.find(
              (model) => model.id === settings.default_model && model.modelProvider === settings.default_provider,
            ) ??
            visibleModels.find((model) => model.isDefault) ??
            visibleModels[0];
          const currentSelectedModel = currentSelectedModelRecord?.id || settings.default_model;
          const currentSelectedModelProvider = currentSelectedModelRecord?.modelProvider || settings.default_provider;
          const defaultPolicyMode = normalizePolicyMode(settings.default_mode);
          const defaultReasoning = normalizeReasoningEffort(
            settings.default_reasoning || currentSelectedModelRecord?.defaultReasoningEffort,
          );

          set({
            status,
            threads,
            models,
            visibleModelIds,
            defaultModel: currentSelectedModel,
            defaultModelProvider: currentSelectedModelProvider,
            defaultReasoning,
            defaultPolicyMode,
            selectedWorkspaceCwd,
            workspaces,
            selectedWorkspaceId: workspaceSelection?.workspace.id ?? "",
            selectedRootId: workspaceSelection?.root.id ?? "",
            workspaceRecents: upsertWorkspaceRecent(current.workspaceRecents, selectedWorkspaceCwd),
            selectedModel: activeThread?.model || currentSelectedModel,
            selectedModelProvider: activeThread?.modelProvider || currentSelectedModelProvider,
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
          await syncThreadGoal(threadId, set);
          return;
        }

        set({
          activeThreadId: threadId,
          backStack:
            options.pushHistory && current.activeThreadId
              ? [...current.backStack, { threadId: current.activeThreadId, at: Date.now() }].slice(-80)
              : current.backStack,
          forwardStack: options.pushHistory ? [] : current.forwardStack,
          error: null,
        });

        if (!threadId) {
          return;
        }

        try {
          const [result, goalResult] = await Promise.all([roderIpc.readThread(threadId), readThreadGoal(threadId)]);
          if (!result.thread) {
            throw new Error("roder app-server did not return a thread");
          }
          const thread = normalizeThreadCwd(result.thread, get().status.cwd);
          set((state) => ({
            selectedModelProvider:
              state.threadControlsByThread[threadId]?.modelProvider ||
              thread.modelProvider ||
              state.defaultModelProvider,
            threadDetails: { ...state.threadDetails, [threadId]: thread },
            threads: upsertThread(state.threads, thread),
            threadGoalsByThread: updateThreadGoal(state.threadGoalsByThread, threadId, goalResult.goal),
            selectedWorkspaceCwd: thread.cwd,
            selectedWorkspaceId: thread.workspaceId ?? state.selectedWorkspaceId,
            selectedRootId: thread.rootId ?? state.selectedRootId,
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
          const nextActiveThreadId =
            current.activeThreadId === threadId ? firstThreadId(nextThreads, "") : current.activeThreadId;
          set((state) => {
            const { [threadId]: _archivedDetail, ...threadDetails } = state.threadDetails;
            const { [threadId]: _archivedGoal, ...threadGoalsByThread } = state.threadGoalsByThread;
            const { [threadId]: _archivedHunkRevision, ...hunkRevisionByThread } = state.hunkRevisionByThread;
            return {
              threads: state.threads.filter((thread) => thread.id !== threadId),
              threadDetails,
              threadGoalsByThread,
              threadControlsByThread: removeThreadControls(state.threadControlsByThread, threadId),
              hunkRevisionByThread,
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
          const created = await roderIpc.createWorkspace({ roots: [{ path: folder }], defaultRootPath: folder });
          set((state) => ({
            workspaces: upsertWorkspace(state.workspaces, created.workspace),
            selectedWorkspaceId: created.workspace.id,
            selectedRootId: created.workspace.defaultRootId,
            selectedWorkspaceCwd: selectedRootForWorkspace(created.workspace)?.path ?? folder,
          }));
          await startThreadForSelection(set, get);
        } catch (error) {
          set({ busy: false, error: (error as Error).message });
        }
      },

      newThread: async () => {
        set({ busy: true, error: null });
        try {
          await startThreadForSelection(set, get);
        } catch (error) {
          set({ busy: false, error: (error as Error).message });
        }
      },

      runCommandInvocation: async (invocation) => {
        const name = invocation.name.trim();
        if (!name) {
          return;
        }

        const initialState = get();
        let threadId = initialState.activeThreadId;
        const activeThread =
          initialState.threadDetails[threadId] ?? initialState.threads.find((thread) => thread.id === threadId);
        let markedTurnStarting = false;

        if (!threadId && initialState.busy) {
          return;
        }
        if (threadId !== "" && isThreadRunning(activeThread)) {
          return;
        }

        set({ busy: true, error: null });

        try {
          const commandText = commandInvocationText({ name, arguments: invocation.arguments });
          if (!threadId) {
            threadId = await createThreadForPrompt(set, get, commandText);
          } else {
            set((state) => patchThreadPreviewFromPrompt(state, threadId, commandText));
          }

          markedTurnStarting = true;
          set((state) => ({
            threads: markThreadStatus(state.threads, threadId, {
              type: "running",
              activeTurnId: null,
              activeFlags: [],
            }),
            threadDetails: markThreadDetailStatus(state.threadDetails, threadId, {
              type: "running",
              activeTurnId: null,
              activeFlags: [],
            }),
          }));

          const commandState = get();
          const thread = threadForState(commandState, threadId);
          const workspace = thread?.cwd || commandState.selectedWorkspaceCwd || commandState.status.cwd || undefined;
          const started = await roderIpc.runCommand({
            threadId,
            name,
            arguments: invocation.arguments,
            workspace,
          });
          if (typeof started.turn_id !== "string" || !started.turn_id) {
            throw new Error("roder app-server did not return a command turn");
          }
          set((state) => ({
            threads: markThreadStatus(state.threads, threadId, {
              type: "running",
              activeTurnId: started.turn_id,
              activeFlags: [],
            }),
            threadDetails: markThreadDetailStatus(state.threadDetails, threadId, {
              type: "running",
              activeTurnId: started.turn_id,
              activeFlags: [],
            }),
          }));
        } catch (error) {
          set((state) => ({
            busy: false,
            error: (error as Error).message,
            threads: markedTurnStarting
              ? markThreadStatus(state.threads, threadId, { type: "idle", activeTurnId: null, activeFlags: [] })
              : state.threads,
            threadDetails: markedTurnStarting
              ? markThreadDetailStatus(state.threadDetails, threadId, {
                  type: "idle",
                  activeTurnId: null,
                  activeFlags: [],
                })
              : state.threadDetails,
          }));
        }
      },

      sendPrompt: async (prompt, attachments = []) => {
        const text = prompt.trim();
        if (!text && attachments.length === 0) {
          return;
        }

        let threadId = get().activeThreadId;
        const activeThread = get().threadDetails[threadId] ?? get().threads.find((thread) => thread.id === threadId);
        let markedTurnStarting = false;

        if (threadId !== "" && isThreadRunning(activeThread)) {
          return;
        }

        set({ busy: true, error: null });

        try {
          if (!threadId) {
            threadId = await createThreadForPrompt(set, get, text);
          } else {
            set((state) => patchThreadPreviewFromPrompt(state, threadId, text));
          }

          markedTurnStarting = true;
          set((state) => ({
            threads: markThreadStatus(state.threads, threadId, {
              type: "running",
              activeTurnId: null,
              activeFlags: [],
            }),
            threadDetails: markThreadDetailStatus(state.threadDetails, threadId, {
              type: "running",
              activeTurnId: null,
              activeFlags: [],
            }),
          }));
          const turnState = get();
          const turnModel = effectiveSelectedModel(
            turnState.models,
            turnState.visibleModelIds,
            turnState.selectedModel,
            turnState.selectedModelProvider,
          );
          const selectedTurnModel = turnModel?.id ?? turnState.selectedModel;
          const started = await roderIpc.startTurn(threadId, text, attachments, {
            modelProvider:
              turnModel?.modelProvider ??
              selectedModelProvider(turnState.models, selectedTurnModel, turnState.selectedModelProvider),
            model: selectedTurnModel,
            reasoning: turnState.selectedReasoning,
            policyMode: turnState.selectedPolicyMode,
          });
          if (started.turnId) {
            set((state) => ({
              threads: markThreadStatus(state.threads, threadId, {
                type: "running",
                activeTurnId: started.turnId,
                activeFlags: [],
              }),
              threadDetails: markThreadDetailStatus(state.threadDetails, threadId, {
                type: "running",
                activeTurnId: started.turnId,
                activeFlags: [],
              }),
            }));
          }
        } catch (error) {
          set((state) => ({
            busy: false,
            error: (error as Error).message,
            threads: markedTurnStarting
              ? markThreadStatus(state.threads, threadId, { type: "idle", activeTurnId: null, activeFlags: [] })
              : state.threads,
            threadDetails: markedTurnStarting
              ? markThreadDetailStatus(state.threadDetails, threadId, {
                  type: "idle",
                  activeTurnId: null,
                  activeFlags: [],
                })
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

      setDefaultModel: (defaultModel, defaultModelProvider) =>
        set((state) => ({
          defaultModel,
          defaultModelProvider:
            defaultModelProvider ??
            selectedModelProvider(state.models, defaultModel, state.defaultModelProvider) ??
            state.defaultModelProvider,
        })),
      setDefaultReasoning: (defaultReasoning) => set({ defaultReasoning }),
      setDefaultPolicyMode: (defaultPolicyMode) => {
        const mode = normalizePolicyMode(defaultPolicyMode);
        set({ defaultPolicyMode: mode, error: null });
      },
      setSelectedModel: (selectedModel, selectedModelProviderOverride) =>
        set((state) => ({
          selectedModel,
          selectedModelProvider:
            selectedModelProviderOverride ??
            selectedModelProvider(state.models, selectedModel, state.selectedModelProvider) ??
            state.selectedModelProvider,
          threadControlsByThread: updateActiveThreadControls(state, {
            model: selectedModel,
            modelProvider:
              selectedModelProviderOverride ??
              selectedModelProvider(state.models, selectedModel, state.selectedModelProvider) ??
              state.selectedModelProvider,
          }),
        })),
      setModelVisibility: (modelId, visible) =>
        set((state) => {
          const currentVisibleIds = visibleModelIdsFor(state.models, state.visibleModelIds);
          const currentVisible = new Set(currentVisibleIds);
          if (visible) {
            currentVisible.add(modelId);
          } else {
            currentVisible.delete(modelId);
          }
          const nextVisibleIds = state.models.flatMap((model) => (currentVisible.has(model.id) ? [model.id] : []));
          if (nextVisibleIds.length === 0) {
            return {};
          }
          const selectedModel = nextVisibleIds.includes(state.selectedModel)
            ? state.selectedModel
            : (nextVisibleIds[0] ?? state.selectedModel);
          const selectedModelProviderValue =
            selectedModel === state.selectedModel
              ? state.selectedModelProvider
              : (selectedModelProvider(state.models, selectedModel, state.selectedModelProvider) ??
                state.selectedModelProvider);
          return {
            visibleModelIds: compactVisibleModelIds(state.models, nextVisibleIds),
            selectedModel,
            selectedModelProvider: selectedModelProviderValue,
          };
        }),
      resetVisibleModels: () => set({ visibleModelIds: [] }),
      setSelectedReasoning: (selectedReasoning) =>
        set((state) => ({
          selectedReasoning,
          threadControlsByThread: updateActiveThreadControls(state, { reasoning: selectedReasoning }),
        })),
      setSelectedPolicyMode: async (selectedPolicyMode) => {
        const mode = normalizePolicyMode(selectedPolicyMode);
        const previousMode = get().selectedPolicyMode;
        set((state) => ({
          selectedPolicyMode: mode,
          threadControlsByThread: updateActiveThreadControls(state, { policyMode: mode }),
          error: null,
        }));
        if (mode === previousMode) {
          return;
        }
        try {
          const result = await roderIpc.setThreadMode(mode, "desktop permission selector");
          const appliedMode = normalizePolicyMode(result.mode || mode);
          set((state) => ({
            selectedPolicyMode: appliedMode,
            threadControlsByThread: updateActiveThreadControls(state, { policyMode: appliedMode }),
            error: null,
          }));
        } catch (error) {
          set({ error: (error as Error).message });
          throw error;
        }
      },
      saveDefaults: async () => {
        const state = get();
        const model = effectiveSelectedModel(
          state.models,
          state.visibleModelIds,
          state.defaultModel,
          state.defaultModelProvider,
        );
        const selectedModel = model?.id ?? state.defaultModel;
        const selectedProvider =
          model?.modelProvider ?? selectedModelProvider(state.models, selectedModel, state.defaultModelProvider);
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
          defaultModelProvider: selection.provider || selectedProvider,
          defaultReasoning: normalizeReasoningEffort(selection.reasoning || state.defaultReasoning),
          defaultPolicyMode: normalizePolicyMode(mode.default_mode || state.defaultPolicyMode),
        });
      },
      setSelectedWorkspaceCwd: (cwd) =>
        set((state) => {
          const selectedWorkspaceCwd = normalizeCwd(cwd, state.status.cwd);
          const selection = resolveWorkspaceSelection(state.workspaces, {
            path: selectedWorkspaceCwd,
            baseCwd: state.status.cwd,
          });
          return {
            selectedWorkspaceCwd,
            selectedWorkspaceId: selection?.workspace.id ?? "",
            selectedRootId: selection?.root.id ?? "",
            workspaceRecents: upsertWorkspaceRecent(state.workspaceRecents, selectedWorkspaceCwd),
          };
        }),
      openWorkspaceFolder: async () => {
        const state = get();
        const folder = await roderIpc.openWorkspaceFolder(state.selectedWorkspaceCwd || state.status.cwd);
        if (folder) {
          const created = await roderIpc.createWorkspace({ roots: [{ path: folder }], defaultRootPath: folder });
          set((state) => ({
            workspaces: upsertWorkspace(state.workspaces, created.workspace),
            selectedWorkspaceId: created.workspace.id,
            selectedRootId: created.workspace.defaultRootId,
            selectedWorkspaceCwd: selectedRootForWorkspace(created.workspace)?.path ?? folder,
          }));
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
      applyStatus: (status) =>
        set((state) => ({
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
        workspaces: state.workspaces,
        selectedWorkspaceId: state.selectedWorkspaceId,
        selectedRootId: state.selectedRootId,
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
    modelProvider: state.selectedModelProvider,
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

async function readThreadGoal(threadId: string): Promise<{ goal: RoderThreadGoal | null | undefined }> {
  try {
    const result = await roderIpc.threadGoal(threadId);
    if (result.goal && result.goal.threadId !== threadId) {
      return { goal: null };
    }
    return { goal: result.goal };
  } catch {
    return { goal: undefined };
  }
}

async function syncThreadGoal(threadId: string, set: RoderStoreSet): Promise<void> {
  if (!threadId) {
    return;
  }
  const result = await readThreadGoal(threadId);
  set((state) => ({
    threadGoalsByThread: updateThreadGoal(state.threadGoalsByThread, threadId, result.goal),
  }));
}

function updateThreadGoal(
  goalsByThread: Record<string, RoderThreadGoal>,
  threadId: string,
  goal: RoderThreadGoal | null | undefined,
): Record<string, RoderThreadGoal> {
  if (goal === undefined) {
    return goalsByThread;
  }
  if (goal === null) {
    return removeThreadGoal(goalsByThread, threadId);
  }
  if (goal.threadId !== threadId) {
    return removeThreadGoal(goalsByThread, threadId);
  }
  if (!isVisibleThreadGoal(goal)) {
    return removeThreadGoal(goalsByThread, threadId);
  }
  return {
    ...goalsByThread,
    [threadId]: goal,
  };
}

function removeThreadGoal(
  goalsByThread: Record<string, RoderThreadGoal>,
  threadId: string,
): Record<string, RoderThreadGoal> {
  if (!goalsByThread[threadId]) {
    return goalsByThread;
  }
  const { [threadId]: _removed, ...remaining } = goalsByThread;
  return remaining;
}

function roderThreadGoalParam(value: unknown): RoderThreadGoal | null {
  if (!isRecord(value) || typeof value.threadId !== "string" || typeof value.objective !== "string") {
    return null;
  }
  return value as RoderThreadGoal;
}

function isVisibleThreadGoal(goal: RoderThreadGoal): boolean {
  return (
    goal.status === "active" ||
    goal.status === "paused" ||
    goal.status === "blocked" ||
    goal.status === "usageLimited" ||
    goal.status === "budgetLimited"
  );
}

async function listWorkspacesForBootstrap(): Promise<{ workspaces: Workspace[] }> {
  try {
    return await roderIpc.listWorkspaces();
  } catch {
    return { workspaces: [] };
  }
}

async function startThreadForSelection(set: RoderStoreSet, get: () => RoderStore): Promise<void> {
  await createThreadForPrompt(set, get, undefined, { recordHistory: true, clearBusy: true });
}

async function createThreadForPrompt(
  set: RoderStoreSet,
  get: () => RoderStore,
  initialPrompt?: string,
  options: { recordHistory?: boolean; clearBusy?: boolean } = {},
): Promise<string> {
  const state = get();
  const workspaceSelection = await ensureWorkspaceSelection(state, set);
  const latestState = get();
  const model = effectiveSelectedModel(
    latestState.models,
    latestState.visibleModelIds,
    latestState.defaultModel,
    latestState.defaultModelProvider,
  );
  const selectedModel = model?.id ?? latestState.defaultModel;
  const selectedProvider =
    model?.modelProvider ?? selectedModelProvider(latestState.models, selectedModel, latestState.defaultModelProvider);
  const result = await roderIpc.startThread(
    selectedModel,
    threadStartWorkspace(workspaceSelection),
    selectedProvider,
    latestState.defaultReasoning,
    initialPrompt === undefined ? undefined : { initialPrompt },
  );
  if (!result.thread) {
    throw new Error("roder app-server did not return a thread");
  }
  const thread = normalizeThreadCwd(result.thread, get().status.cwd);
  const threadWithPreview = initialPrompt ? threadWithPromptPreview(thread, initialPrompt) : thread;
  set((state) => ({
    threads: upsertThread(state.threads, threadWithPreview),
    threadDetails: { ...state.threadDetails, [threadWithPreview.id]: threadWithPreview },
    threadGoalsByThread: removeThreadGoal(state.threadGoalsByThread, threadWithPreview.id),
    activeThreadId: threadWithPreview.id,
    selectedWorkspaceCwd: threadWithPreview.cwd,
    selectedWorkspaceId: threadWithPreview.workspaceId ?? workspaceSelection.workspace.id,
    selectedRootId: threadWithPreview.rootId ?? workspaceSelection.root.id,
    selectedModel: threadWithPreview.model || result.model || selectedModel,
    selectedModelProvider: threadWithPreview.modelProvider || selectedProvider || state.defaultModelProvider,
    selectedReasoning: normalizeReasoningEffort(result.reasoning || state.defaultReasoning),
    selectedPolicyMode: state.defaultPolicyMode,
    threadControlsByThread: setThreadControls(state.threadControlsByThread, threadWithPreview.id, {
      model: threadWithPreview.model || result.model || selectedModel,
      modelProvider: threadWithPreview.modelProvider || selectedProvider || state.defaultModelProvider,
      reasoning: normalizeReasoningEffort(result.reasoning || state.defaultReasoning),
      policyMode: state.defaultPolicyMode,
    }),
    workspaceRecents: upsertWorkspaceRecent(state.workspaceRecents, threadWithPreview.cwd),
    backStack:
      options.recordHistory && state.activeThreadId
        ? [...state.backStack, { threadId: state.activeThreadId, at: Date.now() }].slice(-80)
        : state.backStack,
    forwardStack: options.recordHistory ? [] : state.forwardStack,
    busy: options.clearBusy ? false : state.busy,
  }));
  return threadWithPreview.id;
}

type WorkspaceSelection = {
  workspace: Workspace;
  root: WorkspaceRoot;
};

async function ensureWorkspaceSelection(state: RoderStore, set: RoderStoreSet): Promise<WorkspaceSelection> {
  const existing = resolveWorkspaceSelection(state.workspaces, {
    workspaceId: state.selectedWorkspaceId,
    rootId: state.selectedRootId,
    path: state.selectedWorkspaceCwd || state.status.cwd || "",
    baseCwd: state.status.cwd,
  });
  if (existing) {
    return existing;
  }

  const cwd = requireAbsoluteCwd(state.selectedWorkspaceCwd || state.status.cwd, state.status.cwd);
  const created = await roderIpc.createWorkspace({ roots: [{ path: cwd }], defaultRootPath: cwd });
  const root = selectedRootForWorkspace(created.workspace);
  if (!root) {
    throw new Error("roder app-server did not return a workspace root");
  }
  set((state) => ({
    workspaces: upsertWorkspace(state.workspaces, created.workspace),
    selectedWorkspaceId: created.workspace.id,
    selectedRootId: root.id,
    selectedWorkspaceCwd: root.path,
  }));
  return { workspace: created.workspace, root };
}

function threadStartWorkspace(selection: WorkspaceSelection): { workspaceId: string; rootId: string; cwd?: string } {
  return {
    workspaceId: selection.workspace.id,
    rootId: selection.root.id,
    cwd: selection.root.path,
  };
}

function resolveWorkspaceSelection(
  workspaces: Workspace[],
  params: { workspaceId?: string | null; rootId?: string | null; path?: string; baseCwd?: string },
): WorkspaceSelection | null {
  const workspaceById = params.workspaceId ? workspaces.find((workspace) => workspace.id === params.workspaceId) : null;
  const rootFromWorkspace = workspaceById ? rootForWorkspace(workspaceById, params.rootId || undefined) : null;
  if (workspaceById && rootFromWorkspace) {
    return { workspace: workspaceById, root: rootFromWorkspace };
  }

  const path = normalizeCwd(params.path || "", params.baseCwd).replace(/\/+$/, "");
  if (path) {
    const rootByPath = new Map<string, { workspace: Workspace; root: WorkspaceRoot }>();
    for (const workspace of workspaces) {
      for (const root of workspace.roots) {
        rootByPath.set(root.path.replace(/\/+$/, ""), { workspace, root });
      }
    }
    const match = rootByPath.get(path);
    if (match) {
      return match;
    }
  }

  return null;
}

function upsertWorkspace(workspaces: Workspace[], workspace: Workspace): Workspace[] {
  return [workspace, ...workspaces.filter((candidate) => candidate.id !== workspace.id)].sort(
    (left, right) => normalizedWorkspaceTimestamp(right.updatedAt) - normalizedWorkspaceTimestamp(left.updatedAt),
  );
}

function selectedRootForWorkspace(workspace: Workspace): WorkspaceRoot | null {
  return rootForWorkspace(workspace, workspace.defaultRootId);
}

function rootForWorkspace(workspace: Workspace, rootId?: string): WorkspaceRoot | null {
  if (rootId) {
    return workspace.roots.find((root) => root.id === rootId) ?? null;
  }
  return workspace.roots[0] ?? null;
}

function patchThreadPreviewFromPrompt(state: RoderStore, threadId: string, prompt: string): Partial<RoderStore> {
  const thread = threadForState(state, threadId);
  if (!thread || !isUntitledThread(thread)) {
    return {};
  }
  const preview = optimisticThreadPreview(prompt);
  if (!preview) {
    return {};
  }
  return {
    threads: patchThread(state.threads, threadId, { name: preview, preview }),
    threadDetails: patchThreadDetails(state.threadDetails, threadId, { name: preview, preview }),
  };
}

function threadWithPromptPreview(thread: RoderThread, prompt: string): RoderThread {
  if (!isUntitledThread(thread)) {
    return thread;
  }
  const preview = optimisticThreadPreview(prompt);
  return preview ? { ...thread, name: preview, preview } : thread;
}

function preserveOptimisticThreadTitle(incoming: RoderThread, existing: RoderThread | undefined): RoderThread {
  if (!existing || isUntitledThread(existing) || !isUntitledThread(incoming)) {
    return incoming;
  }
  return {
    ...incoming,
    name: existing.name ?? existing.preview,
    preview: existing.preview,
  };
}

function isUntitledThread(thread: RoderThread): boolean {
  const label = (thread.name ?? thread.preview).trim().toLowerCase();
  return !label || label === "untitled thread" || label === "untitled agent";
}

function optimisticThreadPreview(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length <= 80) {
    return normalized;
  }
  return `${normalized.slice(0, 77).trimEnd()}...`;
}

function normalizedWorkspaceTimestamp(timestamp: number): number {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 0;
  }
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

function reduceNotification(state: RoderStore, notification: RoderNotification): Partial<RoderStore> {
  const params = notificationParams(notification);
  const pendingWaitRequestsByThread = reducePendingWaitRequests(
    state.pendingWaitRequestsByThread,
    notification,
    state.activeThreadId,
  );
  const waitPatch =
    pendingWaitRequestsByThread === state.pendingWaitRequestsByThread ? {} : { pendingWaitRequestsByThread };

  if (notification.method === "thread/started" && isRecord(params.thread)) {
    const normalizedThread = normalizeThreadCwd(params.thread as RoderThread, state.status.cwd);
    const thread = preserveOptimisticThreadTitle(normalizedThread, threadForState(state, normalizedThread.id));
    return {
      ...waitPatch,
      threads: upsertThread(state.threads, thread),
      threadDetails: { ...state.threadDetails, [thread.id]: state.threadDetails[thread.id] ?? thread },
      threadGoalsByThread: removeThreadGoal(state.threadGoalsByThread, thread.id),
      activeThreadId: state.activeThreadId || thread.id,
      selectedWorkspaceCwd: thread.cwd,
      selectedWorkspaceId: thread.workspaceId ?? state.selectedWorkspaceId,
      selectedRootId: thread.rootId ?? state.selectedRootId,
      workspaceRecents: upsertWorkspaceRecent(state.workspaceRecents, thread.cwd),
    };
  }

  if (
    (notification.method === "thread/updated" || notification.method === "thread/renamed") &&
    isRecord(params.thread)
  ) {
    const normalizedThread = normalizeThreadCwd(params.thread as RoderThread, state.status.cwd);
    const thread = preserveOptimisticThreadTitle(normalizedThread, threadForState(state, normalizedThread.id));
    return {
      ...waitPatch,
      threads: upsertThread(state.threads, thread),
      threadDetails: { ...state.threadDetails, [thread.id]: thread },
      selectedWorkspaceCwd: thread.id === state.activeThreadId ? thread.cwd : state.selectedWorkspaceCwd,
      selectedWorkspaceId:
        thread.id === state.activeThreadId
          ? (thread.workspaceId ?? state.selectedWorkspaceId)
          : state.selectedWorkspaceId,
      selectedRootId:
        thread.id === state.activeThreadId ? (thread.rootId ?? state.selectedRootId) : state.selectedRootId,
      workspaceRecents: upsertWorkspaceRecent(state.workspaceRecents, thread.cwd),
    };
  }

  if (notification.method === "thread/updated" || notification.method === "thread/renamed") {
    const threadId = String(params.threadId ?? "");
    const patch: Partial<RoderThread> = {};
    if ("name" in params && (typeof params.name === "string" || params.name === null)) {
      patch.name = params.name;
    }
    if (typeof params.preview === "string") {
      patch.preview = params.preview;
    }
    if (typeof params.updatedAt === "number") {
      patch.updatedAt = params.updatedAt;
    }
    if (!threadId || Object.keys(patch).length === 0) {
      return waitPatch;
    }
    return {
      ...waitPatch,
      threads: patchThread(state.threads, threadId, patch),
      threadDetails: patchThreadDetails(state.threadDetails, threadId, patch),
    };
  }

  if (notification.method === "thread/goal/updated") {
    const threadId = String(params.threadId ?? "");
    const goal = roderThreadGoalParam(params.goal);
    if (!threadId || !goal || goal.threadId !== threadId) {
      return waitPatch;
    }
    return {
      ...waitPatch,
      threadGoalsByThread: updateThreadGoal(state.threadGoalsByThread, threadId, goal),
    };
  }

  if (notification.method === "thread/goal/cleared") {
    const threadId = String(params.threadId ?? "");
    if (!threadId) {
      return waitPatch;
    }
    return {
      ...waitPatch,
      threadGoalsByThread: removeThreadGoal(state.threadGoalsByThread, threadId),
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
      threads: markThreadStatus(state.threads, threadId, {
        type: "running",
        activeTurnId: turnId || null,
        activeFlags: [],
      }),
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

  if (notification.method === "hunk/recorded" || notification.method === "workspace/changeObserved") {
    const payload =
      notification.method === "hunk/recorded"
        ? isRecord(params.hunk)
          ? params.hunk
          : {}
        : isRecord(params.change)
          ? params.change
          : {};
    const threadId = typeof payload.threadId === "string" ? payload.threadId : "";
    if (!threadId) {
      return waitPatch;
    }
    return {
      ...waitPatch,
      hunkRevisionByThread: {
        ...state.hunkRevisionByThread,
        [threadId]: (state.hunkRevisionByThread[threadId] ?? 0) + 1,
      },
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
    const status = isRecord(params.status)
      ? (params.status as RoderThread["status"])
      : { type: "idle", activeTurnId: null, activeFlags: [] };
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
    pendingWaitRequestsByThread: setWaitRequestResolving(
      state.pendingWaitRequestsByThread,
      threadId,
      requestId,
      resolving,
      error,
    ),
  }));
}

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
  modelVisibilityKey,
  selectedModelRecord,
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
  InferenceRoutingOptionDescriptor,
  ModelSelectChoice,
  ModelSelectionMode,
  ReasoningEffort,
  SystemAppearance,
  UserInputWaitRequest,
  Workspace,
  WorkspaceFolder,
  WorkspaceRoot,
} from "@/types/roder";
import type { WorkspaceCreateParams } from "@/lib/roder-ipc";

type RoderStore = {
  status: RoderStatus;
  stderr: string[];
  threads: RoderThread[];
  threadDetails: Record<string, RoderThread>;
  nextThreadCursor: string | null;
  loadingMoreThreads: boolean;
  threadGoalsByThread: Record<string, RoderThreadGoal>;
  threadControlsByThread: Record<string, ThreadControlState>;
  hunkRevisionByThread: Record<string, number>;
  activeThreadId: string;
  backStack: NavigationEntry[];
  forwardStack: NavigationEntry[];
  models: RoderModel[];
  routingOptions: InferenceRoutingOptionDescriptor[];
  visibleModelIds: string[];
  defaultModel: string;
  defaultModelProvider: string;
  defaultSelectionMode: ModelSelectionMode;
  defaultReasoning: ReasoningEffort;
  defaultPolicyMode: PolicyMode;
  selectedModel: string;
  selectedModelProvider: string;
  selectedSelectionMode: ModelSelectionMode;
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
  loadMoreThreads: () => Promise<void>;
  selectThread: (threadId: string, options?: { pushHistory?: boolean; deferRead?: boolean }) => Promise<void>;
  archiveThread: (threadId: string) => Promise<void>;
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  newProject: (params?: WorkspaceCreateParams) => Promise<void>;
  newThread: () => Promise<void>;
  runCommandInvocation: (invocation: CommandInvocation) => Promise<void>;
  sendPrompt: (prompt: string, attachments?: DesktopAttachment[]) => Promise<void>;
  stopTurn: () => Promise<void>;
  restart: () => Promise<void>;
  setDefaultModel: (model: string, provider?: string) => void;
  setDefaultAutoModel: (optionId: string) => void;
  setDefaultReasoning: (reasoning: ReasoningEffort) => void;
  setDefaultPolicyMode: (mode: PolicyMode) => void;
  setSelectedModel: (model: string, provider?: string) => Promise<void>;
  setSelectedAutoModel: (optionId: string) => Promise<void>;
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
  selectionMode: ModelSelectionMode;
};

const initialStatus: RoderStatus = {
  state: "starting",
  binary: "unresolved",
};

const initialManualSelection: ModelSelectionMode = {
  type: "manual",
  provider: "",
  model: "",
  reasoning: "medium",
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

function selectedThreadWorkspacePatch(state: RoderStore, thread: RoderThread | undefined): Partial<RoderStore> {
  if (!thread) {
    return {};
  }
  const workspaceSelection = resolveWorkspaceSelection(state.workspaces, {
    workspaceId: thread.workspaceId,
    rootId: thread.rootId,
    path: thread.cwd,
    baseCwd: state.status.cwd,
  });
  const selectedWorkspaceCwd = normalizeCwd(thread.cwd || workspaceSelection?.root.path || "", state.status.cwd);
  const selectedWorkspaceId = thread.workspaceId ?? workspaceSelection?.workspace.id ?? state.selectedWorkspaceId;
  const selectedRootId = thread.rootId ?? workspaceSelection?.root.id ?? state.selectedRootId;

  return {
    selectedWorkspaceCwd: selectedWorkspaceCwd || state.selectedWorkspaceCwd,
    selectedWorkspaceId,
    selectedRootId,
    ...(selectedWorkspaceCwd
      ? { workspaceRecents: upsertWorkspaceRecent(state.workspaceRecents, selectedWorkspaceCwd) }
      : {}),
  };
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
      nextThreadCursor: null,
      loadingMoreThreads: false,
      threadGoalsByThread: {},
      threadControlsByThread: {},
      hunkRevisionByThread: {},
      activeThreadId: "",
      backStack: [],
      forwardStack: [],
      models: [],
      routingOptions: [],
      visibleModelIds: [],
      defaultModel: "",
      defaultModelProvider: "",
      defaultSelectionMode: initialManualSelection,
      defaultReasoning: "medium",
      defaultPolicyMode: "accept_all",
      selectedModel: "",
      selectedModelProvider: "",
      selectedSelectionMode: initialManualSelection,
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
          const [status, threadResult, modelResult, providerResult, settings, workspaceResult] = await Promise.all([
            roderIpc.status().then((current) => (current.state === "starting" ? readyStatus : current)),
            roderIpc.listThreads(50),
            roderIpc.listModels(),
            listProvidersForBootstrap(),
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
          const providerSelectionMode =
            providerResult.selectionMode ??
            manualSelection(
              currentSelectedModelProvider,
              currentSelectedModel,
              providerResult.active_reasoning || settings.default_reasoning,
            );
          const activeSelectionMode = activeThread?.selectionMode ?? providerSelectionMode;

          set({
            status,
            threads,
            nextThreadCursor: threadResult.nextCursor ?? null,
            loadingMoreThreads: false,
            models,
            routingOptions: providerResult.routingOptions ?? [],
            visibleModelIds,
            defaultModel: currentSelectedModel,
            defaultModelProvider: currentSelectedModelProvider,
            defaultSelectionMode: providerSelectionMode,
            defaultReasoning,
            defaultPolicyMode,
            selectedWorkspaceCwd,
            workspaces,
            selectedWorkspaceId: workspaceSelection?.workspace.id ?? "",
            selectedRootId: workspaceSelection?.root.id ?? "",
            workspaceRecents: upsertWorkspaceRecent(current.workspaceRecents, selectedWorkspaceCwd),
            selectedModel: activeThread?.model || currentSelectedModel,
            selectedModelProvider: activeThread?.modelProvider || currentSelectedModelProvider,
            selectedSelectionMode: activeSelectionMode,
            selectedReasoning: defaultReasoning,
            selectedPolicyMode: defaultPolicyMode,
            activeThreadId,
            hydrated: true,
            busy: false,
            error: null,
          });

          if (activeThreadId) {
            void get().selectThread(activeThreadId, { pushHistory: false, deferRead: true });
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
        const result = await roderIpc.listThreads(50);
        set({
          threads: realThreads(normalizeThreadsCwd(result.data ?? [], get().status.cwd)),
          nextThreadCursor: result.nextCursor ?? null,
        });
      },

      loadMoreThreads: async () => {
        const { nextThreadCursor, loadingMoreThreads, status } = get();
        if (!nextThreadCursor || loadingMoreThreads) {
          return;
        }
        set({ loadingMoreThreads: true });
        try {
          const result = await roderIpc.listThreads(50, nextThreadCursor);
          const incoming = realThreads(normalizeThreadsCwd(result.data ?? [], status.cwd));
          set((state) => {
            const byId = new Map(state.threads.map((thread) => [thread.id, thread]));
            for (const thread of incoming) {
              byId.set(thread.id, thread);
            }
            return {
              threads: realThreads(Array.from(byId.values())),
              nextThreadCursor: result.nextCursor ?? null,
              loadingMoreThreads: false,
            };
          });
        } catch (error) {
          set({ error: (error as Error).message, loadingMoreThreads: false });
        }
      },

      selectThread: async (threadId, options = { pushHistory: true }) => {
        const current = get();
        if (threadId === current.activeThreadId && current.threadDetails[threadId]) {
          await syncThreadGoal(threadId, set);
          return;
        }
        const selectedThread = threadForState(current, threadId);
        const selectedWorkspacePatch = selectedThreadWorkspacePatch(current, selectedThread);

        set({
          activeThreadId: threadId,
          ...selectedWorkspacePatch,
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
          const [result, goalResult] = await Promise.all([
            roderIpc.readThread(threadId, !options.deferRead),
            readThreadGoal(threadId),
          ]);
          if (!result.thread) {
            throw new Error("roder app-server did not return a thread");
          }
          const thread = normalizeThreadCwd(result.thread, get().status.cwd);
          set((state) => {
            const threadIsActive = threadId === state.activeThreadId;
            return {
              selectedModelProvider: threadIsActive
                ? state.threadControlsByThread[threadId]?.modelProvider ||
                  thread.modelProvider ||
                  state.defaultModelProvider
                : state.selectedModelProvider,
              selectedSelectionMode: threadIsActive
                ? state.threadControlsByThread[threadId]?.selectionMode ||
                  thread.selectionMode ||
                  manualSelection(
                    thread.modelProvider || state.defaultModelProvider,
                    thread.model || state.defaultModel,
                    state.defaultReasoning,
                  )
                : state.selectedSelectionMode,
              threadDetails: { ...state.threadDetails, [threadId]: thread },
              threads: upsertThread(state.threads, thread),
              threadGoalsByThread: updateThreadGoal(state.threadGoalsByThread, threadId, goalResult.goal),
              selectedWorkspaceCwd: threadIsActive ? thread.cwd : state.selectedWorkspaceCwd,
              selectedWorkspaceId: threadIsActive
                ? (thread.workspaceId ?? state.selectedWorkspaceId)
                : state.selectedWorkspaceId,
              selectedRootId: threadIsActive ? (thread.rootId ?? state.selectedRootId) : state.selectedRootId,
              selectedModel: threadIsActive
                ? state.threadControlsByThread[threadId]?.model || thread.model || state.defaultModel
                : state.selectedModel,
              selectedReasoning: threadIsActive
                ? state.threadControlsByThread[threadId]?.reasoning || state.defaultReasoning
                : state.selectedReasoning,
              selectedPolicyMode: threadIsActive
                ? state.threadControlsByThread[threadId]?.policyMode || state.defaultPolicyMode
                : state.selectedPolicyMode,
              workspaceRecents: upsertWorkspaceRecent(state.workspaceRecents, thread.cwd),
            };
          });
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

      newProject: async (params) => {
        set({ error: null });
        try {
          const current = get();
          let createParams = params;
          if (!createParams) {
            const folder = await roderIpc.openWorkspaceFolder(current.selectedWorkspaceCwd || current.status.cwd);
            if (!folder) {
              return;
            }
            createParams = { roots: [{ path: folder }], defaultRootPath: folder };
          }
          const defaultRootPath = createParams.defaultRootPath ?? createParams.roots[0]?.path;
          if (!defaultRootPath) {
            throw new Error("Add at least one workspace folder before creating a project");
          }
          set({ busy: true });
          const created = await roderIpc.createWorkspace({ ...createParams, defaultRootPath });
          set((state) => ({
            workspaces: upsertWorkspace(state.workspaces, created.workspace),
            selectedWorkspaceId: created.workspace.id,
            selectedRootId: created.workspace.defaultRootId,
            selectedWorkspaceCwd: selectedRootForWorkspace(created.workspace)?.path ?? defaultRootPath,
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
            ...(configuredAutoOptionId(turnState.selectedSelectionMode)
              ? {}
              : {
                  modelProvider:
                    turnModel?.modelProvider ??
                    selectedModelProvider(turnState.models, selectedTurnModel, turnState.selectedModelProvider),
                  model: selectedTurnModel,
                  reasoning: turnState.selectedReasoning,
                }),
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
          defaultSelectionMode: manualSelection(
            defaultModelProvider ??
              selectedModelProvider(state.models, defaultModel, state.defaultModelProvider) ??
              state.defaultModelProvider,
            defaultModel,
            state.defaultReasoning,
          ),
        })),
      setDefaultAutoModel: (optionId) =>
        set((state) => {
          const option = state.routingOptions.find((candidate) => candidate.id === optionId);
          if (!option) {
            return {};
          }
          return {
            defaultModel: option.baseline.model,
            defaultModelProvider: option.baseline.provider,
            defaultSelectionMode: autoSelection(option),
          };
        }),
      setDefaultReasoning: (defaultReasoning) => set({ defaultReasoning }),
      setDefaultPolicyMode: (defaultPolicyMode) => {
        const mode = normalizePolicyMode(defaultPolicyMode);
        set({ defaultPolicyMode: mode, error: null });
      },
      setSelectedModel: async (selectedModel, selectedModelProviderOverride) => {
        const initialState = get();
        const selectedProvider =
          selectedModelProviderOverride ??
          selectedModelProvider(initialState.models, selectedModel, initialState.selectedModelProvider) ??
          initialState.selectedModelProvider;
        const selectionMode = manualSelection(selectedProvider, selectedModel, initialState.selectedReasoning);
        applySelectedModelState(set, selectedModel, selectedProvider, selectionMode);
        await applyLiveModelSelection(set, get, selectionMode);
      },
      setSelectedAutoModel: async (optionId) => {
        const option = get().routingOptions.find((candidate) => candidate.id === optionId);
        if (!option) {
          return;
        }
        const selectionMode = autoSelection(option);
        applySelectedModelState(set, option.baseline.model, option.baseline.provider, selectionMode);
        await applyLiveModelSelection(set, get, selectionMode);
      },
      setModelVisibility: (modelId, visible) =>
        set((state) => {
          const currentVisibleIds = visibleModelIdsFor(state.models, state.visibleModelIds);
          const currentVisible = new Set(currentVisibleIds);
          if (visible) {
            currentVisible.add(modelId);
          } else {
            currentVisible.delete(modelId);
          }
          const nextVisibleIds = state.models.flatMap((model) =>
            currentVisible.has(modelVisibilityKey(model)) ? [modelVisibilityKey(model)] : [],
          );
          if (nextVisibleIds.length === 0) {
            return {};
          }
          const selectedModelRecordValue = selectedModelRecord(
            state.models,
            state.selectedModel,
            state.selectedModelProvider,
          );
          const selectedModel =
            selectedModelRecordValue && nextVisibleIds.includes(modelVisibilityKey(selectedModelRecordValue))
              ? state.selectedModel
              : (state.models.find((model) => modelVisibilityKey(model) === nextVisibleIds[0])?.id ??
                state.selectedModel);
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
        const selectionMode = state.defaultSelectionMode;
        const concrete = concreteSelection(selectionMode);
        const selectedModel = model?.id ?? concrete.model ?? state.defaultModel;
        const selectedProvider =
          model?.modelProvider ??
          concrete.provider ??
          selectedModelProvider(state.models, selectedModel, state.defaultModelProvider);
        if (!selectedModel || !selectedProvider) {
          const message = "Select a model before saving defaults";
          set({ error: message });
          throw new Error(message);
        }

        set({ error: null });
        const [selection, mode] = await Promise.all([
          roderIpc.selectModel(modelSelectChoice(selectionMode, state.defaultReasoning)),
          roderIpc.setDefaultMode(state.defaultPolicyMode),
        ]);

        set({
          defaultModel: selection.model || selectedModel,
          defaultModelProvider: selection.provider || selectedProvider,
          defaultSelectionMode: selection.selectionMode,
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
    selectionMode: state.selectedSelectionMode,
  };
  return setThreadControls(state.threadControlsByThread, state.activeThreadId, {
    ...currentControls,
    ...patch,
  });
}

function manualSelection(provider: string, model: string, reasoning?: string | null): ModelSelectionMode {
  return {
    type: "manual",
    provider,
    model,
    reasoning: reasoning ?? null,
  };
}

function autoSelection(option: InferenceRoutingOptionDescriptor): ModelSelectionMode {
  return {
    type: "auto",
    optionId: option.id,
    routerId: option.routerId,
    label: option.label,
    baseline: option.baseline,
    profile: option.profile ?? null,
    reasoning: option.reasoning ?? null,
  };
}

function concreteSelection(selectionMode: ModelSelectionMode): { provider: string; model: string } {
  if (selectionMode.type === "auto") {
    return {
      provider: selectionMode.baseline?.provider ?? "",
      model: selectionMode.baseline?.model ?? "",
    };
  }
  return {
    provider: selectionMode.provider,
    model: selectionMode.model,
  };
}

function configuredAutoOptionId(selectionMode: ModelSelectionMode): string | null {
  const optionId = selectionMode.type === "auto" ? selectionMode.optionId : null;
  return typeof optionId === "string" && optionId !== "" ? optionId : null;
}

function modelSelectChoice(selectionMode: ModelSelectionMode, reasoning: ReasoningEffort): ModelSelectChoice {
  const optionId = configuredAutoOptionId(selectionMode);
  if (selectionMode.type === "auto" && optionId) {
    return {
      type: "auto",
      optionId,
    };
  }
  if (selectionMode.type === "auto") {
    return {
      type: "manual",
      provider: selectionMode.baseline?.provider ?? "",
      model: selectionMode.baseline?.model ?? "",
      reasoning,
    };
  }
  return {
    type: "manual",
    provider: selectionMode.provider,
    model: selectionMode.model,
    reasoning: selectionMode.reasoning ?? reasoning,
  };
}

function applySelectedModelState(
  set: RoderStoreSet,
  selectedModel: string,
  selectedModelProviderValue: string,
  selectedSelectionMode: ModelSelectionMode,
): void {
  set((state) => ({
    selectedModel,
    selectedModelProvider: selectedModelProviderValue,
    selectedSelectionMode,
    threadControlsByThread: updateActiveThreadControls(state, {
      model: selectedModel,
      modelProvider: selectedModelProviderValue,
      selectionMode: selectedSelectionMode,
    }),
  }));
}

async function applyLiveModelSelection(
  set: RoderStoreSet,
  get: () => RoderStore,
  selectionMode: ModelSelectionMode,
): Promise<void> {
  const state = get();
  if (!state.activeThreadId) {
    return;
  }
  try {
    const result = await roderIpc.selectModel(
      modelSelectChoice(selectionMode, state.selectedReasoning),
      state.activeThreadId,
    );
    set((state) => ({
      selectedModel: result.model || state.selectedModel,
      selectedModelProvider: result.provider || state.selectedModelProvider,
      selectedSelectionMode: result.selectionMode,
      selectedReasoning: normalizeReasoningEffort(result.reasoning || state.selectedReasoning),
      threadControlsByThread: updateActiveThreadControls(state, {
        model: result.model || state.selectedModel,
        modelProvider: result.provider || state.selectedModelProvider,
        reasoning: normalizeReasoningEffort(result.reasoning || state.selectedReasoning),
        selectionMode: result.selectionMode,
      }),
      error: null,
    }));
  } catch (error) {
    set({ error: (error as Error).message });
  }
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

async function listProvidersForBootstrap(): Promise<{
  active_provider: string;
  active_model: string;
  active_reasoning: string;
  routingOptions?: InferenceRoutingOptionDescriptor[];
  selectionMode?: ModelSelectionMode | null;
}> {
  try {
    return await roderIpc.listProviders();
  } catch {
    return {
      active_provider: "",
      active_model: "",
      active_reasoning: "",
      routingOptions: [],
    };
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
  const isBlankThread = initialPrompt === undefined;
  const selectionSource = isBlankThread
    ? {
        selectionMode: latestState.defaultSelectionMode,
        model: latestState.defaultModel,
        provider: latestState.defaultModelProvider,
        reasoning: latestState.defaultReasoning,
      }
    : {
        selectionMode: latestState.selectedSelectionMode,
        model: latestState.selectedModel,
        provider: latestState.selectedModelProvider,
        reasoning: latestState.selectedReasoning,
      };
  const selectionMode =
    selectionSource.selectionMode ??
    manualSelection(selectionSource.provider, selectionSource.model, selectionSource.reasoning);
  const concrete = concreteSelection(selectionMode);
  const selectedModel = concrete.model || selectionSource.model;
  const selectedProvider =
    concrete.provider ||
    selectedModelProvider(latestState.models, selectedModel, selectionSource.provider) ||
    selectionSource.provider;
  const reasoning = selectionSource.reasoning;
  const result = await roderIpc.startThread(
    selectedModel,
    threadStartWorkspace(workspaceSelection),
    selectedProvider,
    reasoning,
    {
      ...(isBlankThread ? {} : { initialPrompt }),
      selection: configuredAutoOptionId(selectionMode)
        ? modelSelectChoice(selectionMode, reasoning)
        : {
            type: "manual",
            provider: selectedProvider,
            model: selectedModel,
            reasoning,
          },
    },
  );
  if (!result.thread) {
    throw new Error("roder app-server did not return a thread");
  }
  const thread = normalizeThreadCwd(result.thread, get().status.cwd);
  const threadWithPreview = initialPrompt ? threadWithPromptPreview(thread, initialPrompt) : thread;
  const resolvedSelectionMode =
    threadWithPreview.selectionMode ||
    result.selectionMode ||
    manualSelection(
      threadWithPreview.modelProvider || selectedProvider || state.defaultModelProvider,
      threadWithPreview.model || result.model || selectedModel,
      result.reasoning || reasoning,
    );
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
    selectedSelectionMode: resolvedSelectionMode,
    selectedReasoning: normalizeReasoningEffort(result.reasoning || reasoning),
    selectedPolicyMode: state.defaultPolicyMode,
    threadControlsByThread: setThreadControls(state.threadControlsByThread, threadWithPreview.id, {
      model: threadWithPreview.model || result.model || selectedModel,
      modelProvider: threadWithPreview.modelProvider || selectedProvider || state.defaultModelProvider,
      reasoning: normalizeReasoningEffort(result.reasoning || reasoning),
      policyMode: state.defaultPolicyMode,
      selectionMode: resolvedSelectionMode,
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

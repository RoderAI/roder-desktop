import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoderModel, RoderThread, Workspace } from "../src/types/roder";

const workspace: Workspace = {
  id: "ws-1",
  name: "Repo",
  roots: [{ id: "root-1", path: "/repo/app", name: "app" }],
  defaultRootId: "root-1",
  updatedAt: 1700000000,
};

const claudeModel: RoderModel = {
  id: "claude-sonnet-4-6",
  name: "Claude Sonnet 4.6",
  modelProvider: "claude-code",
  defaultReasoningEffort: "medium",
  reasoningEfforts: ["medium", "high"],
};

const antigravityModelA: RoderModel = {
  id: "gemini-3.1-pro",
  name: "Gemini 3.1 Pro",
  modelProvider: "antigravity",
  defaultReasoningEffort: "high",
  reasoningEfforts: ["low", "high"],
  isDefault: true,
};

const antigravityModelB: RoderModel = {
  id: "claude-opus-4-6-ag",
  name: "Claude Opus 4.6",
  modelProvider: "antigravity",
  defaultReasoningEffort: "high",
  reasoningEfforts: ["high"],
};

const nativeThread: RoderThread = {
  id: "thread-claude-1",
  preview: "Existing Claude thread",
  modelProvider: "claude-code",
  model: "claude-sonnet-4-6",
  createdAt: 1700000000,
  updatedAt: 1700000000,
  status: { type: "idle", activeTurnId: null, activeFlags: [] },
  workspaceId: "ws-1",
  rootId: "root-1",
  cwd: "/repo/app",
};

const antigravityThread: RoderThread = {
  id: "thread-ag-1",
  preview: "Existing Antigravity thread",
  modelProvider: "antigravity",
  model: "gemini-3.1-pro",
  createdAt: 1700000001,
  updatedAt: 1700000001,
  status: { type: "idle", activeTurnId: null, activeFlags: [] },
  workspaceId: "ws-1",
  rootId: "root-1",
  cwd: "/repo/app",
};

type RequestCall = { method: string; params: Record<string, unknown> };

describe("Antigravity store switching behavior", () => {
  let calls: RequestCall[];

  beforeEach(() => {
    calls = [];
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
      },
    });
    const request = vi.fn<(method: string, params?: Record<string, unknown>) => Promise<unknown>>(
      async (method: string, params: Record<string, unknown> = {}) => {
        calls.push({ method, params });
        if (method === "model/select") {
          const selection = params.selection as { provider: string; model: string; reasoning?: string };
          return {
            selectionMode: {
              type: "manual",
              provider: selection.provider,
              model: selection.model,
              reasoning: selection.reasoning ?? "high",
            },
            provider: selection.provider,
            model: selection.model,
            reasoning: selection.reasoning ?? "high",
          };
        }
        if (method === "thread/start") {
          return {
            model: params.model,
            modelProvider: params.modelProvider,
            reasoning: params.reasoning ?? "high",
            cwd: params.cwd,
            workspaceId: params.workspaceId,
            rootId: params.rootId,
            thread: {
              id: "thread-ag-new",
              preview: "",
              modelProvider: params.modelProvider,
              model: params.model,
              createdAt: 1700000100,
              updatedAt: 1700000100,
              status: { type: "idle", activeTurnId: null, activeFlags: [] },
              workspaceId: params.workspaceId,
              rootId: params.rootId,
              cwd: params.cwd,
            },
          };
        }
        if (method === "turn/start") {
          return { turnId: "turn-1" };
        }
        return {};
      },
    );
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        roderDesktop: {
          platform: "linux",
          homeDir: "/home/test",
          request,
          agentBackendsSelect: vi.fn<(backend: "roder" | "codex" | "antigravity") => Promise<unknown>>(
            async (backend) => ({
              activeBackend: backend,
              backends: {
                roder: {
                  id: "roder",
                  name: "Roder",
                  description: "Native",
                  state: "connected",
                  runtimeInstalled: true,
                  runtimePath: null,
                  connected: true,
                  modelCount: 1,
                  models: [],
                  error: null,
                },
                codex: {
                  id: "codex",
                  name: "Codex",
                  description: "Codex CLI",
                  state: "connected",
                  runtimeInstalled: true,
                  runtimePath: "/usr/local/bin/codex",
                  connected: true,
                  modelCount: 1,
                  models: [
                    {
                      id: "gpt-6.2-sol",
                      name: "GPT-6.2-Sol",
                      modelProvider: "codex",
                      defaultReasoningEffort: "high",
                      reasoningEfforts: ["low", "high"],
                      isDefault: true,
                    },
                  ],
                  error: null,
                },
                antigravity: {
                  id: "antigravity",
                  name: "Antigravity",
                  description: "Antigravity CLI",
                  state: "connected",
                  runtimeInstalled: true,
                  runtimePath: "/usr/local/bin/agy",
                  connected: true,
                  modelCount: 2,
                  models: [antigravityModelA, antigravityModelB],
                  error: null,
                },
              },
            }),
          ),
        },
      },
    });
  });

  it("omits threadId when picking an Antigravity model on a native thread and starts a fresh Antigravity thread on send", async () => {
    const { useRoderStore } = await import("../src/stores/roder-store");
    useRoderStore.setState({
      models: [claudeModel, antigravityModelA, antigravityModelB],
      hiddenModelIds: [],
      workspaces: [workspace],
      selectedWorkspaceId: "ws-1",
      selectedRootId: "root-1",
      selectedWorkspaceCwd: "/repo/app",
      threads: [nativeThread],
      threadDetails: { [nativeThread.id]: nativeThread },
      activeThreadId: nativeThread.id,
      selectedModel: claudeModel.id,
      selectedModelProvider: claudeModel.modelProvider,
      selectedSelectionMode: {
        type: "manual",
        provider: claudeModel.modelProvider,
        model: claudeModel.id,
        reasoning: "medium",
      },
      selectedReasoning: "medium",
      error: null,
    });

    await useRoderStore.getState().setSelectedModel(antigravityModelA.id, "antigravity");

    const selectCall = calls.find((call) => call.method === "model/select");
    expect(selectCall?.params.threadId).toBeUndefined();
    expect(useRoderStore.getState().selectedModelProvider).toBe("antigravity");
    expect(useRoderStore.getState().error).toBeNull();

    await useRoderStore.getState().sendPrompt("Hello from Antigravity");

    const startCall = calls.find((call) => call.method === "thread/start");
    expect(startCall?.params).toMatchObject({
      modelProvider: "antigravity",
      model: antigravityModelA.id,
      workspaceId: "ws-1",
      rootId: "root-1",
      cwd: "/repo/app",
    });
    const turnCall = calls.find((call) => call.method === "turn/start");
    expect(turnCall?.params.threadId).toBe("thread-ag-new");
    expect(useRoderStore.getState().activeThreadId).toBe("thread-ag-new");
    const detail = useRoderStore.getState().threadDetails["thread-ag-new"];
    expect(detail?.turns?.[0]?.items[0]).toMatchObject({
      id: "user-turn-1",
      type: "userMessage",
      text: "Hello from Antigravity",
    });
  });

  it("prepends the first user message above tools even if turn/started and tool items arrive before turn/start resolves", async () => {
    const { useRoderStore } = await import("../src/stores/roder-store");
    const originalRequest = window.roderDesktop.request as unknown as (
      method: string,
      params?: Record<string, unknown>,
    ) => Promise<unknown>;
    window.roderDesktop.request = vi.fn<(method: string, params?: Record<string, unknown>) => Promise<unknown>>(
      async (method: string, params?: Record<string, unknown>) => {
        const response = await originalRequest(method, params);
        if (method === "turn/start") {
          // Simulate Antigravity emitting turn/started and a tool call before turn/start RPC returns,
          // without emitting a userMessage item notification.
          useRoderStore.getState().applyNotification({
            method: "turn/started",
            params: { threadId: "thread-ag-new", turn: { id: "turn-1" } },
          });
          useRoderStore.getState().applyNotification({
            method: "item/started",
            params: {
              seq: 1,
              eventId: "evt-1",
              threadId: "thread-ag-new",
              turnId: "turn-1",
              timestamp: "2026-11-27T21:00:00Z",
              event: {
                type: "itemStarted",
                item: {
                  id: "tool-1",
                  type: "toolExecution",
                  toolCallId: "tool-1",
                  toolName: "git status",
                  status: "inProgress",
                },
              },
            },
          });
        }
        return response;
      },
    ) as typeof window.roderDesktop.request;

    useRoderStore.setState({
      activeBackend: "antigravity",
      models: [claudeModel, antigravityModelA],
      hiddenModelIds: [],
      workspaces: [workspace],
      selectedWorkspaceId: "ws-1",
      selectedRootId: "root-1",
      selectedWorkspaceCwd: "/repo/app",
      threads: [],
      threadDetails: {},
      activeThreadId: "",
      selectedModel: antigravityModelA.id,
      selectedModelProvider: "antigravity",
      error: null,
    });

    await useRoderStore.getState().sendPrompt("i want real antigravity logos hehre plz");

    const detail = useRoderStore.getState().threadDetails["thread-ag-new"];
    expect(detail?.turns).toHaveLength(1);
    expect(detail?.turns?.[0]?.items.map((item) => item.type)).toEqual(["userMessage", "toolExecution"]);
    expect(detail?.turns?.[0]?.items[0]).toMatchObject({
      id: "user-turn-1",
      type: "userMessage",
      text: "i want real antigravity logos hehre plz",
    });
  });

  it("keeps the same Antigravity thread when switching between Antigravity models", async () => {
    const { useRoderStore } = await import("../src/stores/roder-store");
    useRoderStore.setState({
      models: [claudeModel, antigravityModelA, antigravityModelB],
      hiddenModelIds: [],
      workspaces: [workspace],
      selectedWorkspaceId: "ws-1",
      selectedRootId: "root-1",
      selectedWorkspaceCwd: "/repo/app",
      threads: [antigravityThread],
      threadDetails: { [antigravityThread.id]: antigravityThread },
      activeThreadId: antigravityThread.id,
      selectedModel: antigravityModelA.id,
      selectedModelProvider: "antigravity",
      selectedSelectionMode: {
        type: "manual",
        provider: "antigravity",
        model: antigravityModelA.id,
        reasoning: "high",
      },
      selectedReasoning: "high",
      error: null,
    });

    await useRoderStore.getState().setSelectedModel(antigravityModelB.id, "antigravity");

    const selectCall = calls.find((call) => call.method === "model/select");
    expect(selectCall?.params.threadId).toBe(antigravityThread.id);

    await useRoderStore.getState().sendPrompt("Continue on the same Antigravity thread");

    expect(calls.some((call) => call.method === "thread/start")).toBe(false);
    const turnCall = calls.find((call) => call.method === "turn/start");
    expect(turnCall?.params.threadId).toBe(antigravityThread.id);
  });

  it("switches to the Codex agent backend via selectAgentBackend and starts a Codex backend thread on send", async () => {
    const { useRoderStore } = await import("../src/stores/roder-store");
    useRoderStore.setState({
      activeBackend: "roder",
      models: [claudeModel],
      hiddenModelIds: [],
      workspaces: [workspace],
      selectedWorkspaceId: "ws-1",
      selectedRootId: "root-1",
      selectedWorkspaceCwd: "/repo/app",
      threads: [nativeThread],
      threadDetails: { [nativeThread.id]: nativeThread },
      activeThreadId: nativeThread.id,
      selectedModel: claudeModel.id,
      selectedModelProvider: claudeModel.modelProvider,
      error: null,
    });

    await useRoderStore.getState().selectAgentBackend("codex");
    expect(useRoderStore.getState().activeBackend).toBe("codex");
    expect(useRoderStore.getState().selectedModel).toBe("gpt-6.2-sol");
    expect(useRoderStore.getState().selectedModelProvider).toBe("codex");

    await useRoderStore.getState().sendPrompt("Run via Codex CLI backend");

    const startCall = calls.find((call) => call.method === "thread/start");
    expect(startCall?.params).toMatchObject({
      agentBackend: "codex",
      modelProvider: "codex",
      model: "gpt-6.2-sol",
    });
  });

  it("steers an active Antigravity turn without flashing idle and displays the steered user message", async () => {
    const { useRoderStore } = await import("../src/stores/roder-store");
    let midSteerSnapshot: { busy: boolean; statusType: string | undefined } | null = null;
    window.roderDesktop.request = vi.fn<(method: string, params?: Record<string, unknown>) => Promise<unknown>>(
      async (method: string) => {
        if (method === "turn/steer") {
          // Simulate the interrupted turn completing while turn/steer replaces it with turn-2.
          useRoderStore.getState().applyNotification({
            method: "turn/completed",
            params: { threadId: antigravityThread.id, turn: { id: "turn-1", status: "interrupted" } },
          });
          midSteerSnapshot = {
            busy: useRoderStore.getState().busy,
            statusType: useRoderStore.getState().threadDetails[antigravityThread.id]?.status.type,
          };
          return { turnId: "turn-2" };
        }
        return {};
      },
    ) as typeof window.roderDesktop.request;

    const runningAgThread: RoderThread = {
      ...antigravityThread,
      status: { type: "running", activeTurnId: "turn-1", activeFlags: [] },
      turns: [
        {
          id: "turn-1",
          status: "inProgress",
          items: [{ id: "user-turn-1", type: "userMessage", text: "first prompt" }],
        },
      ],
    };

    useRoderStore.setState({
      activeBackend: "antigravity",
      models: [claudeModel, antigravityModelA],
      hiddenModelIds: [],
      workspaces: [workspace],
      selectedWorkspaceId: "ws-1",
      selectedRootId: "root-1",
      selectedWorkspaceCwd: "/repo/app",
      threads: [runningAgThread],
      threadDetails: { [runningAgThread.id]: runningAgThread },
      activeThreadId: runningAgThread.id,
      busy: true,
      selectedModel: antigravityModelA.id,
      selectedModelProvider: "antigravity",
      error: null,
    });

    await useRoderStore.getState().steerPrompt("is it implemented?");

    expect(midSteerSnapshot).toEqual({ busy: true, statusType: "running" });
    const nextState = useRoderStore.getState();
    expect(nextState.busy).toBe(true);
    expect(nextState.error).toBeNull();
    const detail = nextState.threadDetails[runningAgThread.id];
    expect(detail?.status).toEqual({ type: "running", activeTurnId: "turn-2", activeFlags: [] });
    expect(detail?.turns?.find((turn) => turn.id === "turn-2")?.items[0]).toMatchObject({
      id: "user-turn-2",
      type: "userMessage",
      text: "is it implemented?",
    });
  });
});

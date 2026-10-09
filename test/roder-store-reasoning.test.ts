import { expect, test, vi } from "vitest";
import type { RoderThread } from "../src/types/roder";

// Engine-advertised shapes, as the desktop sees them after the providers/list adapter.
const gptLuna = {
  id: "gpt-6-luna",
  name: "GPT-6 Luna",
  modelProvider: "codex",
  defaultReasoningEffort: "medium",
  reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
};
const haiku = {
  id: "haiku",
  name: "Claude Code Haiku",
  modelProvider: "claude-code",
  reasoningEfforts: [],
};

const workspace = {
  id: "ws-1",
  name: "workspace",
  roots: [{ id: "root-1", path: "/workspace", name: "workspace" }],
  defaultRootId: "root-1",
  updatedAt: 1770000200,
};

async function loadRoderStore(request: (method: string, params?: unknown) => Promise<unknown>) {
  vi.resetModules();
  const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  } as unknown as Storage;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  globalThis.window = {
    localStorage: storage,
    roderDesktop: {
      start: vi.fn<Window["roderDesktop"]["start"]>(async () => ({
        state: "ready",
        binary: "test",
        cwd: "/workspace",
      })),
      restart: vi.fn<Window["roderDesktop"]["start"]>(async () => ({
        state: "ready",
        binary: "test",
        cwd: "/workspace",
      })),
      status: vi.fn<Window["roderDesktop"]["status"]>(async () => ({
        state: "ready",
        binary: "test",
        cwd: "/workspace",
      })),
      appearance: vi.fn<Window["roderDesktop"]["appearance"]>(async () => "light"),
      openWorkspaceFolder: vi.fn<Window["roderDesktop"]["openWorkspaceFolder"]>(async () => null),
      openWorkspaceFolders: vi.fn<Window["roderDesktop"]["openWorkspaceFolders"]>(async () => null),
      request,
      onAppearance: () => () => undefined,
      onNotification: () => () => undefined,
      onStatus: () => () => undefined,
      onStderr: () => () => undefined,
    },
  } as unknown as Window & typeof globalThis;
  const module = await import("../src/stores/roder-store");
  module.useRoderStore.setState({ activeThreadId: "", hunkRevisionByThread: {} });
  return module.useRoderStore;
}

function threadStartRequest(calls: Array<{ method: string; params: unknown }>) {
  return vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method, params) => {
    calls.push({ method, params });
    switch (method) {
      case "workspace/create":
        return { workspace };
      case "thread/start": {
        const requested = params as { model: string; modelProvider: string; reasoning?: string };
        return {
          thread: {
            id: "thread-new",
            preview: "Untitled thread",
            modelProvider: requested.modelProvider,
            model: requested.model,
            createdAt: 1770000200,
            updatedAt: 1770000200,
            status: { type: "idle", activeTurnId: null, activeFlags: [] },
            workspaceId: workspace.id,
            rootId: workspace.defaultRootId,
            cwd: "/workspace",
            turns: [],
          },
          model: requested.model,
          modelProvider: requested.modelProvider,
          reasoning: requested.reasoning ?? "none",
        };
      }
      default:
        return {};
    }
  });
}

function startParams(calls: Array<{ method: string; params: unknown }>) {
  const call = calls.find((entry) => entry.method === "thread/start");
  return call?.params as { reasoning?: string; model: string; modelProvider: string } | undefined;
}

test("a new thread on a model that takes no effort sends no reasoning field", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const useRoderStore = await loadRoderStore(threadStartRequest(calls));
  useRoderStore.setState({
    status: { state: "ready", binary: "test", cwd: "/workspace" },
    selectedWorkspaceCwd: "/workspace",
    models: [haiku as never],
    defaultModel: "haiku",
    defaultModelProvider: "claude-code",
    defaultSelectionMode: { type: "manual", provider: "claude-code", model: "haiku", reasoning: "medium" } as never,
    defaultReasoning: "medium",
    workspaces: [],
  });

  await useRoderStore.getState().newThread();

  expect(startParams(calls)).toMatchObject({ model: "haiku", modelProvider: "claude-code" });
  expect(startParams(calls)?.reasoning).toBeUndefined();
});

test("a new thread never sends an effort the chosen model does not advertise", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const useRoderStore = await loadRoderStore(threadStartRequest(calls));
  useRoderStore.setState({
    status: { state: "ready", binary: "test", cwd: "/workspace" },
    selectedWorkspaceCwd: "/workspace",
    models: [gptLuna as never],
    defaultModel: "gpt-6-luna",
    defaultModelProvider: "codex",
    defaultSelectionMode: { type: "manual", provider: "codex", model: "gpt-6-luna", reasoning: "ultra" } as never,
    // The engine rejects `ultra` for gpt-6-luna with "does not support reasoning effort ultra".
    defaultReasoning: "ultra",
    workspaces: [],
  });

  await useRoderStore.getState().newThread();

  expect(startParams(calls)?.reasoning).toBe("medium");
});

test("an engine exit clears busy and running threads, and says why", async () => {
  const useRoderStore = await loadRoderStore(
    vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async () => ({})),
  );
  const runningThread = {
    id: "thread-1",
    preview: "Working",
    modelProvider: "codex",
    model: "gpt-6-luna",
    status: { type: "running", activeTurnId: "turn-1", activeFlags: [] },
    turns: [],
  } as unknown as RoderThread;
  useRoderStore.setState({
    activeThreadId: "thread-1",
    busy: true,
    threads: [runningThread],
    threadDetails: { "thread-1": runningThread },
  });

  useRoderStore.getState().applyStatus({ state: "stopped", binary: "test", message: "roder exited with code 1" });

  const state = useRoderStore.getState();
  expect(state.busy).toBe(false);
  expect(state.threads[0].status).toEqual({ type: "idle", activeTurnId: null, activeFlags: [] });
  expect(state.threadDetails["thread-1"].status.type).toBe("idle");
  expect(state.error).toContain("roder exited with code 1");
});

test("a ready engine status leaves an in-flight turn alone", async () => {
  const useRoderStore = await loadRoderStore(
    vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async () => ({})),
  );
  useRoderStore.setState({ busy: true });

  useRoderStore.getState().applyStatus({ state: "ready", binary: "test", cwd: "/workspace" });

  expect(useRoderStore.getState().busy).toBe(true);
});

test("saving defaults sends the reasoning the user just chose, not the stored one", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const useRoderStore = await loadRoderStore(
    vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method, params) => {
      calls.push({ method, params });
      if (method === "model/select") {
        const selection = (params as { selection: { reasoning?: string; provider: string; model: string } }).selection;
        return {
          selectionMode: {
            type: "manual",
            provider: selection.provider,
            model: selection.model,
            reasoning: selection.reasoning,
          },
          provider: selection.provider,
          model: selection.model,
          reasoning: selection.reasoning,
        };
      }
      if (method === "settings/set_default_mode") {
        return { default_mode: "accept_all" };
      }
      return {};
    }),
  );
  useRoderStore.setState({
    models: [gptLuna as never],
    defaultModel: "gpt-6-luna",
    defaultModelProvider: "codex",
    // The stored selection still carries "low" from before the user changed it.
    defaultSelectionMode: { type: "manual", provider: "codex", model: "gpt-6-luna", reasoning: "low" } as never,
    defaultReasoning: "high",
  });

  await useRoderStore.getState().saveDefaults();

  const select = calls.find((entry) => entry.method === "model/select");
  const selectParams = select?.params as { selection: { reasoning?: string } } | undefined;
  expect(selectParams?.selection.reasoning).toBe("high");
});

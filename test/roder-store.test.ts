import { expect, test, vi } from "vitest";

async function loadRoderStore(
  request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(),
  desktopOverrides: Partial<Window["roderDesktop"]> = {},
) {
  vi.resetModules();
  const localStorage = {
    getItem: vi.fn<(key: string) => string | null>(() => null),
    setItem: vi.fn<(key: string, value: string) => void>(),
    removeItem: vi.fn<(key: string) => void>(),
    clear: vi.fn<() => void>(),
    key: vi.fn<(index: number) => string | null>(() => null),
    length: 0,
  } as unknown as Storage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorage,
  });
  globalThis.window = {
    localStorage,
    roderDesktop: {
      start: vi.fn<Window["roderDesktop"]["start"]>(async () => ({
        state: "ready",
        binary: "test",
        cwd: "/workspace",
      })),
      restart: vi.fn<Window["roderDesktop"]["restart"]>(async () => ({
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
      request,
      onAppearance: () => () => undefined,
      onNotification: () => () => undefined,
      onStatus: () => () => undefined,
      onStderr: () => () => undefined,
      ...desktopOverrides,
    },
  } as unknown as Window & typeof globalThis;

  const module = await import("../src/stores/roder-store");
  module.useRoderStore.setState({
    activeThreadId: "thread-1",
    hunkRevisionByThread: {},
  });
  return module.useRoderStore;
}

test("new threads use the current cwd instead of an unmatched stale workspace", async () => {
  const currentCwd = "/Users/example/gode-desktop";
  const staleCwd = "/private/var/folders/example/roder-thread-cwd-123/process-workspace";
  const staleWorkspace = {
    id: "ws_stale",
    name: "process-workspace",
    roots: [{ id: "root_stale", path: staleCwd, name: "process-workspace" }],
    defaultRootId: "root_stale",
    updatedAt: 1770000100,
  };
  const currentWorkspace = {
    id: "ws_current",
    name: "gode-desktop",
    roots: [{ id: "root_current", path: currentCwd, name: "gode-desktop" }],
    defaultRootId: "root_current",
    updatedAt: 1770000200,
  };
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method) => {
    switch (method) {
      case "thread/list":
        return { data: [] };
      case "model/list":
        return { models: [{ id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai", isDefault: true }] };
      case "settings/get":
        return {
          default_provider: "openai",
          default_model: "gpt-5.5",
          default_reasoning: "medium",
          default_mode: "accept_all",
        };
      case "workspace/list":
        return { workspaces: [staleWorkspace] };
      case "workspace/create":
        return { workspace: currentWorkspace };
      case "thread/start":
        return {
          thread: {
            id: "thread-current",
            preview: "Untitled thread",
            modelProvider: "openai",
            model: "gpt-5.5",
            createdAt: 1770000200,
            updatedAt: 1770000200,
            status: { type: "idle", activeTurnId: null, activeFlags: [] },
            workspaceId: currentWorkspace.id,
            rootId: currentWorkspace.defaultRootId,
            cwd: currentCwd,
            turns: [],
          },
          model: "gpt-5.5",
          reasoning: "medium",
        };
      default:
        return {};
    }
  });
  const status = vi.fn<Window["roderDesktop"]["status"]>(async () => ({
    state: "ready",
    binary: "test",
    cwd: currentCwd,
  }));
  const useRoderStore = await loadRoderStore(request, { start: status, status });

  useRoderStore.setState({
    activeThreadId: "",
    selectedWorkspaceId: "",
    selectedRootId: "",
    selectedWorkspaceCwd: "",
    threads: [],
    threadDetails: {},
    workspaces: [],
    workspaceRecents: [],
  });

  await useRoderStore.getState().bootstrap();

  expect(useRoderStore.getState().selectedWorkspaceCwd).toBe(currentCwd);
  expect(useRoderStore.getState().selectedWorkspaceId).toBe("");

  await useRoderStore.getState().newThread();

  expect(request).toHaveBeenCalledWith("workspace/create", {
    roots: [{ path: currentCwd }],
    defaultRootPath: currentCwd,
  });
  expect(request).toHaveBeenCalledWith(
    "thread/start",
    expect.objectContaining({
      workspaceId: currentWorkspace.id,
      rootId: currentWorkspace.defaultRootId,
    }),
  );
});

test("bootstrap still loads core app data when workspace listing is unavailable", async () => {
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method) => {
    switch (method) {
      case "thread/list":
        return {
          data: [
            {
              id: "thread-1",
              preview: "Existing thread",
              modelProvider: "openai",
              model: "gpt-5.5",
              createdAt: 1770000000,
              updatedAt: 1770000100,
              status: { type: "idle", activeTurnId: null, activeFlags: [] },
              cwd: "/workspace",
              turns: [],
            },
          ],
        };
      case "model/list":
        return { models: [{ id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai", isDefault: true }] };
      case "settings/get":
        return {
          default_provider: "openai",
          default_model: "gpt-5.5",
          default_reasoning: "medium",
          default_mode: "accept_all",
        };
      case "workspace/list":
        throw new Error("method not found: workspace/list");
      case "thread/read":
        return {
          thread: {
            id: "thread-1",
            preview: "Existing thread",
            modelProvider: "openai",
            model: "gpt-5.5",
            createdAt: 1770000000,
            updatedAt: 1770000100,
            status: { type: "idle", activeTurnId: null, activeFlags: [] },
            cwd: "/workspace",
            turns: [],
          },
        };
      default:
        return {};
    }
  });
  const useRoderStore = await loadRoderStore(request);

  await useRoderStore.getState().bootstrap();

  expect(useRoderStore.getState().status.state).toBe("ready");
  expect(useRoderStore.getState().error).toBeNull();
  expect(useRoderStore.getState().threads).toHaveLength(1);
  expect(useRoderStore.getState().models).toHaveLength(1);
  expect(useRoderStore.getState().workspaces).toEqual([]);
});

test("stale root ids do not silently select the first root in a workspace", async () => {
  const currentCwd = "/workspace/current";
  const createdWorkspace = {
    id: "ws_current",
    name: "current",
    roots: [{ id: "root_current", path: currentCwd, name: "current" }],
    defaultRootId: "root_current",
    updatedAt: 1770000200,
  };
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method) => {
    switch (method) {
      case "workspace/create":
        return { workspace: createdWorkspace };
      case "thread/start":
        return {
          thread: {
            id: "thread-current",
            preview: "Untitled thread",
            modelProvider: "openai",
            model: "gpt-5.5",
            createdAt: 1770000200,
            updatedAt: 1770000200,
            status: { type: "idle", activeTurnId: null, activeFlags: [] },
            workspaceId: createdWorkspace.id,
            rootId: createdWorkspace.defaultRootId,
            cwd: currentCwd,
            turns: [],
          },
          model: "gpt-5.5",
          reasoning: "medium",
        };
      default:
        return {};
    }
  });
  const useRoderStore = await loadRoderStore(request);

  useRoderStore.setState({
    activeThreadId: "",
    status: { state: "ready", binary: "test", cwd: currentCwd },
    selectedWorkspaceId: "ws_multi",
    selectedRootId: "root_removed",
    selectedWorkspaceCwd: "",
    models: [{ id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai", isDefault: true }],
    defaultModel: "gpt-5.5",
    selectedModel: "gpt-5.5",
    workspaces: [
      {
        id: "ws_multi",
        name: "Multi-root",
        roots: [
          { id: "root_a", path: "/workspace/a", name: "a" },
          { id: "root_b", path: "/workspace/b", name: "b" },
        ],
        defaultRootId: "root_a",
        updatedAt: 1770000100,
      },
    ],
  });

  await useRoderStore.getState().newThread();

  expect(request).toHaveBeenCalledWith("workspace/create", {
    roots: [{ path: currentCwd }],
    defaultRootPath: currentCwd,
  });
  expect(request).toHaveBeenCalledWith(
    "thread/start",
    expect.objectContaining({
      workspaceId: createdWorkspace.id,
      rootId: createdWorkspace.defaultRootId,
    }),
  );
  expect(request).not.toHaveBeenCalledWith(
    "thread/start",
    expect.objectContaining({
      workspaceId: "ws_multi",
      rootId: "root_a",
    }),
  );
});

test("hunk recorded notifications bump the hunk revision for the changed thread", async () => {
  const useRoderStore = await loadRoderStore();

  useRoderStore.getState().applyNotification({
    method: "hunk/recorded",
    params: {
      hunk: {
        threadId: "thread-1",
      },
    },
  });
  useRoderStore.getState().applyNotification({
    method: "hunk/recorded",
    params: {
      hunk: {
        threadId: "thread-1",
      },
    },
  });

  expect(useRoderStore.getState().hunkRevisionByThread).toEqual({
    "thread-1": 2,
  });
});

test("thread goal reads ignore goals from another thread", async () => {
  const useRoderStore = await loadRoderStore(async (method, params) => {
    const requestParams = params as { threadId?: string };
    if (method === "thread/read") {
      return {
        thread: {
          id: requestParams.threadId,
          preview: "Other thread",
          modelProvider: "openai",
          model: "gpt-5.5",
          createdAt: 1770000000,
          updatedAt: 1770000100,
          status: { type: "idle", activeTurnId: null, activeFlags: [] },
          cwd: "/workspace",
          turns: [],
        },
      };
    }
    if (method === "thread/goal/get") {
      return {
        goal: {
          threadId: "thread-with-goal",
          objective: "Research the codebase",
          status: "active",
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: "2026-05-30T12:00:00Z",
          updatedAt: "2026-05-30T12:00:00Z",
        },
      };
    }
    return {};
  });

  useRoderStore.setState({
    activeThreadId: "",
    threadDetails: {},
    threadGoalsByThread: {},
    threads: [],
  });

  await useRoderStore.getState().selectThread("thread-without-goal", { pushHistory: false });

  expect(useRoderStore.getState().threadGoalsByThread).toEqual({});
});

test("observed workspace change notifications refresh review summaries", async () => {
  const useRoderStore = await loadRoderStore();

  useRoderStore.getState().applyNotification({
    method: "workspace/changeObserved",
    params: {
      change: {
        threadId: "thread-1",
      },
    },
  });

  expect(useRoderStore.getState().hunkRevisionByThread).toEqual({
    "thread-1": 1,
  });
});

test("sendPrompt ignores active running turns instead of steering them", async () => {
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async () => ({}));
  const useRoderStore = await loadRoderStore(request);
  const thread = {
    id: "thread-1",
    preview: "Active thread",
    modelProvider: "codex",
    model: "gpt-5.5",
    createdAt: 1770000000,
    updatedAt: 1770000100,
    status: { type: "running", activeTurnId: "turn-1", activeFlags: [] },
    cwd: "/workspace",
    turns: [{ id: "turn-1", items: [], itemsView: "default", status: "inProgress" }],
  };

  useRoderStore.setState({
    activeThreadId: "thread-1",
    busy: true,
    threadDetails: { "thread-1": thread },
    threads: [thread],
  });

  await useRoderStore.getState().sendPrompt("did you set a goal?");

  expect(request).not.toHaveBeenCalledWith("turn/steer", expect.anything());
  expect(request).not.toHaveBeenCalledWith("turn/start", expect.anything());
});

test("sendPrompt starts a new turn when a stale activeTurnId is not running", async () => {
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method) => {
    if (method === "turn/start") {
      return { turnId: "turn-2" };
    }
    return {};
  });
  const useRoderStore = await loadRoderStore(request);
  const thread = {
    id: "thread-1",
    preview: "Paused thread",
    modelProvider: "codex",
    model: "gpt-5.5",
    createdAt: 1770000000,
    updatedAt: 1770000100,
    status: { type: "paused", activeTurnId: "turn-1", activeFlags: [] },
    cwd: "/workspace",
    turns: [{ id: "turn-1", items: [], itemsView: "default", status: "completed" }],
  };

  useRoderStore.setState({
    activeThreadId: "thread-1",
    busy: false,
    selectedModel: "gpt-5.5",
    models: [{ id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai", isDefault: true }],
    threadDetails: { "thread-1": thread },
    threads: [thread],
  });

  await useRoderStore.getState().sendPrompt("continue from here");

  expect(request).toHaveBeenCalledWith(
    "turn/start",
    expect.objectContaining({
      threadId: "thread-1",
      model: "gpt-5.5",
    }),
  );
});

test("goal notifications update the thread goal state", async () => {
  const useRoderStore = await loadRoderStore();

  useRoderStore.getState().applyNotification({
    method: "thread/goal/updated",
    params: {
      threadId: "thread-1",
      goal: {
        threadId: "thread-1",
        objective: "Ship the header goal signal",
        status: "active",
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: "2026-05-30T12:00:00Z",
        updatedAt: "2026-05-30T12:00:00Z",
      },
    },
  });

  expect(useRoderStore.getState().threadGoalsByThread["thread-1"]?.objective).toBe("Ship the header goal signal");

  useRoderStore.getState().applyNotification({
    method: "thread/goal/updated",
    params: {
      threadId: "thread-1",
      goal: {
        threadId: "thread-1",
        objective: "Ship the header goal signal",
        status: "usageLimited",
        tokensUsed: 120000,
        timeUsedSeconds: 0,
        createdAt: "2026-05-30T12:00:00Z",
        updatedAt: "2026-05-30T12:00:30Z",
      },
    },
  });

  expect(useRoderStore.getState().threadGoalsByThread["thread-1"]?.status).toBe("usageLimited");

  useRoderStore.getState().applyNotification({
    method: "thread/goal/updated",
    params: {
      threadId: "thread-1",
      goal: {
        threadId: "thread-1",
        objective: "Ship the header goal signal",
        status: "budgetLimited",
        tokensUsed: 120000,
        timeUsedSeconds: 0,
        createdAt: "2026-05-30T12:00:00Z",
        updatedAt: "2026-05-30T12:00:45Z",
      },
    },
  });

  expect(useRoderStore.getState().threadGoalsByThread["thread-1"]?.status).toBe("budgetLimited");

  useRoderStore.getState().applyNotification({
    method: "thread/goal/updated",
    params: {
      threadId: "thread-1",
      goal: {
        threadId: "thread-1",
        objective: "Ship the header goal signal",
        status: "complete",
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: "2026-05-30T12:00:00Z",
        updatedAt: "2026-05-30T12:01:00Z",
      },
    },
  });

  expect(useRoderStore.getState().threadGoalsByThread).toEqual({});

  useRoderStore.getState().applyNotification({
    method: "thread/goal/updated",
    params: {
      threadId: "thread-1",
      goal: {
        threadId: "thread-1",
        objective: "Ship the header goal signal",
        status: "active",
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: "2026-05-30T12:00:00Z",
        updatedAt: "2026-05-30T12:02:00Z",
      },
    },
  });

  useRoderStore.getState().applyNotification({
    method: "thread/goal/cleared",
    params: {
      threadId: "thread-1",
    },
  });

  expect(useRoderStore.getState().threadGoalsByThread).toEqual({});
});

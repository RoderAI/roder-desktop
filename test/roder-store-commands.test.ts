import { expect, test, vi } from "vitest";

async function loadRoderStore(request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>()) {
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
    },
  } as unknown as Window & typeof globalThis;

  const module = await import("../src/stores/roder-store");
  module.useRoderStore.setState({
    activeThreadId: "",
    busy: false,
    error: null,
    hunkRevisionByThread: {},
  });
  return module.useRoderStore;
}

test("runCommandInvocation starts a command turn on an existing idle thread", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method, params) => {
    calls.push({ method, params });
    if (method === "commands/run") {
      return { turn_id: "turn-2", expanded: commandExpanded() };
    }
    return {};
  });
  const useRoderStore = await loadRoderStore(request);
  const thread = threadFixture({ id: "thread-1", cwd: "/workspace" });
  useRoderStore.setState({
    activeThreadId: "thread-1",
    selectedWorkspaceCwd: "/workspace",
    threadDetails: { "thread-1": thread },
    threads: [thread],
  });

  await useRoderStore.getState().runCommandInvocation({ name: "review", arguments: "api" });

  expect(calls).toEqual([
    {
      method: "commands/run",
      params: {
        thread_id: "thread-1",
        name: "review",
        arguments: "api",
        workspace: "/workspace",
      },
    },
  ]);
  expect(useRoderStore.getState().threadDetails["thread-1"].status).toEqual({
    type: "running",
    activeTurnId: "turn-2",
    activeFlags: [],
  });
});

test("runCommandInvocation uses the active thread cwd before stale selected workspace state", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method, params) => {
    calls.push({ method, params });
    if (method === "commands/run") {
      return { turn_id: "turn-2", expanded: commandExpanded() };
    }
    return {};
  });
  const useRoderStore = await loadRoderStore(request);
  const thread = threadFixture({ id: "thread-1", cwd: "/workspace/thread" });
  useRoderStore.setState({
    activeThreadId: "thread-1",
    selectedWorkspaceCwd: "/workspace/stale-selection",
    threadDetails: { "thread-1": thread },
    threads: [thread],
  });

  await useRoderStore.getState().runCommandInvocation({ name: "review", arguments: "api" });

  expect(calls).toContainEqual({
    method: "commands/run",
    params: expect.objectContaining({
      workspace: "/workspace/thread",
    }),
  });
});

test("runCommandInvocation creates a thread before running a command on the new-thread route", async () => {
  const workspace = {
    id: "ws-1",
    name: "workspace",
    roots: [{ id: "root-1", path: "/workspace", name: "workspace" }],
    defaultRootId: "root-1",
    updatedAt: 1770000000,
  };
  const calls: Array<{ method: string; params: unknown }> = [];
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method, params) => {
    calls.push({ method, params });
    if (method === "workspace/create") {
      return { workspace };
    }
    if (method === "thread/start") {
      return {
        thread: threadFixture({ id: "thread-new", workspaceId: "ws-1", rootId: "root-1", cwd: "/workspace" }),
        model: "gpt-5.5",
        reasoning: "medium",
      };
    }
    if (method === "commands/run") {
      return { turn_id: "turn-new", expanded: commandExpanded() };
    }
    return {};
  });
  const useRoderStore = await loadRoderStore(request);
  useRoderStore.setState({
    activeThreadId: "",
    status: { state: "ready", binary: "test", cwd: "/workspace" },
    models: [{ id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai", isDefault: true }],
    defaultModel: "gpt-5.5",
    defaultReasoning: "medium",
    selectedWorkspaceCwd: "/workspace",
    threads: [],
    threadDetails: {},
    workspaces: [],
  });

  await useRoderStore.getState().runCommandInvocation({ name: "review", arguments: "api" });

  expect(calls.map((call) => call.method)).toEqual(["workspace/create", "thread/start", "commands/run"]);
  expect(calls[1]).toEqual({
    method: "thread/start",
    params: expect.objectContaining({
      initialPrompt: "/review api",
    }),
  });
  expect(calls[2]).toEqual({
    method: "commands/run",
    params: {
      thread_id: "thread-new",
      name: "review",
      arguments: "api",
      workspace: "/workspace",
    },
  });
  expect(useRoderStore.getState().activeThreadId).toBe("thread-new");
  expect(useRoderStore.getState().threads[0]?.status).toEqual({
    type: "running",
    activeTurnId: "turn-new",
    activeFlags: [],
  });
  expect(useRoderStore.getState().threadDetails["thread-new"]?.status).toEqual({
    type: "running",
    activeTurnId: "turn-new",
    activeFlags: [],
  });
});

test("runCommandInvocation ignores duplicate new-thread commands while thread creation is pending", async () => {
  const workspace = {
    id: "ws-1",
    name: "workspace",
    roots: [{ id: "root-1", path: "/workspace", name: "workspace" }],
    defaultRootId: "root-1",
    updatedAt: 1770000000,
  };
  const threadStart = deferred<void>();
  const calls: Array<{ method: string; params: unknown }> = [];
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method, params) => {
    calls.push({ method, params });
    if (method === "workspace/create") {
      return { workspace };
    }
    if (method === "thread/start") {
      await threadStart.promise;
      return {
        thread: threadFixture({ id: "thread-new", workspaceId: "ws-1", rootId: "root-1", cwd: "/workspace" }),
        model: "gpt-5.5",
        reasoning: "medium",
      };
    }
    if (method === "commands/run") {
      return { turn_id: "turn-new", expanded: commandExpanded() };
    }
    return {};
  });
  const useRoderStore = await loadRoderStore(request);
  useRoderStore.setState({
    activeThreadId: "",
    status: { state: "ready", binary: "test", cwd: "/workspace" },
    models: [{ id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai", isDefault: true }],
    defaultModel: "gpt-5.5",
    defaultReasoning: "medium",
    selectedWorkspaceCwd: "/workspace",
    threads: [],
    threadDetails: {},
    workspaces: [],
  });

  const firstRun = useRoderStore.getState().runCommandInvocation({ name: "review", arguments: "api" });
  await Promise.resolve();
  const secondRun = useRoderStore.getState().runCommandInvocation({ name: "review", arguments: "api" });
  threadStart.resolve();
  await Promise.all([firstRun, secondRun]);

  expect(calls.filter((call) => call.method === "thread/start")).toHaveLength(1);
  expect(calls.filter((call) => call.method === "commands/run")).toHaveLength(1);
});

test("runCommandInvocation ignores commands while the active thread is running", async () => {
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async () => ({}));
  const useRoderStore = await loadRoderStore(request);
  const thread = threadFixture({ status: { type: "running", activeTurnId: "turn-1", activeFlags: [] } });
  useRoderStore.setState({
    activeThreadId: "thread-1",
    threadDetails: { "thread-1": thread },
    threads: [thread],
  });

  await useRoderStore.getState().runCommandInvocation({ name: "review", arguments: "" });

  expect(request).not.toHaveBeenCalled();
});

test("runCommandInvocation restores idle status when command execution fails", async () => {
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method) => {
    if (method === "commands/run") {
      throw new Error("command disabled");
    }
    return {};
  });
  const useRoderStore = await loadRoderStore(request);
  const thread = threadFixture({});
  useRoderStore.setState({
    activeThreadId: "thread-1",
    selectedWorkspaceCwd: "/workspace",
    threadDetails: { "thread-1": thread },
    threads: [thread],
  });

  await useRoderStore.getState().runCommandInvocation({ name: "review", arguments: "" });

  expect(useRoderStore.getState().busy).toBe(false);
  expect(useRoderStore.getState().error).toBe("command disabled");
  expect(useRoderStore.getState().threadDetails["thread-1"].status).toEqual({
    type: "idle",
    activeTurnId: null,
    activeFlags: [],
  });
});

test("runCommandInvocation restores idle status when command execution omits a turn id", async () => {
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method) => {
    if (method === "commands/run") {
      return { expanded: commandExpanded() };
    }
    return {};
  });
  const useRoderStore = await loadRoderStore(request);
  const thread = threadFixture({});
  useRoderStore.setState({
    activeThreadId: "thread-1",
    selectedWorkspaceCwd: "/workspace",
    threadDetails: { "thread-1": thread },
    threads: [thread],
  });

  await useRoderStore.getState().runCommandInvocation({ name: "review", arguments: "" });

  expect(useRoderStore.getState().busy).toBe(false);
  expect(useRoderStore.getState().error).toBe("roder app-server did not return a command turn");
  expect(useRoderStore.getState().threadDetails["thread-1"].status).toEqual({
    type: "idle",
    activeTurnId: null,
    activeFlags: [],
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function threadFixture(
  patch: Partial<{
    id: string;
    workspaceId: string;
    rootId: string;
    cwd: string;
    status: { type: string; activeTurnId: string | null; activeFlags: string[] };
  }>,
) {
  return {
    id: patch.id ?? "thread-1",
    preview: "Thread",
    modelProvider: "openai",
    model: "gpt-5.5",
    createdAt: 1770000000,
    updatedAt: 1770000100,
    status: patch.status ?? { type: "idle", activeTurnId: null, activeFlags: [] },
    workspaceId: patch.workspaceId,
    rootId: patch.rootId,
    cwd: patch.cwd ?? "/workspace",
    turns: [],
  };
}

function commandExpanded() {
  return {
    command: {
      name: "review",
      description: "Review",
      argument_hint: "[scope]",
      source: "builtin",
      model: null,
      agent: null,
      has_shell_includes: false,
      has_url_includes: false,
    },
    message: "Review",
    context_blocks: [],
    allowed_tools: [],
    model: null,
    agent: null,
  };
}

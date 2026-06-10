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
      openWorkspaceFolders: vi.fn<Window["roderDesktop"]["openWorkspaceFolders"]>(async () => null),
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

test("newProject creates a configured multi-root workspace and starts in the default root", async () => {
  const workspace = {
    id: "ws_multi",
    name: "Monorepo",
    roots: [
      { id: "root_app", path: "/workspace/app", name: "app" },
      { id: "root_api", path: "/workspace/api", name: "api" },
    ],
    defaultRootId: "root_api",
    updatedAt: 1770000200,
  };
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method) => {
    switch (method) {
      case "workspace/create":
        return { workspace };
      case "thread/start":
        return {
          thread: {
            id: "thread-api",
            preview: "Untitled thread",
            modelProvider: "openai",
            model: "gpt-5.5",
            createdAt: 1770000200,
            updatedAt: 1770000200,
            status: { type: "idle", activeTurnId: null, activeFlags: [] },
            workspaceId: workspace.id,
            rootId: workspace.defaultRootId,
            cwd: "/workspace/api",
            turns: [],
          },
          model: "gpt-5.5",
          reasoning: "medium",
        };
      default:
        return {};
    }
  });
  const openWorkspaceFolder = vi.fn<Window["roderDesktop"]["openWorkspaceFolder"]>(async () => {
    throw new Error("legacy folder picker should not open for configured projects");
  });
  const useRoderStore = await loadRoderStore(request, { openWorkspaceFolder });

  useRoderStore.setState({
    activeThreadId: "",
    status: { state: "ready", binary: "test", cwd: "/workspace" },
    selectedWorkspaceCwd: "/workspace",
    models: [{ id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai", isDefault: true }],
    defaultModel: "gpt-5.5",
    selectedModel: "gpt-5.5",
    threadDetails: {},
    threads: [],
    workspaces: [],
  });

  await useRoderStore.getState().newProject({
    name: "Monorepo",
    roots: [{ path: "/workspace/app" }, { path: "/workspace/api" }],
    defaultRootPath: "/workspace/api",
  });

  expect(openWorkspaceFolder).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledWith("workspace/create", {
    name: "Monorepo",
    roots: [{ path: "/workspace/app" }, { path: "/workspace/api" }],
    defaultRootPath: "/workspace/api",
  });
  expect(request).toHaveBeenCalledWith(
    "thread/start",
    expect.objectContaining({
      workspaceId: "ws_multi",
      rootId: "root_api",
      cwd: "/workspace/api",
    }),
  );
  expect(useRoderStore.getState().selectedWorkspaceCwd).toBe("/workspace/api");
  expect(useRoderStore.getState().workspaces[0]?.roots).toHaveLength(2);
});

test("changing selected policy mode applies it to the running thread immediately", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/set_mode") {
      return { mode: (params as { mode: string }).mode };
    }
    return {};
  });
  const useRoderStore = await loadRoderStore(request);

  useRoderStore.setState({ selectedPolicyMode: "default", activeThreadId: "thread-1" });

  await useRoderStore.getState().setSelectedPolicyMode("accept_all");

  expect(useRoderStore.getState().selectedPolicyMode).toBe("accept_all");
  expect(useRoderStore.getState().threadControlsByThread["thread-1"]?.policyMode).toBe("accept_all");
  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "thread/set_mode",
      params: {
        mode: "accept_all",
        reason: "desktop permission selector",
      },
    },
  ]);
});

test("bootstrap does not wait for full active transcript read", async () => {
  const threadReadParams: unknown[] = [];
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method, params) => {
    switch (method) {
      case "thread/list":
        return {
          data: [
            {
              id: "thread-active",
              preview: "Active thread",
              modelProvider: "openai",
              model: "gpt-5.5",
              createdAt: 1770000200,
              updatedAt: 1770000200,
              status: { type: "idle", activeTurnId: null, activeFlags: [] },
              workspaceId: null,
              rootId: null,
              cwd: "/workspace",
            },
          ],
          nextCursor: null,
          backwardsCursor: null,
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
        return { workspaces: [] };
      case "thread/read":
        threadReadParams.push(params);
        return {
          thread: {
            id: "thread-active",
            preview: "Active thread",
            modelProvider: "openai",
            model: "gpt-5.5",
            createdAt: 1770000200,
            updatedAt: 1770000200,
            status: { type: "idle", activeTurnId: null, activeFlags: [] },
            workspaceId: null,
            rootId: null,
            cwd: "/workspace",
          },
        };
      case "thread/goal/get":
        return { goal: null };
      default:
        return {};
    }
  });
  const useRoderStore = await loadRoderStore(request);
  useRoderStore.setState({ activeThreadId: "", threads: [], threadDetails: {} });

  await expect(useRoderStore.getState().bootstrap()).resolves.toBeUndefined();

  expect(useRoderStore.getState().hydrated).toBe(true);
  expect(useRoderStore.getState().busy).toBe(false);
  expect(useRoderStore.getState().activeThreadId).toBe("thread-active");
  await vi.waitFor(() => expect(threadReadParams.length).toBe(1));
  expect(threadReadParams[0]).toEqual({ threadId: "thread-active", includeTurns: false });
});

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

test("staging a new thread keeps the clicked project when a previous thread read finishes late", async () => {
  let resolveThreadRead: ((value: unknown) => void) | undefined;
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>((method) => {
    switch (method) {
      case "thread/read":
        return new Promise((resolve) => {
          resolveThreadRead = resolve;
        });
      case "thread/goal/get":
        return Promise.resolve({ goal: null });
      default:
        return Promise.resolve({});
    }
  });
  const useRoderStore = await loadRoderStore(request);

  useRoderStore.setState({
    activeThreadId: "previous-thread",
    selectedWorkspaceCwd: "/work/previous-project",
    selectedWorkspaceId: "ws-previous",
    selectedRootId: "root-previous",
    threads: [],
    threadDetails: {},
  });

  const selectingPrevious = useRoderStore.getState().selectThread("previous-thread", { pushHistory: false });
  useRoderStore.getState().setSelectedWorkspaceCwd("/work/clicked-project");
  await useRoderStore.getState().selectThread("", { pushHistory: false });

  resolveThreadRead?.({
    thread: {
      id: "previous-thread",
      preview: "Previous thread",
      modelProvider: "openai",
      model: "gpt-5.5",
      createdAt: 1770000100,
      updatedAt: 1770000100,
      status: { type: "idle", activeTurnId: null, activeFlags: [] },
      workspaceId: "ws-previous",
      rootId: "root-previous",
      cwd: "/work/previous-project",
      turns: [],
    },
  });
  await selectingPrevious;

  expect(useRoderStore.getState().activeThreadId).toBe("");
  expect(useRoderStore.getState().selectedWorkspaceCwd).toBe("/work/clicked-project");
  expect(useRoderStore.getState().selectedWorkspaceId).toBe("");
  expect(useRoderStore.getState().selectedRootId).toBe("");
});

test("switching projects after another thread in the same project updates workspace selection immediately", async () => {
  let resolveProjectBRead: ((value: unknown) => void) | undefined;
  const projectAThread1 = storeThread("thread-a-1", "ws-a", "root-a", "/work/project-a");
  const projectAThread2 = storeThread("thread-a-2", "ws-a", "root-a", "/work/project-a");
  const projectBThread1 = storeThread("thread-b-1", "ws-b", "root-b", "/work/project-b");
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>((method, params) => {
    const threadId = (params as { threadId?: string } | undefined)?.threadId;
    if (method === "thread/read" && threadId === "thread-a-2") {
      return Promise.resolve({ thread: projectAThread2 });
    }
    if (method === "thread/read" && threadId === "thread-b-1") {
      return new Promise((resolve) => {
        resolveProjectBRead = resolve;
      });
    }
    if (method === "thread/goal/get") {
      return Promise.resolve({ goal: null });
    }
    return Promise.resolve({});
  });
  const useRoderStore = await loadRoderStore(request);

  useRoderStore.setState({
    activeThreadId: projectAThread1.id,
    selectedWorkspaceCwd: projectAThread1.cwd,
    selectedWorkspaceId: projectAThread1.workspaceId ?? "",
    selectedRootId: projectAThread1.rootId ?? "",
    threads: [projectAThread1, projectAThread2, projectBThread1],
    threadDetails: { [projectAThread1.id]: projectAThread1 },
    workspaces: [
      {
        id: "ws-a",
        name: "project-a",
        roots: [{ id: "root-a", path: "/work/project-a", name: "project-a" }],
        defaultRootId: "root-a",
        updatedAt: 1770000100,
      },
      {
        id: "ws-b",
        name: "project-b",
        roots: [{ id: "root-b", path: "/work/project-b", name: "project-b" }],
        defaultRootId: "root-b",
        updatedAt: 1770000200,
      },
    ],
  });

  await useRoderStore.getState().selectThread(projectAThread2.id, { pushHistory: false });
  const selectingProjectB = useRoderStore.getState().selectThread(projectBThread1.id, { pushHistory: false });

  expect(useRoderStore.getState().activeThreadId).toBe(projectBThread1.id);
  expect(useRoderStore.getState().selectedWorkspaceCwd).toBe(projectBThread1.cwd);
  expect(useRoderStore.getState().selectedWorkspaceId).toBe("ws-b");
  expect(useRoderStore.getState().selectedRootId).toBe("root-b");

  resolveProjectBRead?.({ thread: projectBThread1 });
  await selectingProjectB;
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

test("new blank threads preserve an explicitly selected project folder", async () => {
  const targetCwd = "/workspace/project-b";
  const targetWorkspace = {
    id: "ws_target",
    name: "project-b",
    roots: [{ id: "root_target", path: targetCwd, name: "project-b" }],
    defaultRootId: "root_target",
    updatedAt: 1770000200,
  };
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method) => {
    switch (method) {
      case "workspace/create":
        return { workspace: targetWorkspace };
      case "thread/start":
        return {
          thread: {
            id: "thread-target",
            preview: "Untitled thread",
            modelProvider: "openai",
            model: "gpt-5.5",
            createdAt: 1770000200,
            updatedAt: 1770000200,
            status: { type: "idle", activeTurnId: null, activeFlags: [] },
            workspaceId: targetWorkspace.id,
            rootId: targetWorkspace.defaultRootId,
            cwd: targetCwd,
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
    activeThreadId: "thread-a",
    status: { state: "ready", binary: "test", cwd: "/workspace" },
    selectedWorkspaceCwd: "/workspace/project-a",
    models: [{ id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai", isDefault: true }],
    defaultModel: "gpt-5.5",
    selectedModel: "gpt-5.5",
    threadDetails: {
      "thread-a": {
        id: "thread-a",
        preview: "Project A",
        modelProvider: "openai",
        model: "gpt-5.5",
        createdAt: 1770000100,
        updatedAt: 1770000100,
        status: { type: "idle", activeTurnId: null, activeFlags: [] },
        cwd: "/workspace/project-a",
        turns: [],
      },
    },
    workspaces: [],
  });

  useRoderStore.getState().setSelectedWorkspaceCwd(targetCwd);
  await useRoderStore.getState().selectThread("", { pushHistory: false });
  await useRoderStore.getState().newThread();

  expect(request).toHaveBeenCalledWith("workspace/create", {
    roots: [{ path: targetCwd }],
    defaultRootPath: targetCwd,
  });
  expect(request).toHaveBeenCalledWith(
    "thread/start",
    expect.objectContaining({
      workspaceId: targetWorkspace.id,
      rootId: targetWorkspace.defaultRootId,
    }),
  );
});

test("new threads preserve the Auto default selection in thread/start", async () => {
  const workspace = {
    id: "ws-1",
    name: "workspace",
    roots: [{ id: "root-1", path: "/workspace", name: "workspace" }],
    defaultRootId: "root-1",
    updatedAt: 1770000200,
  };
  const selectionMode = {
    type: "auto" as const,
    optionId: "local:coding",
    routerId: "local",
    label: "Auto: Coding",
    baseline: { provider: "openai", model: "gpt-5.5" },
  };
  const wireSelectionMode = {
    type: "auto",
    option_id: "local:coding",
    router_id: "local",
    label: "Auto: Coding",
    baseline: { provider: "openai", model: "gpt-5.5" },
  };
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method) => {
    switch (method) {
      case "workspace/create":
        return { workspace };
      case "thread/start":
        return {
          thread: {
            id: "thread-auto",
            preview: "Untitled thread",
            modelProvider: "openai",
            model: "gpt-5.5",
            selectionMode: wireSelectionMode,
            createdAt: 1770000200,
            updatedAt: 1770000200,
            status: { type: "idle", activeTurnId: null, activeFlags: [] },
            workspaceId: workspace.id,
            rootId: workspace.defaultRootId,
            cwd: "/workspace",
            turns: [],
          },
          model: "gpt-5.5",
          modelProvider: "openai",
          reasoning: "medium",
          selectionMode: wireSelectionMode,
        };
      default:
        return {};
    }
  });
  const useRoderStore = await loadRoderStore(request);
  useRoderStore.setState({
    activeThreadId: "",
    status: { state: "ready", binary: "test", cwd: "/workspace" },
    selectedWorkspaceCwd: "/workspace",
    models: [{ id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai", isDefault: true }],
    defaultModel: "gpt-5.5",
    defaultModelProvider: "openai",
    defaultSelectionMode: selectionMode,
    defaultReasoning: "medium",
    workspaces: [],
  });

  await useRoderStore.getState().newThread();

  expect(request).toHaveBeenCalledWith(
    "thread/start",
    expect.objectContaining({
      selection: { type: "auto", option_id: "local:coding" },
    }),
  );
  expect(useRoderStore.getState().selectedSelectionMode).toEqual(selectionMode);
});

test("new threads do not send malformed Auto defaults without an option id", async () => {
  const workspace = {
    id: "ws-1",
    name: "workspace",
    roots: [{ id: "root-1", path: "/workspace", name: "workspace" }],
    defaultRootId: "root-1",
    updatedAt: 1770000200,
  };
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method) => {
    switch (method) {
      case "workspace/create":
        return { workspace };
      case "thread/start":
        return {
          thread: {
            id: "thread-manual",
            preview: "Untitled thread",
            modelProvider: "openai",
            model: "gpt-5.5",
            createdAt: 1770000200,
            updatedAt: 1770000200,
            status: { type: "idle", activeTurnId: null, activeFlags: [] },
            workspaceId: workspace.id,
            rootId: workspace.defaultRootId,
            cwd: "/workspace",
            turns: [],
          },
          model: "gpt-5.5",
          modelProvider: "openai",
          reasoning: "medium",
        };
      default:
        return {};
    }
  });
  const useRoderStore = await loadRoderStore(request);
  useRoderStore.setState({
    activeThreadId: "",
    status: { state: "ready", binary: "test", cwd: "/workspace" },
    selectedWorkspaceCwd: "/workspace",
    models: [{ id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai", isDefault: true }],
    defaultModel: "gpt-5.5",
    defaultModelProvider: "openai",
    defaultSelectionMode: {
      type: "auto",
      routerId: "local",
      label: "Auto: Coding",
      baseline: { provider: "openai", model: "gpt-5.5" },
    } as never,
    defaultReasoning: "medium",
    workspaces: [],
  });

  await useRoderStore.getState().newThread();

  expect(request).toHaveBeenCalledWith(
    "thread/start",
    expect.objectContaining({
      selection: { type: "manual", provider: "openai", model: "gpt-5.5", reasoning: "medium" },
    }),
  );
  expect(useRoderStore.getState().selectedSelectionMode).toEqual({
    type: "manual",
    provider: "openai",
    model: "gpt-5.5",
    reasoning: "medium",
  });
});

test("saveDefaults saves Auto routing through model/select", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const selectionMode = {
    type: "auto" as const,
    optionId: "local:coding",
    routerId: "local",
    label: "Auto: Coding",
    baseline: { provider: "openai", model: "gpt-5.5" },
  };
  const wireSelectionMode = {
    type: "auto",
    option_id: "local:coding",
    router_id: "local",
    label: "Auto: Coding",
    baseline: { provider: "openai", model: "gpt-5.5" },
  };
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method, params) => {
    calls.push({ method, params });
    if (method === "model/select") {
      return {
        selectionMode: wireSelectionMode,
        provider: "openai",
        model: "gpt-5.5",
        reasoning: "medium",
      };
    }
    if (method === "settings/set_default_mode") {
      return { default_mode: "accept_all" };
    }
    return {};
  });
  const useRoderStore = await loadRoderStore(request);
  useRoderStore.setState({
    models: [{ id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai", isDefault: true }],
    defaultModel: "gpt-5.5",
    defaultModelProvider: "openai",
    defaultSelectionMode: selectionMode,
    defaultReasoning: "medium",
    defaultPolicyMode: "accept_all",
  });

  await useRoderStore.getState().saveDefaults();

  expect(calls).toEqual([
    {
      method: "model/select",
      params: {
        selection: { type: "auto", option_id: "local:coding" },
      },
    },
    {
      method: "settings/set_default_mode",
      params: { mode: "accept_all" },
    },
  ]);
});

test("setSelectedAutoModel applies the canonical app-server selection response", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const selectionMode = {
    type: "auto" as const,
    optionId: "local:coding",
    routerId: "local",
    label: "Auto: Coding",
    baseline: { provider: "openai", model: "gpt-5.5" },
  };
  const wireSelectionMode = {
    type: "auto",
    option_id: "local:coding",
    router_id: "local",
    label: "Auto: Coding",
    baseline: { provider: "openai", model: "gpt-5.5" },
  };
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method, params) => {
    calls.push({ method, params });
    if (method === "model/select") {
      return {
        selectionMode: wireSelectionMode,
        provider: "openai",
        model: "gpt-5.5",
        reasoning: "low",
      };
    }
    return {};
  });
  const useRoderStore = await loadRoderStore(request);

  useRoderStore.setState({
    activeThreadId: "thread-1",
    selectedReasoning: "low",
    routingOptions: [
      {
        id: "local:coding",
        label: "Auto: Coding",
        routerId: "local",
        baseline: { provider: "openai", model: "gpt-5.5" },
      },
    ],
    models: [{ id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai", isDefault: true }],
  });

  await useRoderStore.getState().setSelectedAutoModel("local:coding");

  expect(calls).toContainEqual({
    method: "model/select",
    params: {
      threadId: "thread-1",
      selection: { type: "auto", option_id: "local:coding" },
    },
  });
  expect(useRoderStore.getState().selectedSelectionMode).toEqual(selectionMode);
});

test("sendPrompt starts a blank thread with the selected Auto routing option", async () => {
  const workspace = {
    id: "ws-1",
    name: "workspace",
    roots: [{ id: "root-1", path: "/workspace", name: "workspace" }],
    defaultRootId: "root-1",
    updatedAt: 1770000200,
  };
  const selectedSelectionMode = {
    type: "auto" as const,
    optionId: "local:coding",
    routerId: "local",
    label: "Auto: Coding",
    baseline: { provider: "openai", model: "gpt-5.5" },
  };
  const wireSelectionMode = {
    type: "auto",
    option_id: "local:coding",
    router_id: "local",
    label: "Auto: Coding",
    baseline: { provider: "openai", model: "gpt-5.5" },
  };
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method) => {
    switch (method) {
      case "workspace/create":
        return { workspace };
      case "thread/start":
        return {
          thread: {
            id: "thread-auto",
            preview: "Untitled thread",
            modelProvider: "openai",
            model: "gpt-5.5",
            selectionMode: wireSelectionMode,
            createdAt: 1770000200,
            updatedAt: 1770000200,
            status: { type: "idle", activeTurnId: null, activeFlags: [] },
            workspaceId: workspace.id,
            rootId: workspace.defaultRootId,
            cwd: "/workspace",
            turns: [],
          },
          model: "gpt-5.5",
          modelProvider: "openai",
          reasoning: "low",
          selectionMode: wireSelectionMode,
        };
      default:
        return {};
    }
  });
  const useRoderStore = await loadRoderStore(request);

  useRoderStore.setState({
    activeThreadId: "",
    status: { state: "ready", binary: "test", cwd: "/workspace" },
    selectedWorkspaceCwd: "/workspace",
    selectedModel: "gpt-5.5",
    selectedModelProvider: "openai",
    selectedSelectionMode,
    selectedReasoning: "low",
    defaultModel: "gpt-5.4-mini",
    defaultModelProvider: "openai",
    defaultSelectionMode: {
      type: "manual",
      provider: "openai",
      model: "gpt-5.4-mini",
      reasoning: "medium",
    },
    defaultReasoning: "medium",
    workspaces: [],
  });

  await useRoderStore.getState().sendPrompt("route this automatically");

  expect(request).toHaveBeenCalledWith(
    "thread/start",
    expect.objectContaining({
      model: "gpt-5.5",
      reasoning: "low",
      selection: { type: "auto", option_id: "local:coding" },
      initialPrompt: "route this automatically",
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

test("sendPrompt leaves model selection to the app-server when Auto routing is active", async () => {
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method) => {
    if (method === "turn/start") {
      return { turnId: "turn-2" };
    }
    return {};
  });
  const useRoderStore = await loadRoderStore(request);
  const selectionMode = {
    type: "auto" as const,
    optionId: "local:coding",
    routerId: "local",
    label: "Auto: Coding",
    baseline: { provider: "openai", model: "gpt-5.5" },
  };
  const thread = {
    id: "thread-1",
    preview: "Auto thread",
    modelProvider: "openai",
    model: "gpt-5.5",
    selectionMode,
    createdAt: 1770000000,
    updatedAt: 1770000100,
    status: { type: "idle", activeTurnId: null, activeFlags: [] },
    cwd: "/workspace",
    turns: [],
  };

  useRoderStore.setState({
    activeThreadId: "thread-1",
    busy: false,
    selectedModel: "gpt-5.5",
    selectedModelProvider: "openai",
    selectedSelectionMode: selectionMode,
    selectedReasoning: "high",
    selectedPolicyMode: "plan",
    models: [{ id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai", isDefault: true }],
    threadDetails: { "thread-1": thread },
    threads: [thread],
  });

  await useRoderStore.getState().sendPrompt("continue from here");

  expect(request).toHaveBeenCalledWith("turn/start", {
    threadId: "thread-1",
    input: [{ type: "text", text: "continue from here" }],
    policyMode: "plan",
  });
});

test("sendPrompt sends manual overrides when Auto state is not configured", async () => {
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method) => {
    if (method === "turn/start") {
      return { turnId: "turn-2" };
    }
    return {};
  });
  const useRoderStore = await loadRoderStore(request);
  const thread = {
    id: "thread-1",
    preview: "Manual thread",
    modelProvider: "openai",
    model: "gpt-5.5",
    createdAt: 1770000000,
    updatedAt: 1770000100,
    status: { type: "idle", activeTurnId: null, activeFlags: [] },
    cwd: "/workspace",
    turns: [],
  };

  useRoderStore.setState({
    activeThreadId: "thread-1",
    busy: false,
    selectedModel: "gpt-5.5",
    selectedModelProvider: "openai",
    selectedSelectionMode: {
      type: "auto",
      routerId: "local",
      label: "Auto: Coding",
      baseline: { provider: "openai", model: "gpt-5.5" },
    } as never,
    selectedReasoning: "high",
    selectedPolicyMode: "plan",
    models: [{ id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai", isDefault: true }],
    threadDetails: { "thread-1": thread },
    threads: [thread],
  });

  await useRoderStore.getState().sendPrompt("continue from here");

  expect(request).toHaveBeenCalledWith("turn/start", {
    threadId: "thread-1",
    input: [{ type: "text", text: "continue from here" }],
    modelProvider: "openai",
    model: "gpt-5.5",
    reasoning: "high",
    policyMode: "plan",
  });
});

test("sendPrompt immediately labels an untitled blank thread from the first prompt", async () => {
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method) => {
    if (method === "turn/start") {
      return { turnId: "turn-1" };
    }
    return {};
  });
  const useRoderStore = await loadRoderStore(request);
  const thread = {
    id: "thread-untitled",
    preview: "Untitled thread",
    modelProvider: "openai",
    model: "gpt-5.5",
    createdAt: 1770000000,
    updatedAt: 1770000100,
    status: { type: "idle", activeTurnId: null, activeFlags: [] },
    cwd: "/workspace",
    turns: [],
  };

  useRoderStore.setState({
    activeThreadId: "thread-untitled",
    busy: false,
    selectedModel: "gpt-5.5",
    selectedModelProvider: "openai",
    selectedReasoning: "medium",
    selectedPolicyMode: "accept_all",
    models: [{ id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai", isDefault: true }],
    threadDetails: { "thread-untitled": thread },
    threads: [thread],
  });

  await useRoderStore.getState().sendPrompt("fix the failing desktop tests");

  expect(useRoderStore.getState().threads[0]?.name).toBe("fix the failing desktop tests");
  expect(useRoderStore.getState().threads[0]?.preview).toBe("fix the failing desktop tests");
  expect(useRoderStore.getState().threadDetails["thread-untitled"]?.name).toBe("fix the failing desktop tests");
});

test("prompt-created threads use the first prompt as an immediate optimistic title", async () => {
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method) => {
    switch (method) {
      case "thread/start":
        return {
          thread: {
            id: "thread-new",
            preview: "Untitled thread",
            modelProvider: "openai",
            model: "gpt-5.5",
            createdAt: 1770000000,
            updatedAt: 1770000100,
            status: { type: "idle", activeTurnId: null, activeFlags: [] },
            workspaceId: "ws_1",
            rootId: "root_1",
            cwd: "/workspace",
            turns: [],
          },
          model: "gpt-5.5",
          reasoning: "medium",
        };
      case "turn/start":
        return { turnId: "turn-1" };
      default:
        return {};
    }
  });
  const useRoderStore = await loadRoderStore(request);

  useRoderStore.setState({
    activeThreadId: "",
    busy: false,
    selectedWorkspaceId: "ws_1",
    selectedRootId: "root_1",
    selectedWorkspaceCwd: "/workspace",
    defaultModel: "gpt-5.5",
    defaultModelProvider: "openai",
    defaultReasoning: "medium",
    defaultPolicyMode: "accept_all",
    selectedModel: "gpt-5.5",
    selectedModelProvider: "openai",
    models: [{ id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai", isDefault: true }],
    workspaces: [
      {
        id: "ws_1",
        name: "workspace",
        roots: [{ id: "root_1", path: "/workspace", name: "workspace" }],
        defaultRootId: "root_1",
        updatedAt: 1770000000,
      },
    ],
    threads: [],
    threadDetails: {},
  });

  await useRoderStore.getState().sendPrompt("summarize the project architecture");

  expect(useRoderStore.getState().activeThreadId).toBe("thread-new");
  expect(useRoderStore.getState().threads[0]?.name).toBe("summarize the project architecture");
  expect(useRoderStore.getState().threadDetails["thread-new"]?.preview).toBe("summarize the project architecture");
});

test("untitled thread notifications do not clobber an optimistic first-prompt title", async () => {
  const useRoderStore = await loadRoderStore();
  const optimisticThread = {
    id: "thread-optimistic",
    name: "fix the resize handle",
    preview: "fix the resize handle",
    modelProvider: "openai",
    model: "gpt-5.5",
    createdAt: 1770000000,
    updatedAt: 1770000100,
    status: { type: "running", activeTurnId: "turn-1", activeFlags: [] },
    cwd: "/workspace",
    turns: [],
  };

  useRoderStore.setState({
    activeThreadId: "thread-optimistic",
    threads: [optimisticThread],
    threadDetails: { "thread-optimistic": optimisticThread },
  });

  useRoderStore.getState().applyNotification({
    method: "thread/updated",
    params: {
      thread: {
        id: "thread-optimistic",
        preview: "Untitled thread",
        modelProvider: "openai",
        model: "gpt-5.5",
        createdAt: 1770000000,
        updatedAt: 1770000200,
        status: { type: "running", activeTurnId: "turn-1", activeFlags: [] },
        cwd: "/workspace",
        turns: [],
      },
    },
  });

  expect(useRoderStore.getState().threads[0]?.name).toBe("fix the resize handle");
  expect(useRoderStore.getState().threads[0]?.preview).toBe("fix the resize handle");
  expect(useRoderStore.getState().threads[0]?.updatedAt).toBe(1770000200);
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

function storeThread(id: string, workspaceId: string, rootId: string, cwd: string) {
  return {
    id,
    preview: id,
    modelProvider: "openai",
    model: "gpt-5.5",
    createdAt: 1770000100,
    updatedAt: 1770000100,
    status: { type: "idle", activeTurnId: null, activeFlags: [] },
    workspaceId,
    rootId,
    cwd,
    turns: [],
  };
}

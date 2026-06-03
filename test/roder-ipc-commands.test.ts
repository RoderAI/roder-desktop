import { expect, test, vi } from "vitest";

async function loadRoderIpc(request: (method: string, params: unknown) => Promise<unknown>) {
  vi.resetModules();
  globalThis.window = {
    roderDesktop: {
      request,
      onNotification: () => () => undefined,
      onStderr: () => () => undefined,
    },
  } as unknown as Window & typeof globalThis;
  return (await import("../src/lib/roder-ipc")).roderIpc;
}

test("listCommands requests the slash command catalog", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return { commands: [] };
  });

  const result = await roderIpc.listCommands();

  expect(result).toEqual({ commands: [] });
  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "commands/list",
      params: {},
    },
  ]);
});

test("runCommand starts a command turn with thread, arguments, and workspace", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return {
      turn_id: "turn-1",
      expanded: {
        command: {
          name: "review",
          description: "Review current changes",
          argument_hint: "[scope]",
          source: "builtin",
          model: null,
          agent: null,
          has_shell_includes: false,
          has_url_includes: false,
        },
        message: "Review current changes",
        context_blocks: [contextBlock()],
        allowed_tools: [],
        model: null,
        agent: null,
      },
    };
  });

  const result = await roderIpc.runCommand({
    threadId: "thread-1",
    name: "review",
    arguments: "api",
    workspace: "/workspace",
  });

  expect(result.expanded.context_blocks).toEqual([contextBlock()]);
  expect(JSON.parse(JSON.stringify(calls))).toEqual([
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
});

test("runCommand omits optional workspace when absent", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return {
      turn_id: "turn-1",
      expanded: {
        command: {
          name: "review",
          description: null,
          argument_hint: null,
          source: "builtin",
          model: null,
          agent: null,
          has_shell_includes: false,
          has_url_includes: false,
        },
        message: "Review",
        context_blocks: [contextBlock()],
        allowed_tools: [],
        model: null,
        agent: null,
      },
    };
  });

  await roderIpc.runCommand({ threadId: "thread-1", name: "review", arguments: "" });

  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "commands/run",
      params: {
        thread_id: "thread-1",
        name: "review",
        arguments: "",
      },
    },
  ]);
});

test("listAgents requests the configured subagent catalog", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return { agents: [] };
  });

  const result = await roderIpc.listAgents();

  expect(result).toEqual({ agents: [] });
  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "agents/list",
      params: {},
    },
  ]);
});

test("listTasks requests background tasks", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return { tasks: [] };
  });

  const result = await roderIpc.listTasks();

  expect(result).toEqual({ tasks: [] });
  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "tasks/list",
      params: {},
    },
  ]);
});

test("getTask requests a task and its logs", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return { task: taskHandle(), logs: [], dropped_bytes: 0 };
  });

  const result = await roderIpc.getTask("task-1");

  expect(result.task.task_id).toBe("task-1");
  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "tasks/get",
      params: { task_id: "task-1" },
    },
  ]);
});

test("listProcesses requests active or completed process rows", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return { processes: [] };
  });

  await roderIpc.listProcesses();
  await roderIpc.listProcesses(true);

  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "processes/list",
      params: { includeCompleted: false },
    },
    {
      method: "processes/list",
      params: { includeCompleted: true },
    },
  ]);
});

test("stopProcess requests a process stop with an optional reason", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return { result: { processId: "proc-1", stopped: true } };
  });

  const result = await roderIpc.stopProcess("proc-1", "requested by test");

  expect(result.result.stopped).toBe(true);
  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "processes/stop",
      params: { processId: "proc-1", reason: "requested by test" },
    },
  ]);
});

test("stopAllProcesses requests a bulk process stop", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return { results: [{ processId: "proc-1", stopped: true }] };
  });

  const result = await roderIpc.stopAllProcesses("requested by test");

  expect(result.results).toHaveLength(1);
  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "processes/stopAll",
      params: { reason: "requested by test" },
    },
  ]);
});

function contextBlock() {
  return {
    id: "context-1",
    kind: "Instruction",
    text: "Use the workspace context.",
    priority: 10,
    token_estimate: 5,
    metadata: { source: "test" },
  };
}

function taskHandle() {
  return {
    task_id: "task-1",
    executor_id: "executor-1",
    spec: {
      kind: "code-review",
      description: "Review current changes",
      input_schema: {},
      metadata: {},
    },
    state: "running",
    created_at: "2026-06-03T10:00:00Z",
    started_at: "2026-06-03T10:00:01Z",
    finished_at: null,
  };
}

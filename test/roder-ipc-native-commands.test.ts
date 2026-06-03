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

test("native command IPC wrappers call agent and task methods", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    if (method === "agents/list") {
      return { agents: [] };
    }
    if (method === "tasks/list") {
      return { tasks: [] };
    }
    if (method === "tasks/get") {
      return { task: null, logs: [], dropped_bytes: 0 };
    }
    return {};
  });

  await roderIpc.listAgents();
  await roderIpc.listTasks();
  await roderIpc.getTask("task-1");

  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    { method: "agents/list", params: {} },
    { method: "tasks/list", params: {} },
    { method: "tasks/get", params: { task_id: "task-1" } },
  ]);
});

test("native command IPC wrappers call process methods with camelCase params", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    if (method === "processes/list") {
      return { processes: [] };
    }
    if (method === "processes/stop") {
      return { result: { processId: "proc-1", stopped: true } };
    }
    if (method === "processes/stopAll") {
      return { results: [] };
    }
    return {};
  });

  await roderIpc.listProcesses(true);
  await roderIpc.stopProcess("proc-1", "test stop");
  await roderIpc.stopAllProcesses("test stop all");

  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    { method: "processes/list", params: { includeCompleted: true } },
    { method: "processes/stop", params: { processId: "proc-1", reason: "test stop" } },
    { method: "processes/stopAll", params: { reason: "test stop all" } },
  ]);
});

import { expect, test, vi } from "vitest";

async function loadRoderIpc(request) {
  vi.resetModules();
  globalThis.window = {
    roderDesktop: {
      request,
      onNotification: () => () => undefined,
      onStderr: () => () => undefined,
    },
  };
  return (await import("../src/lib/roder-ipc")).roderIpc;
}

test("threadState reads the live policy mode from the app-server", async () => {
  const calls = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return { mode: "plan", pendingPlanExit: null };
  });

  const result = await roderIpc.threadState();

  expect(result).toEqual({ mode: "plan", pendingPlanExit: null });
  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "thread/state",
      params: {},
    },
  ]);
});

test("threadGoal reads the durable goal for a thread", async () => {
  const calls = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return {
      goal: {
        threadId: params.threadId,
        objective: "Ship the header goal signal",
        status: "active",
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: "2026-05-30T12:00:00Z",
        updatedAt: "2026-05-30T12:00:00Z",
      },
    };
  });

  const result = await roderIpc.threadGoal("thread-1");

  expect(result.goal?.objective).toBe("Ship the header goal signal");
  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "thread/goal/get",
      params: {
        threadId: "thread-1",
      },
    },
  ]);
});

test("setThreadMode sends the policy mode wire value to the app-server", async () => {
  const calls = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return { mode: params.mode };
  });

  const result = await roderIpc.setThreadMode("accept_all", "desktop permission selector");

  expect(result).toEqual({ mode: "accept_all" });
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

test("default settings use provider and settings protocol methods", async () => {
  const calls = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    if (method === "providers/select") {
      return { provider: params.provider, model: params.model, reasoning: params.reasoning };
    }
    return { default_mode: params.mode };
  });

  await roderIpc.selectProviderDefaults("openai", "gpt-5.5", "high");
  await roderIpc.setDefaultMode("plan");

  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "providers/select",
      params: {
        provider: "openai",
        model: "gpt-5.5",
        reasoning: "high",
      },
    },
    {
      method: "settings/set_default_mode",
      params: {
        mode: "plan",
      },
    },
  ]);
});

test("startTurn sends selected controls with the next turn", async () => {
  const calls = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return { turnId: "turn-1" };
  });

  const result = await roderIpc.startTurn("thread-1", "hello", [], {
    modelProvider: "mock",
    model: "gpt-5.5",
    reasoning: "high",
    policyMode: "plan",
  });

  expect(result).toEqual({ turnId: "turn-1" });
  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "turn/start",
      params: {
        threadId: "thread-1",
        input: [{ type: "text", text: "hello" }],
        modelProvider: "mock",
        model: "gpt-5.5",
        reasoning: "high",
        policyMode: "plan",
      },
    },
  ]);
});

test("startTurn sends canvas image attachments as image input", async () => {
  const calls = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return { turnId: "turn-1" };
  });

  await roderIpc.startTurn(
    "thread-1",
    "clean this sketch up",
    [
      {
        id: "attachment-1",
        name: "canvas.png",
        path: "/tmp/roder-desktop-canvas/canvas.png",
        type: "image/png",
        size: 12,
        imageUrl: "data:image/png;base64,YWJj",
        source: "canvas",
      },
    ],
    {
      modelProvider: "mock",
      model: "gpt-5.5",
      reasoning: "high",
      policyMode: "plan",
    },
  );

  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "turn/start",
      params: {
        threadId: "thread-1",
        input: [
          { type: "text", text: "clean this sketch up" },
          { type: "image", imageUrl: "data:image/png;base64,YWJj" },
        ],
        modelProvider: "mock",
        model: "gpt-5.5",
        reasoning: "high",
        policyMode: "plan",
      },
    },
  ]);
});

test("steerTurn sends canvas image attachments as image input", async () => {
  const calls = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return { turnId: "turn-1" };
  });

  await roderIpc.steerTurn("thread-1", "turn-1", "also use this sketch", [
    {
      id: "attachment-1",
      name: "canvas.png",
      path: "/tmp/roder-desktop-canvas/canvas.png",
      type: "image/png",
      size: 12,
      imageUrl: "data:image/png;base64,YWJj",
      source: "canvas",
    },
  ]);

  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "turn/steer",
      params: {
        threadId: "thread-1",
        expectedTurnId: "turn-1",
        input: [
          { type: "text", text: "also use this sketch" },
          { type: "image", imageUrl: "data:image/png;base64,YWJj" },
        ],
      },
    },
  ]);
});

test("startThread sends the first prompt so the app-server can name immediately", async () => {
  const calls = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return {
      thread: { id: "thread-1", preview: "Untitled thread" },
      model: params.model,
      modelProvider: params.modelProvider,
      reasoning: params.reasoning,
      workspaceId: params.workspaceId,
      rootId: params.rootId,
      cwd: "/workspace",
    };
  });

  await roderIpc.startThread("gpt-5.5", { workspaceId: "ws_1", rootId: "root_1" }, "openai", "high", {
    initialPrompt: "fix the tests",
  });

  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "thread/start",
      params: {
        workspaceId: "ws_1",
        rootId: "root_1",
        model: "gpt-5.5",
        modelProvider: "openai",
        reasoning: "high",
        ephemeral: false,
        initialPrompt: "fix the tests",
      },
    },
  ]);
});

test("wait request resolvers use thread protocol methods and camelCase params", async () => {
  const calls = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return { resolved: true };
  });

  await roderIpc.resolveApproval({ approvalId: "approval-1", approved: false });
  await roderIpc.resolveUserInput({ requestId: "input-1", answers: { mode: "Default" } });
  await roderIpc.exitPlan({ requestId: "plan-1", approved: true });

  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "thread/resolve_approval",
      params: {
        approvalId: "approval-1",
        approved: false,
      },
    },
    {
      method: "thread/resolve_user_input",
      params: {
        requestId: "input-1",
        answers: { mode: "Default" },
      },
    },
    {
      method: "thread/exit_plan",
      params: {
        requestId: "plan-1",
        approved: true,
      },
    },
  ]);
});

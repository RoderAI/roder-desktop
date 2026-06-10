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

test("createGoal calls the workflow tool directly for a thread", async () => {
  const calls = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return { text: "Goal active", data: {}, is_error: false };
  });

  const result = await roderIpc.createGoal("thread-1", "Ship desktop /goal");

  expect(result.is_error).toBe(false);
  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "tools/call",
      params: {
        thread_id: "thread-1",
        tool_name: "create_goal",
        arguments: { objective: "Ship desktop /goal" },
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

test("provider list reads routing options without flattening them into models", async () => {
  const calls = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return {
      active_provider: "openai",
      active_model: "gpt-5.5",
      active_reasoning: "medium",
      selectionMode: {
        type: "auto",
        option_id: "local:coding",
        router_id: "local",
        label: "Auto: Coding",
        baseline: { provider: "openai", model: "gpt-5.5" },
      },
      routingOptions: [
        {
          id: "local:coding",
          label: "Auto: Coding",
          routerId: "local",
          baseline: { provider: "openai", model: "gpt-5.5" },
        },
      ],
      providers: [
        {
          id: "openai",
          name: "OpenAI",
          authenticated: true,
          recommended: true,
          auth_type: "api_key",
          auth_label: "OPENAI_API_KEY",
          auth_detail: "Configured",
          sort_order: 10,
          models: [],
        },
      ],
    };
  });

  const result = await roderIpc.listProviders();

  expect(result.routingOptions).toHaveLength(1);
  expect(result.providers[0]).toMatchObject({
    id: "openai",
    authType: "api_key",
    authLabel: "OPENAI_API_KEY",
    authDetail: "Configured",
    sortOrder: 10,
  });
  expect(result.providers[0]).not.toHaveProperty("auth_type");
  expect(result.providers[0]).not.toHaveProperty("auth_label");
  expect(result.providers[0]).not.toHaveProperty("auth_detail");
  expect(result.providers[0]).not.toHaveProperty("sort_order");
  expect(result.selectionMode?.type).toBe("auto");
  expect(result.selectionMode).toEqual({
    type: "auto",
    optionId: "local:coding",
    routerId: "local",
    label: "Auto: Coding",
    baseline: { provider: "openai", model: "gpt-5.5" },
  });
  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "providers/list",
      params: {},
    },
  ]);
});

test("model selection sends typed manual and auto choices to the app-server", async () => {
  const calls = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    const selectionMode =
      params.selection.type === "auto"
        ? {
            type: "auto",
            option_id: params.selection.option_id,
            router_id: "local",
            label: "Auto: Coding",
            baseline: { provider: "openai", model: "gpt-5.5" },
          }
        : params.selection;
    return {
      selectionMode,
      provider: params.selection.type === "auto" ? "openai" : params.selection.provider,
      model: params.selection.type === "auto" ? "gpt-5.5" : params.selection.model,
      reasoning: params.selection.reasoning ?? "medium",
    };
  });

  await roderIpc.selectModel({ type: "manual", provider: "openai", model: "gpt-5.5", reasoning: "high" });
  await roderIpc.selectModel({ type: "auto", optionId: "local:coding" }, "thread-1");

  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "model/select",
      params: {
        selection: { type: "manual", provider: "openai", model: "gpt-5.5", reasoning: "high" },
      },
    },
    {
      method: "model/select",
      params: {
        threadId: "thread-1",
        selection: { type: "auto", option_id: "local:coding" },
      },
    },
  ]);
});

test("model selection treats auto responses without option ids as manual baseline selections", async () => {
  const roderIpc = await loadRoderIpc(async () => ({
    selectionMode: {
      type: "auto",
      router_id: "local",
      label: "Auto: Coding",
      baseline: { provider: "openai", model: "gpt-5.5" },
    },
    provider: "openai",
    model: "gpt-5.5",
    reasoning: "medium",
  }));

  const result = await roderIpc.selectModel({
    type: "manual",
    provider: "openai",
    model: "gpt-5.5",
    reasoning: "medium",
  });

  expect(result.selectionMode).toEqual({
    type: "manual",
    provider: "openai",
    model: "gpt-5.5",
    reasoning: null,
  });
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

import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { persistentAgentToolDefinitions, createPersistentAgentService } from "../electron/persistent-agents/service";
import type { PersistentAgentDetail } from "../src/types/persistent-agents";
import type { createPersistentAgentSpriteManager } from "../electron/persistent-agents/sprites";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
async function setup(sprites?: ReturnType<typeof createPersistentAgentSpriteManager>) {
  const directory = await mkdtemp(join(tmpdir(), "persistentAgent-test-"));
  directories.push(directory);
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(
    async (method: string): Promise<unknown> => {
      if (method === "thread/start") return { thread: { id: "thread-1" } };
      if (method === "thread/read") return { thread: { id: "thread-1", status: { type: "idle" }, turns: [] } };
      if (method === "memory/query") return { results: [] };
      if (method === "turn/start") return { turnId: "turn-1" };
      return {};
    },
  );
  const service = createPersistentAgentService({ directory, request, sprites });
  await service.start();
  const persistentAgent = (await service.handleRequest("desktop/persistent-agents/create", {
    name: "Release",
    mission: "Watch releases",
    workspaceId: "ws",
  })) as PersistentAgentDetail;
  return { service, persistentAgent, request, directory };
}

test("creates paused with a background sprite job and scopes image reads and retries to existing agents", async () => {
  const sprite = {
    agentId: "example",
    status: "needs_credentials",
    attempts: 1,
    updatedAt: 1,
    error: "Image API key missing",
    asset: null,
  } as const;
  const enqueue = vi.fn<(persona: unknown) => Promise<unknown>>().mockResolvedValue(sprite);
  const retry = vi.fn<(persona: unknown) => Promise<unknown>>().mockResolvedValue({ ...sprite, status: "queued" });
  const read = vi.fn<(id: string) => Promise<unknown>>().mockResolvedValue(null);
  const sprites = {
    initialize: async () => {},
    get: () => sprite,
    enqueue,
    retry,
    read,
    stop: () => {},
  } as unknown as ReturnType<typeof createPersistentAgentSpriteManager>;
  const { service, persistentAgent } = await setup(sprites);
  expect(persistentAgent.enabled).toBe(false);
  expect(enqueue).toHaveBeenCalledWith(
    expect.objectContaining({ id: persistentAgent.id, name: "Release", mission: "Watch releases" }),
  );
  expect(persistentAgent.sprite?.status).toBe("needs_credentials");
  expect(await service.handleRequest("desktop/persistent-agents/sprite/read", { id: persistentAgent.id })).toEqual({
    sprite,
    image: null,
  });
  expect(
    await service.handleRequest("desktop/persistent-agents/sprite/retry", { id: persistentAgent.id }),
  ).toMatchObject({ status: "queued" });
  await expect(service.handleRequest("desktop/persistent-agents/sprite/read", { id: "../outside" })).rejects.toThrow(
    /not found/i,
  );
  expect(read).toHaveBeenCalledTimes(1);
  await service.stop();
});

test("creates a real thread, starts paused and preserves editable memory across restart", async () => {
  const { service, persistentAgent, directory, request } = await setup();
  expect(persistentAgent.enabled).toBe(false);
  await service.handleRequest("desktop/persistent-agents/update", {
    id: persistentAgent.id,
    memory: "Keep the release checklist.",
  });
  await service.tick();
  expect(request.mock.calls.filter(([m]) => m === "turn/start")).toHaveLength(0);
  await service.stop();
  const recovered = createPersistentAgentService({ directory, request });
  await recovered.start();
  const detail = (await recovered.handleRequest("desktop/persistent-agents/read", {
    id: persistentAgent.id,
  })) as PersistentAgentDetail;
  expect(detail.threadId).toBe(persistentAgent.threadId);
  expect(detail.memory).toBe("Keep the release checklist.");
  expect(await readFile(detail.memoryPath, "utf8")).toBe(detail.memory);
  await recovered.stop();
});

test("daily run allowances must be whole counts", async () => {
  const { service, persistentAgent } = await setup();
  await expect(
    service.handleRequest("desktop/persistent-agents/update", { id: persistentAgent.id, maxRunsPerDay: 1.5 }),
  ).rejects.toThrow(/daily budget/);
  const detail = (await service.handleRequest("desktop/persistent-agents/read", {
    id: persistentAgent.id,
  })) as PersistentAgentDetail;
  expect(detail.maxRunsPerDay).toBe(5);
  await service.stop();
});

test("persisted wakes require opt in, serialize runs, and obey the daily run budget", async () => {
  const { service, persistentAgent, request } = await setup();
  await service.handleRequest("desktop/persistent-agents/schedule", {
    id: persistentAgent.id,
    at: Date.now() - 1,
    reason: "Check release",
  });
  await service.tick();
  expect(request).not.toHaveBeenCalledWith("turn/start", expect.anything());
  await service.handleRequest("desktop/persistent-agents/update", {
    id: persistentAgent.id,
    enabled: true,
    maxRunsPerDay: 1,
  });
  await Promise.all([service.tick(), service.tick()]);
  expect(request.mock.calls.filter(([m]) => m === "turn/start")).toHaveLength(1);
  await service.onNotification("turn/completed", { threadId: persistentAgent.threadId, turn: { id: "turn-1" } });
  await service.handleRequest("desktop/persistent-agents/schedule", {
    id: persistentAgent.id,
    at: Date.now() - 1,
    reason: "Again",
  });
  await service.tick();
  expect(request.mock.calls.filter(([m]) => m === "turn/start")).toHaveLength(1);
  await service.stop();
});

test("tools cannot enable persistentAgents or access another thread's memory", async () => {
  const { service, persistentAgent } = await setup();
  await expect(service.handleTool("persistent_agent_memory_read", {}, { threadId: "other" })).rejects.toThrow(
    /persistent agent thread/,
  );
  await expect(
    service.handleTool("persistent_agent_enable", {}, { threadId: persistentAgent.threadId }),
  ).rejects.toThrow(/Unknown/);
  await service.handleTool(
    "persistent_agent_memory_write",
    { memory: "Decision: ship Friday" },
    { threadId: persistentAgent.threadId },
  );
  expect(
    (
      (await service.handleRequest("desktop/persistent-agents/read", {
        id: persistentAgent.id,
      })) as PersistentAgentDetail
    ).memory,
  ).toContain("Friday");
  await service.stop();
});

test("native memory uses the released engine's externally tagged scope and per-turn developer context", async () => {
  const { service, persistentAgent, request } = await setup();
  await service.handleTool(
    "persistent_agent_memory_save",
    { text: "Release on Friday" },
    { threadId: persistentAgent.threadId },
  );
  expect(request).toHaveBeenCalledWith(
    "memory/save",
    expect.objectContaining({ scope: { Thread: "thread-1" }, text: "Release on Friday" }),
  );
  await service.handleRequest("desktop/persistent-agents/run", { id: persistentAgent.id });
  expect(request).toHaveBeenCalledWith(
    "memory/query",
    expect.objectContaining({ scope: { Thread: "thread-1" }, limit: 5 }),
  );
  expect(request).toHaveBeenCalledWith(
    "turn/start",
    expect.objectContaining({
      threadId: "thread-1",
      developerContext: expect.stringContaining("Durable persistent agent memory"),
    }),
  );
  await service.stop();
});

test("ignores streaming notifications and unchanged ticks without disk writes or renderer notifications", async () => {
  const { service, directory, request } = await setup();
  await service.stop();
  const notify = vi.fn<() => void>();
  const recovered = createPersistentAgentService({ directory, request, notify });
  await recovered.start();
  await recovered.onNotification("item/agentMessage/delta", { threadId: "other", delta: "hello" });
  await recovered.onNotification("turn/completed", { threadId: "other", turn: { id: "other" } });
  await recovered.tick();
  expect(notify).not.toHaveBeenCalled();
  await recovered.stop();
});

test("restart recovers an active lease without starting an overlapping turn and interrupts overdue work", async () => {
  const { service, directory, request, persistentAgent } = await setup();
  await service.handleRequest("desktop/persistent-agents/update", { id: persistentAgent.id, enabled: true });
  await service.handleRequest("desktop/persistent-agents/schedule", {
    id: persistentAgent.id,
    at: Date.now(),
    reason: "Release",
  });
  await service.tick();
  await service.stop();
  const saved = JSON.parse(await readFile(join(directory, "persistent-agents.json"), "utf8"));
  saved.persistentAgents[0].active.startedAt = Date.now() - 3600000;
  await writeFile(join(directory, "persistent-agents.json"), JSON.stringify(saved));
  request.mockImplementation(async (method) =>
    method === "thread/read" ? { thread: { status: { type: "running", activeTurnId: "turn-1" } } } : {},
  );
  request.mockClear();
  const recovered = createPersistentAgentService({ directory, request });
  await recovered.start();
  expect(request).toHaveBeenCalledWith("turn/interrupt", { threadId: "thread-1", turnId: "turn-1" });
  expect(request).not.toHaveBeenCalledWith("turn/start", expect.anything());
  const detail = (await recovered.handleRequest("desktop/persistent-agents/read", {
    id: persistentAgent.id,
  })) as PersistentAgentDetail;
  expect(detail.enabled).toBe(false);
  expect(detail.wakes).toEqual([]);
  expect(detail.active).not.toBeNull();
  await recovered.stop();
});

test("corrupt persisted controls fail closed without scheduling work or replacing the file", async () => {
  const { service, directory, request } = await setup();
  await service.stop();
  const file = join(directory, "persistent-agents.json");
  const saved = JSON.parse(await readFile(file, "utf8"));
  saved.persistentAgents[0].enabled = true;
  delete saved.persistentAgents[0].maxRunsPerDay;
  const corrupted = JSON.stringify(saved);
  await writeFile(file, corrupted);
  request.mockClear();
  const recovered = createPersistentAgentService({ directory, request });
  await expect(recovered.start()).rejects.toThrow(/daily budget/);
  await recovered.stop();
  expect(request).not.toHaveBeenCalled();
  expect(await readFile(file, "utf8")).toBe(corrupted);
});

test("configured events coalesce, exclude the persistentAgent's own thread, and never enable paused persistentAgents", async () => {
  const { service, persistentAgent } = await setup();
  await service.handleRequest("desktop/persistent-agents/update", {
    id: persistentAgent.id,
    eventMethods: ["turn/completed"],
  });
  await service.onNotification("turn/completed", { threadId: "other", turn: { id: "other" } });
  expect(
    (
      (await service.handleRequest("desktop/persistent-agents/read", {
        id: persistentAgent.id,
      })) as PersistentAgentDetail
    ).wakes,
  ).toHaveLength(0);
  await service.handleRequest("desktop/persistent-agents/update", { id: persistentAgent.id, enabled: true });
  await service.onNotification("turn/completed", { threadId: persistentAgent.threadId, turn: { id: "old" } });
  await service.onNotification("turn/completed", { threadId: "other", turn: { id: "other" } });
  await service.onNotification("turn/completed", { threadId: "other", turn: { id: "other2" } });
  expect(
    (
      (await service.handleRequest("desktop/persistent-agents/read", {
        id: persistentAgent.id,
      })) as PersistentAgentDetail
    ).wakes,
  ).toHaveLength(1);
  await service.stop();
});

test("memory saves reject stale editor content rather than losing agent updates", async () => {
  const { service, persistentAgent } = await setup();
  await service.handleTool(
    "persistent_agent_memory_write",
    { memory: "Agent's new decision" },
    { threadId: persistentAgent.threadId },
  );
  await expect(
    service.handleRequest("desktop/persistent-agents/update", {
      id: persistentAgent.id,
      memory: "Old user draft",
      expectedMemory: persistentAgent.memory,
    }),
  ).rejects.toThrow(/Memory changed/);
  expect(
    (
      (await service.handleRequest("desktop/persistent-agents/read", {
        id: persistentAgent.id,
      })) as PersistentAgentDetail
    ).memory,
  ).toBe("Agent's new decision");
  await service.stop();
});

test("manual compaction invokes the engine on the same persisted thread", async () => {
  const { service, persistentAgent, request } = await setup();
  request.mockImplementation(async (method) => {
    if (method === "thread/read") return { thread: { status: { type: "idle" }, turns: [{ id: "old-turn" }] } };
    if (method === "thread/compact") return { compacted: true, estimatedTokensBefore: 500, estimatedTokensAfter: 100 };
    return {};
  });
  expect(await service.handleRequest("desktop/persistent-agents/compact", { id: persistentAgent.id })).toEqual({
    compacted: true,
    estimatedTokensBefore: 500,
    estimatedTokensAfter: 100,
  });
  expect(request).toHaveBeenCalledWith("thread/compact", {
    threadId: persistentAgent.threadId,
    turnId: "old-turn",
    preserveHint: persistentAgent.mission,
  });
  await service.stop();
});

test("a missing persisted thread is never silently replaced", async () => {
  const { service, persistentAgent, request } = await setup();
  request.mockClear();
  request.mockImplementation(async () => ({ thread: null }));
  await expect(service.handleRequest("desktop/persistent-agents/run", { id: persistentAgent.id })).rejects.toThrow(
    /history was not replaced/,
  );
  expect(request).not.toHaveBeenCalledWith("thread/start", expect.anything());
  expect(
    (
      (await service.handleRequest("desktop/persistent-agents/read", {
        id: persistentAgent.id,
      })) as PersistentAgentDetail
    ).threadId,
  ).toBe(persistentAgent.threadId);
  await service.stop();
});

test("interactive context belongs to the persistent agent thread and rereads external memory edits", async () => {
  const { service, persistentAgent, request } = await setup();
  request.mockClear();
  expect(await service.contextForThread("unrelated-thread")).toBeNull();
  expect(await service.contextForThread(persistentAgent.threadId)).toContain(persistentAgent.mission);
  await writeFile(persistentAgent.memoryPath, "External edit: release is now Monday.");
  const context = await service.contextForThread(persistentAgent.threadId);
  expect(context).toContain("External edit: release is now Monday.");
  expect(context).toContain(persistentAgent.mission);
  expect(request).not.toHaveBeenCalled();
  await writeFile(persistentAgent.memoryPath, "x".repeat(32001));
  await expect(service.contextForThread(persistentAgent.threadId)).rejects.toThrow(/exceeds 32000/);
  await service.stop();
});

test("persistentAgent creation forwards model choices and injects an original delegation strategy", async () => {
  const { service, request } = await setup();
  request.mockImplementation(async (method) => (method === "thread/start" ? { thread: { id: "model-thread" } } : {}));
  const c = (await service.handleRequest("desktop/persistent-agents/create", {
    name: "Coordinator",
    mission: "Ship the project",
    workspaceId: "ws",
    modelProvider: "openai",
    model: "chosen-model",
    reasoning: "high",
  })) as PersistentAgentDetail;
  expect(c).toMatchObject({ modelProvider: "openai", model: "chosen-model", reasoning: "high" });
  expect(request).toHaveBeenCalledWith(
    "thread/start",
    expect.objectContaining({
      modelProvider: "openai",
      model: "chosen-model",
      reasoning: "high",
      developerInstructions: expect.stringContaining("write ownership"),
    }),
  );
  const context = await service.contextForThread(c.threadId);
  expect(context).toContain("task");
  expect(context).toContain("agent_swarm");
  expect(context).toContain("Do not commit, push, or merge");
  await service.stop();
});

test("promotion retains the existing idle thread and is idempotent without replacing memory", async () => {
  const { service, request } = await setup();
  request.mockImplementation(async (method) =>
    method === "thread/read"
      ? {
          thread: {
            id: "existing",
            workspaceId: "ws",
            status: { type: "idle" },
            externalTools: persistentAgentToolDefinitions,
            modelProvider: "openai",
            model: "existing-model",
          },
        }
      : {},
  );
  request.mockClear();
  const params = { threadId: "existing", workspaceId: "ws", name: "Project", mission: "Maintain the project" };
  const c = (await service.handleRequest("desktop/persistent-agents/promote", params)) as PersistentAgentDetail;
  await service.handleTool("persistent_agent_memory_write", { memory: "Existing decision" }, { threadId: "existing" });
  const again = (await service.handleRequest("desktop/persistent-agents/promote", params)) as PersistentAgentDetail;
  expect(again.id).toBe(c.id);
  expect(again.memory).toBe("Existing decision");
  expect(c).toMatchObject({ threadId: "existing", model: "existing-model", enabled: false });
  expect(request).not.toHaveBeenCalledWith("thread/start", expect.anything());
  await expect(
    service.handleRequest("desktop/persistent-agents/promote", { ...params, workspaceId: "wrong" }),
  ).rejects.toThrow(/workspace/);
  await service.stop();
});

test("promotion rejects busy or foreign-workspace threads and applies explicit native model selection", async () => {
  const { service, request } = await setup();
  const params = { threadId: "existing", workspaceId: "ws", name: "Project", mission: "Maintain the project" };
  request.mockImplementation(async () => ({ thread: { workspaceId: "other", status: { type: "idle" } } }));
  await expect(service.handleRequest("desktop/persistent-agents/promote", params)).rejects.toThrow(/workspace/);
  request.mockImplementation(async () => ({ thread: { workspaceId: "ws", status: { type: "running" } } }));
  await expect(service.handleRequest("desktop/persistent-agents/promote", params)).rejects.toThrow(/idle/);
  request.mockImplementation(async (method) =>
    method === "thread/read"
      ? { thread: { workspaceId: "ws", status: { type: "idle" }, externalTools: persistentAgentToolDefinitions } }
      : {},
  );
  await service.handleRequest("desktop/persistent-agents/promote", {
    ...params,
    modelProvider: "openai",
    model: "chosen",
    reasoning: "low",
  });
  expect(request).toHaveBeenCalledWith("model/select", {
    threadId: "existing",
    selection: { type: "manual", provider: "openai", model: "chosen", reasoning: "low" },
  });
  await service.stop();
});

test("promotion cannot pretend legacy threads acquired missing native external tools", async () => {
  const { service, request } = await setup();
  request.mockImplementation(async () => ({
    thread: { workspaceId: "ws", status: { type: "idle" }, externalTools: [] },
  }));
  await expect(
    service.handleRequest("desktop/persistent-agents/promote", {
      threadId: "legacy",
      workspaceId: "ws",
      name: "Project",
      mission: "Keep working",
    }),
  ).rejects.toThrow(/lacks persistent agent tools/);
  expect(
    (
      (await service.handleRequest("desktop/persistent-agents/list", {})) as {
        persistentAgents: PersistentAgentDetail[];
      }
    ).persistentAgents,
  ).toHaveLength(1);
  await service.stop();
});

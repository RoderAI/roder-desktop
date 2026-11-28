import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { roderAgentToolDefinitions, createRoderAgentService } from "../electron/roder-agents/service";
import type { RoderAgentDetail, RoderFile } from "../src/types/roder-agents";
import type { createRoderAgentSpriteManager } from "../electron/roder-agents/sprites";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
async function setup(sprites?: ReturnType<typeof createRoderAgentSpriteManager>) {
  const directory = await mkdtemp(join(tmpdir(), "roderAgent-test-"));
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
  const service = createRoderAgentService({ directory, request, sprites });
  await service.start();
  const roderAgent = (await service.handleRequest("desktop/roders/create", {
    name: "Release",
    mission: "Watch releases",
    workspaceId: "ws",
  })) as RoderAgentDetail;
  return { service, roderAgent, request, directory };
}
function writeNotes(roderId: string, content: string) {
  return {
    commandId: `write-${content.length}-${roderId}`,
    roderId,
    action: { type: "writeFile", path: "NOTES.md", content, expectedVersion: 1 },
  };
}
async function notes(service: ReturnType<typeof createRoderAgentService>, id: string) {
  return ((await service.handleRequest("desktop/roders/files/read", { id, path: "NOTES.md" })) as RoderFile).content;
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
  } as unknown as ReturnType<typeof createRoderAgentSpriteManager>;
  const { service, roderAgent } = await setup(sprites);
  expect(roderAgent.enabled).toBe(false);
  expect(enqueue).toHaveBeenCalledWith(
    expect.objectContaining({ id: roderAgent.id, name: "Release", mission: "Watch releases" }),
  );
  expect(roderAgent.sprite?.status).toBe("needs_credentials");
  expect(await service.handleRequest("desktop/roders/sprite/read", { id: roderAgent.id })).toEqual({
    sprite,
    image: null,
  });
  expect(await service.handleRequest("desktop/roders/sprite/retry", { id: roderAgent.id })).toMatchObject({
    status: "queued",
  });
  await expect(service.handleRequest("desktop/roders/sprite/read", { id: "../outside" })).rejects.toThrow(/not found/i);
  expect(read).toHaveBeenCalledTimes(1);
  await service.stop();
});

test("creates a real thread, starts paused and preserves editable notes across restart", async () => {
  const { service, roderAgent, directory, request } = await setup();
  expect(roderAgent.enabled).toBe(false);
  await service.handleRequest("desktop/roders/files/write", {
    id: roderAgent.id,
    path: "NOTES.md",
    content: "Keep the release checklist.",
    expectedVersion: 1,
  });
  await service.tick();
  expect(request.mock.calls.filter(([m]) => m === "turn/start")).toHaveLength(0);
  await service.stop();
  const recovered = createRoderAgentService({ directory, request });
  await recovered.start();
  const detail = (await recovered.handleRequest("desktop/roders/read", {
    id: roderAgent.id,
  })) as RoderAgentDetail;
  expect(detail.threadId).toBe(roderAgent.threadId);
  expect(detail.files.find((f) => f.path === "NOTES.md")?.version).toBe(2);
  expect(await notes(recovered, roderAgent.id)).toBe("Keep the release checklist.");
  await recovered.stop();
});

test("manual and automatic Roder runs always use bypass permissions", async () => {
  const { service, roderAgent, request } = await setup();
  await service.handleRequest("desktop/roders/run", { id: roderAgent.id });
  expect(request).toHaveBeenCalledWith(
    "turn/start",
    expect.objectContaining({ threadId: roderAgent.threadId, policyMode: "bypass" }),
  );
  await service.onNotification("turn/completed", {
    threadId: roderAgent.threadId,
    turn: { id: "turn-1" },
  });
  await service.handleRequest("desktop/roders/update", {
    id: roderAgent.id,
    enabled: true,
  });
  await service.handleRequest("desktop/roders/schedule", {
    id: roderAgent.id,
    at: Date.now() - 1,
    reason: "Check docs",
  });
  await service.tick();
  const starts = request.mock.calls.filter(([method]) => method === "turn/start");
  expect(starts).toHaveLength(2);
  for (const [, params] of starts) expect(params).toMatchObject({ policyMode: "bypass" });
  await service.stop();
});

test("Roder chat overrides permission mode without changing ordinary threads", async () => {
  const { service, roderAgent } = await setup();
  const input = {
    threadId: roderAgent.threadId,
    policyMode: "default",
    developerContext: "Desktop context",
    input: [{ type: "text", text: "Update docs" }],
  };
  expect(await service.turnStartParams(input)).toMatchObject({
    ...input,
    policyMode: "bypass",
    developerContext: expect.stringContaining("Desktop context"),
  });
  const ordinary = { ...input, threadId: "ordinary", policyMode: "plan" };
  expect(await service.turnStartParams(ordinary)).toBe(ordinary);
  expect(
    (await service.handleRequest("desktop/roders/read", {
      id: roderAgent.id,
    })) as RoderAgentDetail,
  ).toMatchObject({ enabled: false, runs: [] });
  await service.stop();
});

test("recovered Roders also default to bypass on their next chat turn", async () => {
  const { service, roderAgent, directory, request } = await setup();
  await service.stop();
  const recovered = createRoderAgentService({ directory, request });
  await recovered.start();
  expect(await recovered.turnStartParams({ threadId: roderAgent.threadId, policyMode: "accept_all" })).toMatchObject({
    policyMode: "bypass",
  });
  await recovered.stop();
});

test("daily run allowances must be whole counts", async () => {
  const { service, roderAgent } = await setup();
  await expect(
    service.handleRequest("desktop/roders/update", { id: roderAgent.id, maxRunsPerDay: 1.5 }),
  ).rejects.toThrow(/daily budget/);
  const detail = (await service.handleRequest("desktop/roders/read", {
    id: roderAgent.id,
  })) as RoderAgentDetail;
  expect(detail.maxRunsPerDay).toBe(5);
  await service.stop();
});

test("persisted wakes require opt in, serialize runs, and obey the daily run budget", async () => {
  const { service, roderAgent, request } = await setup();
  await service.handleRequest("desktop/roders/schedule", {
    id: roderAgent.id,
    at: Date.now() - 1,
    reason: "Check release",
  });
  await service.tick();
  expect(request).not.toHaveBeenCalledWith("turn/start", expect.anything());
  await service.handleRequest("desktop/roders/update", {
    id: roderAgent.id,
    enabled: true,
    maxRunsPerDay: 1,
  });
  await Promise.all([service.tick(), service.tick()]);
  expect(request.mock.calls.filter(([m]) => m === "turn/start")).toHaveLength(1);
  await service.onNotification("turn/completed", { threadId: roderAgent.threadId, turn: { id: "turn-1" } });
  await service.handleRequest("desktop/roders/schedule", {
    id: roderAgent.id,
    at: Date.now() - 1,
    reason: "Again",
  });
  await service.tick();
  expect(request.mock.calls.filter(([m]) => m === "turn/start")).toHaveLength(1);
  await service.stop();
});

test("tools cannot enable Roders or access another thread's memory", async () => {
  const { service, roderAgent } = await setup();
  await expect(service.handleTool("roder_memory_read", {}, { threadId: "other" })).rejects.toThrow(/Roder thread/);
  await expect(service.handleTool("roder_enable", {}, { threadId: roderAgent.threadId })).rejects.toThrow(/Unknown/);
  await service.handleTool("roder_command", writeNotes(roderAgent.id, "Decision: ship Friday"), {
    threadId: roderAgent.threadId,
  });
  expect(await notes(service, roderAgent.id)).toContain("Friday");
  await service.stop();
});

test("native memory uses the released engine's externally tagged scope and per-turn developer context", async () => {
  const { service, roderAgent, request } = await setup();
  await service.handleTool("roder_memory_save", { text: "Release on Friday" }, { threadId: roderAgent.threadId });
  expect(request).toHaveBeenCalledWith(
    "memory/save",
    expect.objectContaining({ scope: { Thread: "thread-1" }, text: "Release on Friday" }),
  );
  await service.handleRequest("desktop/roders/run", { id: roderAgent.id });
  expect(request).toHaveBeenCalledWith(
    "memory/query",
    expect.objectContaining({ scope: { Thread: "thread-1" }, limit: 5 }),
  );
  expect(request).toHaveBeenCalledWith(
    "turn/start",
    expect.objectContaining({
      threadId: "thread-1",
      developerContext: expect.stringContaining("## Notes (NOTES.md, version 1)"),
    }),
  );
  await service.stop();
});

test("ignores streaming notifications and unchanged ticks without disk writes or renderer notifications", async () => {
  const { service, directory, request } = await setup();
  await service.stop();
  const notify = vi.fn<() => void>();
  const recovered = createRoderAgentService({ directory, request, notify });
  await recovered.start();
  await recovered.onNotification("item/agentMessage/delta", { threadId: "other", delta: "hello" });
  await recovered.onNotification("turn/completed", { threadId: "other", turn: { id: "other" } });
  await recovered.tick();
  expect(notify).not.toHaveBeenCalled();
  await recovered.stop();
});

test("restart recovers an active lease without starting an overlapping turn and interrupts overdue work", async () => {
  const { service, directory, request, roderAgent } = await setup();
  await service.handleRequest("desktop/roders/update", { id: roderAgent.id, enabled: true });
  await service.handleRequest("desktop/roders/schedule", {
    id: roderAgent.id,
    at: Date.now(),
    reason: "Release",
  });
  await service.tick();
  await service.stop();
  const saved = JSON.parse(await readFile(join(directory, "roders.json"), "utf8"));
  saved.roders[0].active.startedAt = Date.now() - 3600000;
  await writeFile(join(directory, "roders.json"), JSON.stringify(saved));
  request.mockImplementation(async (method) =>
    method === "thread/read" ? { thread: { status: { type: "running", activeTurnId: "turn-1" } } } : {},
  );
  request.mockClear();
  const recovered = createRoderAgentService({ directory, request });
  await recovered.start();
  expect(request).toHaveBeenCalledWith("turn/interrupt", { threadId: "thread-1", turnId: "turn-1" });
  expect(request).not.toHaveBeenCalledWith("turn/start", expect.anything());
  const detail = (await recovered.handleRequest("desktop/roders/read", {
    id: roderAgent.id,
  })) as RoderAgentDetail;
  expect(detail.enabled).toBe(false);
  expect(detail.wakes).toEqual([]);
  expect(detail.active).not.toBeNull();
  await recovered.stop();
});

test("corrupt persisted controls fail closed without scheduling work or replacing the file", async () => {
  const { service, directory, request } = await setup();
  await service.stop();
  const file = join(directory, "roders.json");
  const saved = JSON.parse(await readFile(file, "utf8"));
  saved.roders[0].enabled = true;
  delete saved.roders[0].maxRunsPerDay;
  const corrupted = JSON.stringify(saved);
  await writeFile(file, corrupted);
  request.mockClear();
  const recovered = createRoderAgentService({ directory, request });
  await expect(recovered.start()).rejects.toThrow(/daily budget/);
  await recovered.stop();
  expect(request).not.toHaveBeenCalled();
  expect(await readFile(file, "utf8")).toBe(corrupted);
});

test("configured events coalesce, exclude the Roder's own thread, and never enable paused Roders", async () => {
  const { service, roderAgent } = await setup();
  await service.handleRequest("desktop/roders/update", {
    id: roderAgent.id,
    eventMethods: ["turn/completed"],
  });
  await service.onNotification("turn/completed", { threadId: "other", turn: { id: "other" } });
  expect(
    (
      (await service.handleRequest("desktop/roders/read", {
        id: roderAgent.id,
      })) as RoderAgentDetail
    ).wakes,
  ).toHaveLength(0);
  await service.handleRequest("desktop/roders/update", { id: roderAgent.id, enabled: true });
  await service.onNotification("turn/completed", { threadId: roderAgent.threadId, turn: { id: "old" } });
  await service.onNotification("turn/completed", { threadId: "other", turn: { id: "other" } });
  await service.onNotification("turn/completed", { threadId: "other", turn: { id: "other2" } });
  expect(
    (
      (await service.handleRequest("desktop/roders/read", {
        id: roderAgent.id,
      })) as RoderAgentDetail
    ).wakes,
  ).toHaveLength(1);
  await service.stop();
});

test("notes saves reject stale editor content rather than losing agent updates", async () => {
  const { service, roderAgent } = await setup();
  await service.handleTool("roder_command", writeNotes(roderAgent.id, "Agent's new decision"), {
    threadId: roderAgent.threadId,
  });
  await expect(
    service.handleRequest("desktop/roders/files/write", {
      id: roderAgent.id,
      path: "NOTES.md",
      content: "Old user draft",
      expectedVersion: roderAgent.files.find((f) => f.path === "NOTES.md")!.version,
    }),
  ).rejects.toThrow(/current version is 2/);
  expect(await notes(service, roderAgent.id)).toBe("Agent's new decision");
  await service.stop();
});

test("manual compaction invokes the engine on the same persisted thread", async () => {
  const { service, roderAgent, request } = await setup();
  request.mockImplementation(async (method) => {
    if (method === "thread/read") return { thread: { status: { type: "idle" }, turns: [{ id: "old-turn" }] } };
    if (method === "thread/compact") return { compacted: true, estimatedTokensBefore: 500, estimatedTokensAfter: 100 };
    return {};
  });
  expect(await service.handleRequest("desktop/roders/compact", { id: roderAgent.id })).toEqual({
    compacted: true,
    estimatedTokensBefore: 500,
    estimatedTokensAfter: 100,
  });
  expect(request).toHaveBeenCalledWith("thread/compact", {
    threadId: roderAgent.threadId,
    turnId: "old-turn",
    preserveHint: roderAgent.mission,
  });
  await service.stop();
});

test("a missing persisted thread is never silently replaced", async () => {
  const { service, roderAgent, request } = await setup();
  request.mockClear();
  request.mockImplementation(async () => ({ thread: null }));
  await expect(service.handleRequest("desktop/roders/run", { id: roderAgent.id })).rejects.toThrow(
    /history was not replaced/,
  );
  expect(request).not.toHaveBeenCalledWith("thread/start", expect.anything());
  expect(
    (
      (await service.handleRequest("desktop/roders/read", {
        id: roderAgent.id,
      })) as RoderAgentDetail
    ).threadId,
  ).toBe(roderAgent.threadId);
  await service.stop();
});

test("interactive context belongs to the Roder thread and rereads notes edits", async () => {
  const { service, roderAgent, request } = await setup();
  request.mockClear();
  expect(await service.contextForThread("unrelated-thread")).toBeNull();
  expect(await service.contextForThread(roderAgent.threadId)).toContain(roderAgent.mission);
  await service.handleRequest("desktop/roders/files/write", {
    id: roderAgent.id,
    path: "NOTES.md",
    content: "User edit: release is now Monday.",
    expectedVersion: 1,
  });
  const context = await service.contextForThread(roderAgent.threadId);
  expect(context).toContain("User edit: release is now Monday.");
  expect(context).toContain(roderAgent.mission);
  expect(request).not.toHaveBeenCalled();
  await service.stop();
});

test("Roder creation forwards model choices and injects an original delegation strategy", async () => {
  const { service, request } = await setup();
  request.mockImplementation(async (method) => (method === "thread/start" ? { thread: { id: "model-thread" } } : {}));
  const c = (await service.handleRequest("desktop/roders/create", {
    name: "Coordinator",
    mission: "Ship the project",
    workspaceId: "ws",
    modelProvider: "openai",
    model: "chosen-model",
    reasoning: "high",
  })) as RoderAgentDetail;
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
            externalTools: roderAgentToolDefinitions,
            modelProvider: "openai",
            model: "existing-model",
          },
        }
      : {},
  );
  request.mockClear();
  const params = { threadId: "existing", workspaceId: "ws", name: "Project", mission: "Maintain the project" };
  const c = (await service.handleRequest("desktop/roders/promote", params)) as RoderAgentDetail;
  await service.handleTool("roder_command", writeNotes(c.id, "Existing decision"), { threadId: "existing" });
  const again = (await service.handleRequest("desktop/roders/promote", params)) as RoderAgentDetail;
  expect(again.id).toBe(c.id);
  expect(await notes(service, c.id)).toBe("Existing decision");
  expect(c).toMatchObject({ threadId: "existing", model: "existing-model", enabled: false });
  expect(request).not.toHaveBeenCalledWith("thread/start", expect.anything());
  await expect(service.handleRequest("desktop/roders/promote", { ...params, workspaceId: "wrong" })).rejects.toThrow(
    /workspace/,
  );
  await service.stop();
});

test("promotion rejects busy or foreign-workspace threads and applies explicit native model selection", async () => {
  const { service, request } = await setup();
  const params = { threadId: "existing", workspaceId: "ws", name: "Project", mission: "Maintain the project" };
  request.mockImplementation(async () => ({ thread: { workspaceId: "other", status: { type: "idle" } } }));
  await expect(service.handleRequest("desktop/roders/promote", params)).rejects.toThrow(/workspace/);
  request.mockImplementation(async () => ({ thread: { workspaceId: "ws", status: { type: "running" } } }));
  await expect(service.handleRequest("desktop/roders/promote", params)).rejects.toThrow(/idle/);
  request.mockImplementation(async (method) =>
    method === "thread/read"
      ? { thread: { workspaceId: "ws", status: { type: "idle" }, externalTools: roderAgentToolDefinitions } }
      : {},
  );
  await service.handleRequest("desktop/roders/promote", {
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
    service.handleRequest("desktop/roders/promote", {
      threadId: "legacy",
      workspaceId: "ws",
      name: "Project",
      mission: "Keep working",
    }),
  ).rejects.toThrow(/lacks Roder tools/);
  expect(
    (
      (await service.handleRequest("desktop/roders/list", {})) as {
        roders: RoderAgentDetail[];
      }
    ).roders,
  ).toHaveLength(1);
  await service.stop();
});

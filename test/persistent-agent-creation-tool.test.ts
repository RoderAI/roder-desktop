import { expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesktopAgentTools } from "../electron/agents/desktop-agent-tools";
import { createPersistentAgentService } from "../electron/persistent-agents/service";
import type { PersistentAgentDetail } from "../src/types/persistent-agents";
import {
  createPersistentAgentFromTool,
  mergePersistentAgentSkill,
  persistentAgentCreateTool,
  persistentAgentSkill,
  persistentAgentSkillBody,
  readPersistentAgentSkill,
} from "../electron/persistent-agents/creation-tool";

test("creation tool uses the calling thread's workspace and the desktop creation route", async () => {
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async (method: string) =>
    method === "thread/read"
      ? { thread: { workspaceId: "workspace-1" } }
      : { id: "agent-1", enabled: false, threadId: "agent-thread" },
  );
  expect(
    await createPersistentAgentFromTool({ name: "Release", mission: "Watch releases" }, "caller", request),
  ).toMatchObject({
    id: "agent-1",
    enabled: false,
  });
  expect(request).toHaveBeenNthCalledWith(1, "thread/read", { threadId: "caller", includeTurns: false });
  expect(request).toHaveBeenNthCalledWith(2, "desktop/persistent-agents/create", {
    name: "Release",
    mission: "Watch releases",
    workspaceId: "workspace-1",
  });
  expect(persistentAgentCreateTool.parameters.required).toEqual(["name", "mission"]);
});

test("explicit workspace bypasses caller lookup; missing workspace does not create an agent", async () => {
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async (method: string) =>
    method === "thread/read" ? { thread: {} } : { id: "agent-2" },
  );
  await createPersistentAgentFromTool({ name: "Build", mission: "Ship", workspaceId: "another" }, "caller", request);
  expect(request).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledWith("desktop/persistent-agents/create", {
    name: "Build",
    mission: "Ship",
    workspaceId: "another",
  });
  request.mockClear();
  await expect(createPersistentAgentFromTool({ name: "Build", mission: "Ship" }, "caller", request)).rejects.toThrow(
    /no workspace/,
  );
  expect(request).toHaveBeenCalledOnce();
});

test("desktop advertises $persistent-agent even outside this repository", () => {
  const result = mergePersistentAgentSkill({
    skills: [{ name: "other" }, { name: "persistent-agent" }],
    diagnostics: [],
  });
  expect(result.skills.map((skill) => (skill as { name: string }).name)).toEqual(["other", "persistent-agent"]);
});

test("built-in skill can be read by name and canonical path without a repository file", () => {
  for (const selector of [
    { name: { name: "persistent-agent" } },
    { path: { path: persistentAgentSkill.canonicalPath } },
  ]) {
    expect(readPersistentAgentSkill({ selector })).toEqual({
      skill: { descriptor: persistentAgentSkill, body: persistentAgentSkillBody },
    });
  }
  expect(readPersistentAgentSkill({ selector: { name: { name: "other" } } })).toBeUndefined();
  expect(readPersistentAgentSkill(null)).toBeUndefined();
  expect(readPersistentAgentSkill({})).toBeUndefined();
});

test.each([
  {},
  { name: "", mission: "Watch releases" },
  { name: "Release", mission: " " },
  { name: "Release", mission: "Watch", workspaceId: "" },
  { name: "Release", mission: "Watch", model: "model-only" },
  { name: "Release", mission: "Watch", enabled: true },
  { name: "Release", mission: "Watch", nameExtra: "unexpected" },
])("creation validates input before looking up or creating a thread: %j", async (args) => {
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>();
  await expect(createPersistentAgentFromTool(args, "caller", request)).rejects.toThrow(
    /Invalid|Unexpected|Choose both/,
  );
  expect(request).not.toHaveBeenCalled();
});

test("creation preserves explicit model choices and reports backend failure", async () => {
  const args = {
    name: "Release",
    mission: "Watch releases",
    workspaceId: "ws",
    modelProvider: "openai",
    model: "chosen-model",
    reasoning: "medium",
  };
  const request = vi
    .fn<(method: string, params: unknown) => Promise<unknown>>()
    .mockRejectedValue(new Error("Workspace not found"));
  await expect(createPersistentAgentFromTool(args, "caller", request)).rejects.toThrow("Workspace not found");
  expect(request).toHaveBeenCalledWith("desktop/persistent-agents/create", args);
});

test("model tool execution persists a paused agent without UI or starting a run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "roder-chat-agent-"));
  const engine = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async (method) => {
    if (method === "thread/read") return { thread: { id: "caller", workspaceId: "workspace-1" } };
    if (method === "thread/start") return { thread: { id: "agent-thread", workspaceId: "workspace-1" } };
    throw new Error(`Unexpected engine method ${method}`);
  });
  const service = createPersistentAgentService({ directory, request: engine });
  const recovered = createPersistentAgentService({ directory, request: engine });
  try {
    await service.start();
    const request = async (method: string, params: unknown) =>
      method.startsWith("desktop/persistent-agents/") ? service.handleRequest(method, params) : engine(method, params);
    const resolve = vi.fn<(method: string, params: unknown) => Promise<unknown>>().mockResolvedValue({});
    const bridge = new DesktopAgentTools(
      [
        {
          ...persistentAgentCreateTool,
          execute: (args, context) => createPersistentAgentFromTool(args, context.threadId, request),
        },
      ],
      resolve,
      persistentAgentSkillBody,
    );
    const notification = {
      threadId: "caller",
      turnId: "turn-1",
      requestId: "request-1",
      call: { name: "persistent_agent_create", arguments: { name: "Release", mission: "Watch releases" } },
    };
    await bridge.onNotification("thread/toolExecutionRequested", notification);
    await bridge.onNotification("thread/toolExecutionRequested", notification);
    expect(resolve).toHaveBeenLastCalledWith("tools/resolve", expect.objectContaining({ isError: false }));
    const result = resolve.mock.calls[0][1] as { output: string };
    const agent = JSON.parse(result.output) as PersistentAgentDetail;
    expect(agent).toMatchObject({
      name: "Release",
      mission: "Watch releases",
      enabled: false,
      workspaceId: "workspace-1",
      threadId: "agent-thread",
      active: null,
      wakes: [],
    });
    expect(engine.mock.calls.filter(([method]) => method === "thread/start")).toHaveLength(1);
    expect(engine.mock.calls.some(([method]) => method === "turn/start")).toBe(false);
    await service.stop();
    await recovered.start();
    expect(await recovered.handleRequest("desktop/persistent-agents/read", { id: agent.id })).toMatchObject({
      id: agent.id,
      enabled: false,
      mission: "Watch releases",
    });
  } finally {
    await service.stop();
    await recovered.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

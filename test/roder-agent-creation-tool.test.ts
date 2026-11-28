import { expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesktopAgentTools } from "../electron/agents/desktop-agent-tools";
import { createRoderAgentService } from "../electron/roder-agents/service";
import type { RoderAgentDetail } from "../src/types/roder-agents";
import {
  createRoderAgentFromTool,
  listRoderAgentWorkspaces,
  mergeRoderAgentSkill,
  roderAgentCreateTool,
  roderAgentSkill,
  roderAgentSkillBody,
  readRoderAgentSkill,
} from "../electron/roder-agents/creation-tool";

test("creation tool uses the calling thread's workspace and the desktop creation route", async () => {
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async (method: string) =>
    method === "thread/read"
      ? { thread: { workspaceId: "workspace-1" } }
      : { id: "agent-1", enabled: false, threadId: "agent-thread" },
  );
  expect(
    await createRoderAgentFromTool({ name: "Release", mission: "Watch releases" }, "caller", request),
  ).toMatchObject({
    id: "agent-1",
    enabled: false,
  });
  expect(request).toHaveBeenNthCalledWith(1, "thread/read", { threadId: "caller", includeTurns: false });
  expect(request).toHaveBeenNthCalledWith(2, "desktop/roders/create", {
    name: "Release",
    mission: "Watch releases",
    workspaceId: "workspace-1",
  });
  expect(roderAgentCreateTool.parameters.required).toEqual(["name", "mission"]);
});

test("explicit workspace bypasses caller lookup; missing workspace does not create an agent", async () => {
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async (method: string) =>
    method === "thread/read" ? { thread: {} } : { id: "agent-2" },
  );
  await createRoderAgentFromTool({ name: "Build", mission: "Ship", workspaceId: "another" }, "caller", request);
  expect(request).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledWith("desktop/roders/create", {
    name: "Build",
    mission: "Ship",
    workspaceId: "another",
  });
  request.mockClear();
  await expect(createRoderAgentFromTool({ name: "Build", mission: "Ship" }, "caller", request)).rejects.toThrow(
    /no workspace/,
  );
  expect(request).toHaveBeenCalledOnce();
});

test("desktop advertises $roder even outside this repository", () => {
  const result = mergeRoderAgentSkill({
    skills: [{ name: "other" }, { name: "roder" }],
    diagnostics: [],
  });
  expect(result.skills.map((skill) => (skill as { name: string }).name)).toEqual(["other", "roder"]);
});

test("built-in skill can be read by name and canonical path without a repository file", () => {
  for (const selector of [{ name: { name: "roder" } }, { path: { path: roderAgentSkill.canonicalPath } }]) {
    expect(readRoderAgentSkill({ selector })).toEqual({
      skill: { descriptor: roderAgentSkill, body: roderAgentSkillBody },
    });
  }
  expect(readRoderAgentSkill({ selector: { name: { name: "other" } } })).toBeUndefined();
  expect(readRoderAgentSkill(null)).toBeUndefined();
  expect(readRoderAgentSkill({})).toBeUndefined();
});

test.each([
  {},
  { name: "", mission: "Watch releases" },
  { name: "Release", mission: " " },
  { name: "Release", mission: "Watch", workspaceId: 42 },
  { name: "Release", mission: "Watch", workspaceId: "ws", workspaceName: "site" },
  { name: "Release", mission: "Watch", model: "model-only" },
  { name: "Release", mission: "Watch", enabled: true },
  { name: "Release", mission: "Watch", nameExtra: "unexpected" },
])("creation validates input before looking up or creating a thread: %j", async (args) => {
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>();
  await expect(createRoderAgentFromTool(args, "caller", request)).rejects.toThrow(
    /Invalid|Unexpected|Choose both|Choose either/,
  );
  expect(request).not.toHaveBeenCalled();
});

test("empty optional fields default to the caller workspace without mutating arguments", async () => {
  const args = {
    name: "Docs",
    mission: "Keep docs current",
    workspaceId: "",
    workspaceName: " ",
    modelProvider: "",
    model: "",
    reasoning: "",
  };
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async (method) =>
    method === "thread/read" ? { thread: { workspaceId: "ws" } } : { id: "agent" },
  );
  await createRoderAgentFromTool(args, "caller", request);
  expect(request).toHaveBeenLastCalledWith("desktop/roders/create", {
    name: "Docs",
    mission: "Keep docs current",
    workspaceId: "ws",
  });
  expect(args.workspaceId).toBe("");
});

test("workspace name resolves using desktop workspaces, not issue projects", async () => {
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async (method) =>
    method === "workspace/list" ? { workspaces: [{ id: "site-id", name: "roder-site" }] } : { id: "agent" },
  );
  await createRoderAgentFromTool({ name: "Docs", mission: "Watch", workspaceName: "roder-site" }, "caller", request);
  expect(request).toHaveBeenNthCalledWith(1, "workspace/list", {});
  expect(request).toHaveBeenLastCalledWith("desktop/roders/create", {
    name: "Docs",
    mission: "Watch",
    workspaceId: "site-id",
  });
});

test.each([
  { workspaces: [] },
  {
    workspaces: [
      { id: "a", name: "site" },
      { id: "b", name: "site" },
    ],
  },
])("missing or ambiguous workspace names never create an agent: %j", async ({ workspaces }) => {
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async () => ({ workspaces }));
  await expect(
    createRoderAgentFromTool({ name: "Docs", mission: "Watch", workspaceName: "site" }, "caller", request),
  ).rejects.toThrow(/roder_workspaces/);
  expect(request).toHaveBeenCalledOnce();
});

test("workspace lookup uses the workspace API and rejects extra arguments", async () => {
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async () => ({
    workspaces: [{ id: "ws", name: "site" }],
  }));
  expect(await listRoderAgentWorkspaces({}, request)).toEqual({ workspaces: [{ id: "ws", name: "site" }] });
  expect(request).toHaveBeenCalledWith("workspace/list", {});
  request.mockClear();
  await expect(listRoderAgentWorkspaces({ path: "site" }, request)).rejects.toThrow("empty object");
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
  await expect(createRoderAgentFromTool(args, "caller", request)).rejects.toThrow("Workspace not found");
  expect(request).toHaveBeenCalledWith("desktop/roders/create", args);
});

test("model tool execution persists a paused agent without UI or starting a run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "roder-chat-agent-"));
  const engine = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async (method) => {
    if (method === "thread/read") return { thread: { id: "caller", workspaceId: "workspace-1" } };
    if (method === "thread/start") return { thread: { id: "agent-thread", workspaceId: "workspace-1" } };
    throw new Error(`Unexpected engine method ${method}`);
  });
  const service = createRoderAgentService({ directory, request: engine });
  const recovered = createRoderAgentService({ directory, request: engine });
  try {
    await service.start();
    const request = async (method: string, params: unknown) =>
      method.startsWith("desktop/roders/") ? service.handleRequest(method, params) : engine(method, params);
    const resolve = vi.fn<(method: string, params: unknown) => Promise<unknown>>().mockResolvedValue({});
    const bridge = new DesktopAgentTools(
      [
        {
          ...roderAgentCreateTool,
          execute: (args, context) => createRoderAgentFromTool(args, context.threadId, request),
        },
      ],
      resolve,
      roderAgentSkillBody,
    );
    const notification = {
      threadId: "caller",
      turnId: "turn-1",
      requestId: "request-1",
      call: { name: "roder_create", arguments: { name: "Release", mission: "Watch releases" } },
    };
    await bridge.onNotification("thread/toolExecutionRequested", notification);
    await bridge.onNotification("thread/toolExecutionRequested", notification);
    expect(resolve).toHaveBeenLastCalledWith("tools/resolve", expect.objectContaining({ isError: false }));
    const result = resolve.mock.calls[0][1] as { output: string };
    const agent = JSON.parse(result.output) as RoderAgentDetail;
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
    expect(await recovered.handleRequest("desktop/roders/read", { id: agent.id })).toMatchObject({
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

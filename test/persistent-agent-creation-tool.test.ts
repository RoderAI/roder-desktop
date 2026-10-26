import { expect, test, vi } from "vitest";
import {
  createPersistentAgentFromTool,
  mergePersistentAgentSkill,
  persistentAgentCreateTool,
} from "../electron/persistent-agents/creation-tool";

test("creation tool uses the calling thread's workspace and the desktop creation route", async () => {
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async (method: string) =>
    method === "thread/read"
      ? { thread: { workspaceId: "workspace-1" } }
      : { id: "agent-1", enabled: false, threadId: "agent-thread" },
  );
  expect(await createPersistentAgentFromTool({ name: "Release", mission: "Watch releases" }, "caller", request)).toMatchObject({
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
  const result = mergePersistentAgentSkill({ skills: [{ name: "other" }, { name: "persistent-agent" }], diagnostics: [] });
  expect(result.skills.map((skill) => (skill as { name: string }).name)).toEqual(["other", "persistent-agent"]);
});

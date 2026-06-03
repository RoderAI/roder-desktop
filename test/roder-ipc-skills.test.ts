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

test("listSkills requests the runtime skills catalog", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return { skills: [], diagnostics: ["loaded"] };
  });

  const result = await roderIpc.listSkills();

  expect(result).toEqual({ skills: [], diagnostics: ["loaded"] });
  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "skills/list",
      params: {},
    },
  ]);
});

test("listSkills passes workspace context when provided", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return { skills: [], diagnostics: [] };
  });

  await roderIpc.listSkills({ workspaceId: "ws_1", rootId: "root_1", cwd: "/repo" });

  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "skills/list",
      params: {
        workspaceId: "ws_1",
        rootId: "root_1",
        cwd: "/repo",
      },
    },
  ]);
});

test("setSkillEnabled mutates by canonical path selector", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return { skills: [], diagnostics: [] };
  });

  await roderIpc.setSkillEnabled("builtin://skills/commit/SKILL.md", false);

  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "skills/setEnabled",
      params: {
        selector: { path: "builtin://skills/commit/SKILL.md" },
        enabled: false,
      },
    },
  ]);
});

test("setSkillExposure mutates by canonical path selector", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return { skills: [], diagnostics: [] };
  });

  await roderIpc.setSkillExposure("builtin://skills/commit/SKILL.md", "global");

  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "skills/setExposure",
      params: {
        selector: { path: "builtin://skills/commit/SKILL.md" },
        exposure: "global",
      },
    },
  ]);
});

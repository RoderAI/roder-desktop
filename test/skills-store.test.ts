import { expect, test, vi } from "vitest";
import type { SkillDescriptor } from "../src/types/roder";

async function loadSkillsStore(request: (method: string, params: unknown) => Promise<unknown>) {
  vi.resetModules();
  globalThis.window = {
    roderDesktop: {
      request,
      onNotification: () => () => undefined,
      onStderr: () => () => undefined,
    },
  } as unknown as Window & typeof globalThis;
  const module = await import("../src/stores/skills-store");
  module.useSkillsStore.setState({
    skills: [],
    diagnostics: [],
    loading: false,
    error: null,
    loaded: false,
    loadedContextKey: null,
    loadedContext: null,
    pendingByPath: {},
    errorsByPath: {},
  });
  return module.useSkillsStore;
}

test("load stores skills and diagnostics", async () => {
  const useSkillsStore = await loadSkillsStore(async () => ({
    skills: [skill({ name: "commit" })],
    diagnostics: ["diagnostic"],
  }));

  await useSkillsStore.getState().load();

  expect(useSkillsStore.getState().skills.map((item) => item.name)).toEqual(["commit"]);
  expect(useSkillsStore.getState().diagnostics).toEqual(["diagnostic"]);
  expect(useSkillsStore.getState().loaded).toBe(true);
  expect(useSkillsStore.getState().loading).toBe(false);
  expect(useSkillsStore.getState().error).toBeNull();
});

test("load passes workspace context and records the loaded context", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const useSkillsStore = await loadSkillsStore(async (method, params) => {
    calls.push({ method, params });
    return { skills: [skill({ name: "local", source: "workspace" })], diagnostics: [] };
  });

  await useSkillsStore.getState().load({ workspaceId: "ws_1", rootId: "root_1", cwd: "/repo" });

  expect(useSkillsStore.getState().skills.map((item) => item.name)).toEqual(["local"]);
  expect(useSkillsStore.getState().loadedContextKey).toBe(
    JSON.stringify({ workspaceId: "ws_1", rootId: "root_1", cwd: "/repo" }),
  );
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

test("load normalizes missing skill diagnostics from the app-server", async () => {
  const useSkillsStore = await loadSkillsStore(async () => ({
    skills: [{ ...skill({ name: "commit" }), diagnostics: undefined }],
    diagnostics: undefined,
  }));

  await useSkillsStore.getState().load();

  expect(useSkillsStore.getState().skills[0].diagnostics).toEqual([]);
  expect(useSkillsStore.getState().diagnostics).toEqual([]);
});

test("load failure marks skills as loaded to avoid immediate retry loops", async () => {
  const useSkillsStore = await loadSkillsStore(async () => {
    throw new Error("server unavailable");
  });

  await useSkillsStore.getState().load();

  expect(useSkillsStore.getState().loaded).toBe(true);
  expect(useSkillsStore.getState().loading).toBe(false);
  expect(useSkillsStore.getState().error).toBe("server unavailable");
});

test("setSkillEnabled refreshes skills and tracks pending path", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const useSkillsStore = await loadSkillsStore(async (method, params) => {
    calls.push({ method, params });
    expect(useSkillsStore.getState().pendingByPath["builtin://skills/commit/SKILL.md"]).toBe(true);
    return { skills: [skill({ name: "commit", activation: "disabled" })], diagnostics: [] };
  });

  await useSkillsStore.getState().setSkillEnabled("builtin://skills/commit/SKILL.md", false);

  expect(useSkillsStore.getState().skills[0].activation).toBe("disabled");
  expect(useSkillsStore.getState().pendingByPath).toEqual({});
  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "skills/setEnabled",
      params: {
        selector: { path: "builtin://skills/commit/SKILL.md" },
        enabled: false,
      },
    },
    {
      method: "skills/list",
      params: {},
    },
  ]);
});

test("skill mutations preserve the current loaded context", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const useSkillsStore = await loadSkillsStore(async (method, params) => {
    calls.push({ method, params });
    return {
      skills: [skill({ name: "commit", activation: "disabled" })],
      diagnostics: [],
    };
  });
  useSkillsStore.setState({
    loadedContextKey: JSON.stringify({ workspaceId: "ws_1", rootId: "root_1", cwd: "/repo" }),
    loadedContext: { workspaceId: "ws_1", rootId: "root_1", cwd: "/repo" },
  });

  await useSkillsStore.getState().setSkillEnabled("builtin://skills/commit/SKILL.md", false);

  expect(useSkillsStore.getState().loadedContextKey).toBe(
    JSON.stringify({ workspaceId: "ws_1", rootId: "root_1", cwd: "/repo" }),
  );
  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "skills/setEnabled",
      params: {
        selector: { path: "builtin://skills/commit/SKILL.md" },
        enabled: false,
      },
    },
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

test("setSkillExposure preserves current skills and stores an error on failure", async () => {
  const useSkillsStore = await loadSkillsStore(async () => {
    throw new Error("skill not found");
  });
  useSkillsStore.setState({ skills: [skill({ name: "commit" })], loaded: true });

  await useSkillsStore.getState().setSkillExposure("builtin://skills/commit/SKILL.md", "global");

  expect(useSkillsStore.getState().skills.map((item) => item.name)).toEqual(["commit"]);
  expect(useSkillsStore.getState().error).toBe("skill not found");
  expect(useSkillsStore.getState().pendingByPath).toEqual({});
});

function skill(patch: Partial<SkillDescriptor>): SkillDescriptor {
  return {
    id: patch.id ?? `builtin:${patch.name ?? "skill"}`,
    name: patch.name ?? "skill",
    canonicalPath: patch.canonicalPath ?? `builtin://skills/${patch.name ?? "skill"}/SKILL.md`,
    source: patch.source ?? "builtIn",
    exposure: patch.exposure ?? "direct_only",
    activation: patch.activation ?? "enabled",
    description: patch.description ?? "Skill description.",
    shortDescription: patch.shortDescription,
    experimental: patch.experimental ?? false,
    diagnostics: patch.diagnostics ?? [],
    agentMetadata: patch.agentMetadata,
  };
}

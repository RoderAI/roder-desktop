import { expect, test, vi } from "vitest";
import { reasoningEffortsFor, resolveReasoningEffort } from "../src/lib/roder-models";
import type { RoderModel } from "../src/types/roder";

const gptLuna: RoderModel = {
  id: "gpt-6-luna",
  name: "GPT-6 Luna",
  modelProvider: "codex",
  defaultReasoningEffort: "medium",
  reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
};

const haiku: RoderModel = {
  id: "haiku",
  name: "Claude Code Haiku",
  modelProvider: "claude-code",
  reasoningEfforts: [],
};

test("offers only the reasoning efforts the engine advertises for each model", () => {
  expect(reasoningEffortsFor(gptLuna)).toEqual(["none", "low", "medium", "high", "xhigh", "max"]);
  expect(reasoningEffortsFor(haiku)).toEqual([]);
  expect(reasoningEffortsFor(undefined)).toEqual([]);
});

test("keeps a requested effort the selected model supports", () => {
  expect(resolveReasoningEffort(gptLuna, "xhigh")).toBe("xhigh");
});

test("replaces an effort the model does not support with its default instead of sending it", () => {
  // Engine rejects `ultra` for gpt-6-luna with "does not support reasoning effort ultra".
  expect(resolveReasoningEffort(gptLuna, "ultra")).toBe("medium");
});

test("sends no effort for a model that takes none, so the engine uses its own default", () => {
  expect(resolveReasoningEffort(haiku, "medium")).toBeNull();
});

test("uses medium when the model has no usable default, rather than the first effort (which may be none)", () => {
  expect(resolveReasoningEffort({ ...gptLuna, defaultReasoningEffort: undefined }, undefined)).toBe("medium");
});

test("falls back to the first advertised effort when neither the default nor medium is offered", () => {
  const model = { id: "m", name: "m", modelProvider: "p", reasoningEfforts: ["none", "max"] };
  expect(resolveReasoningEffort(model, undefined)).toBe("none");
});

test("sends no effort while the model record is not known yet", () => {
  expect(resolveReasoningEffort(undefined, "medium")).toBeNull();
});

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

test("listProviders maps the engine's snake_case model reasoning fields to the desktop shape", async () => {
  const roderIpc = await loadRoderIpc(async (method) => {
    if (method !== "providers/list") {
      throw new Error(`unexpected ${method}`);
    }
    return {
      active_provider: "codex",
      active_model: "gpt-6-luna",
      active_reasoning: "medium",
      providers: [
        {
          id: "codex",
          name: "Codex",
          auth_type: "o_auth",
          auth_label: "ChatGPT Plus/Pro",
          authenticated: true,
          recommended: true,
          sort_order: 10,
          models: [
            {
              id: "gpt-6-luna",
              name: "GPT-6 Luna",
              context_window: 1050000,
              default_reasoning: "medium",
              supported_reasoning: [
                { effort: "low", description: "Fast responses" },
                { effort: "medium", description: "Balanced" },
              ],
            },
          ],
        },
      ],
      routingOptions: [],
      selectionMode: null,
    };
  });

  const result = await roderIpc.listProviders();

  // The engine sends auth_type "o_auth"; the settings panel checks "oauth".
  expect(result.providers[0]).toMatchObject({ authType: "oauth", sortOrder: 10 });
  expect(result.providers[0].models?.[0]).toMatchObject({
    id: "gpt-6-luna",
    defaultReasoningEffort: "medium",
    reasoningEfforts: ["low", "medium"],
    contextWindow: 1050000,
  });
});

test("setSkillEnabled sends the engine's externally tagged path selector", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return {};
  });

  await roderIpc.setSkillEnabled("/skills/demo/SKILL.md", true);

  // Live engine check: {"path": "<string>"} fails with "expected struct variant";
  // {"path": {"path": "<string>"}} is accepted.
  expect(calls).toEqual([
    {
      method: "skills/setEnabled",
      params: { selector: { path: { path: "/skills/demo/SKILL.md" } }, enabled: true },
    },
  ]);
});

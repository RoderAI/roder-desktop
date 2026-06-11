import { expect, test } from "vitest";
import {
  effectiveSelectedModel,
  groupModelsByProvider,
  modelVisibilityKey,
  selectedModelProvider,
  visibleModelIdsFor,
  visibleModelsFor,
} from "../src/lib/roder-models";
import type { RoderModel } from "../src/types/roder";

test("resolves duplicate model ids with the preferred provider", () => {
  const models: RoderModel[] = [
    { id: "gpt-5.5", name: "GPT-5.5", modelProvider: "codex" },
    { id: "gpt-5.5", name: "gpt-5.5", modelProvider: "opencode" },
  ];

  expect(selectedModelProvider(models, "gpt-5.5", "opencode")).toBe("opencode");
  expect(effectiveSelectedModel(models, [], "gpt-5.5", "opencode")).toMatchObject({
    id: "gpt-5.5",
    modelProvider: "opencode",
  });
});

test("visible model ids are provider-qualified while accepting legacy bare ids", () => {
  const models: RoderModel[] = [
    { id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai" },
    { id: "gpt-5.5", name: "GPT-5.5", modelProvider: "opencode" },
    { id: "claude-code/sonnet", name: "Claude Code Sonnet", modelProvider: "claude-code" },
  ];

  expect(modelVisibilityKey(models[1])).toBe("opencode:gpt-5.5");
  expect(visibleModelIdsFor(models, [])).toEqual([
    "openai:gpt-5.5",
    "opencode:gpt-5.5",
    "claude-code:claude-code/sonnet",
  ]);
  expect(visibleModelsFor(models, ["opencode:gpt-5.5"])).toEqual([models[1]]);
  expect(visibleModelsFor(models, ["gpt-5.5"])).toEqual([models[0], models[1]]);
});

test("groups configured models by provider in source order", () => {
  const models: RoderModel[] = [
    { id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai" },
    { id: "claude-code/sonnet", name: "Claude Code Sonnet", modelProvider: "claude-code" },
    { id: "claude-code/opus", name: "Claude Code Opus", modelProvider: "claude-code" },
  ];

  expect(groupModelsByProvider(models)).toEqual([
    { provider: "openai", models: [models[0]] },
    { provider: "claude-code", models: [models[1], models[2]] },
  ]);
});

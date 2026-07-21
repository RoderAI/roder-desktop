import { expect, test } from "vitest";
import {
  configuredModelsFor,
  displayModelName,
  effectiveSelectedModel,
  groupModelsByProvider,
  modelVisibilityKey,
  selectedModelProvider,
  visibleModelIdsFor,
  visibleModelsFor,
} from "../src/lib/roder-models";
import type { ProviderDescriptor, RoderModel } from "../src/types/roder";

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

test("formats model display names without duplicating the provider name", () => {
  expect(
    displayModelName({
      id: "claude-code/sonnet",
      name: "Claude Code Sonnet 4.7",
      displayName: "Sonnet 4.7",
      modelProvider: "claude-code",
    }),
  ).toBe("Sonnet 4.7");
  expect(
    displayModelName({ id: "claude-code/sonnet", name: "Claude Code Sonnet 4.7", modelProvider: "claude-code" }),
  ).toBe("Sonnet 4.7");
  expect(displayModelName({ id: "claude-code/fable", name: "Claude Code Fable 5", modelProvider: "claude-code" })).toBe(
    "Fable 5",
  );
  expect(displayModelName({ id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai" })).toBe("GPT-5.5");
});

test("filters mock and unconfigured providers from selectable models", () => {
  const models: RoderModel[] = [
    { id: "mock-fast", name: "Mock Fast", modelProvider: "mock" },
    { id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai" },
    { id: "claude-sonnet", name: "Claude Sonnet", modelProvider: "anthropic" },
  ];
  const providers: ProviderDescriptor[] = [
    { id: "mock", name: "Mock", authType: "none", authenticated: true },
    { id: "openai", name: "OpenAI", authType: "api_key", authenticated: true },
    { id: "anthropic", name: "Anthropic", authType: "api_key", authenticated: false },
  ];

  expect(configuredModelsFor(models, providers)).toEqual([models[1]]);
});

test("does not show mock models when mock is the only reported provider", () => {
  const models: RoderModel[] = [{ id: "mock-fast", name: "Mock Fast", modelProvider: "mock" }];
  const providers: ProviderDescriptor[] = [{ id: "mock", name: "Mock", authType: "none", authenticated: true }];

  expect(configuredModelsFor(models, providers)).toEqual([]);
});

test("hidden model ids are provider-qualified while accepting legacy bare ids", () => {
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
  // hiddenModelIds is a blocklist: hiding one provider entry leaves the rest
  expect(visibleModelsFor(models, ["opencode:gpt-5.5"])).toEqual([models[0], models[2]]);
  expect(visibleModelsFor(models, ["gpt-5.5"])).toEqual([models[2]]);
});

test("models from providers/list appear even when absent from stored visibility list", () => {
  const models: RoderModel[] = [
    { id: "gpt-5.5", name: "GPT-5.5", modelProvider: "codex" },
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", modelProvider: "codex" },
    { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", modelProvider: "codex" },
    { id: "grok-4.5", name: "Grok 4.5", modelProvider: "opencode" },
  ];

  // Stale allowlist-era customization only hid gpt-5.5; new catalog models must still show.
  expect(visibleModelsFor(models, ["codex:gpt-5.5"]).map((model) => model.id)).toEqual([
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "grok-4.5",
  ]);
  expect(visibleModelIdsFor(models, [])).toEqual([
    "codex:gpt-5.5",
    "codex:gpt-5.6-sol",
    "codex:gpt-5.6-terra",
    "opencode:grok-4.5",
  ]);
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

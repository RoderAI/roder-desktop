import { expect, test, vi } from "vitest";
import {
  buildModelPickerGroups,
  chooseModelPickerItem,
  modelProviderReady,
  validateProviderSettingsSearch,
} from "../src/lib/model-picker";
import type { ProviderDescriptor, RoderModel } from "../src/types/roder";

const providers: ProviderDescriptor[] = [
  { id: "openai", name: "OpenAI", authType: "api_key", authenticated: true },
  { id: "codex", name: "Codex", authType: "oauth", authenticated: true },
  { id: "builtin", name: "Built in", authType: "none", authenticated: false },
  { id: "local", name: "Local", authType: "local" },
  {
    id: "openrouter",
    name: "OpenRouter",
    authType: "api_key",
    authenticated: false,
    models: [{ id: "sol", name: "GPT-6.1-Sol" }],
  },
];
const models: RoderModel[] = [
  { id: "sol", name: "GPT-6.1-Sol", modelProvider: "openai" },
  { id: "oauth", name: "OAuth model", modelProvider: "codex" },
  { id: "built", name: "Builtin model", modelProvider: "builtin" },
  { id: "local", name: "Local model", modelProvider: "local" },
  { id: "sol", name: "GPT-6.1-Sol", modelProvider: "openrouter" },
];

test("configured models come first and unconfigured catalog models only become bottom setup actions", () => {
  const groups = buildModelPickerGroups(models.slice(0, -1), providers, []);
  expect(groups.at(-1)?.label).toBe("Set up provider");
  expect(groups.at(-1)?.items).toEqual([
    expect.objectContaining({
      type: "setup",
      model: expect.objectContaining(models.at(-1)!),
      providerId: "openrouter",
    }),
  ]);
  expect(
    groups
      .slice(0, -1)
      .flatMap((group) => group.items)
      .map((item) => item.type),
  ).toEqual(["model", "model", "model", "model"]);
  expect(buildModelPickerGroups(models, providers, []).at(-1)?.items).toHaveLength(1);
  expect(modelProviderReady(models[1], providers)).toBe(true);
  expect(modelProviderReady(models[2], providers)).toBe(true);
  expect(modelProviderReady(models[3], providers)).toBe(true);
  expect(modelProviderReady(models[0], [])).toBe(false);
  expect(buildModelPickerGroups(models, [], [])).toEqual([]);
  expect(
    buildModelPickerGroups([{ id: "unknown", name: "Unknown", modelProvider: "not-in-catalog" }], providers, [])
      .flatMap((group) => group.items)
      .some((item) => item.type !== "auto" && item.model.modelProvider === "not-in-catalog"),
  ).toBe(false);
});

test("setup actions navigate to that provider without changing the selected model", () => {
  const onChange = vi.fn<(id: string, provider?: string) => void>();
  const onAutoChange = vi.fn<(id: string) => void>();
  const onProviderSetup = vi.fn<(id: string) => void>();
  chooseModelPickerItem(
    { type: "setup", model: models[4], providerId: "openrouter", providerLabel: "OpenRouter" },
    { onChange, onAutoChange, onProviderSetup },
  );
  expect(onProviderSetup).toHaveBeenCalledWith("openrouter");
  expect(onChange).not.toHaveBeenCalled();
  expect(onAutoChange).not.toHaveBeenCalled();
});

test("authenticated status changes move models into selectable groups and unavailable routing is not selectable", () => {
  const configured = providers.map((provider) => ({ ...provider, authenticated: true }));
  expect(
    buildModelPickerGroups(models, configured, [])
      .flatMap((group) => group.items)
      .every((item) => item.type === "model"),
  ).toBe(true);
  const routing = [
    { id: "coding", label: "Auto coding", routerId: "local", baseline: { provider: "openrouter", model: "sol" } },
  ];
  expect(
    buildModelPickerGroups(models, providers, routing)
      .flatMap((group) => group.items)
      .some((item) => item.type === "auto"),
  ).toBe(false);
  expect(buildModelPickerGroups(models, configured, routing)[0].items[0].type).toBe("auto");
});

test("provider Settings search accepts only a bounded provider ID", () => {
  expect(validateProviderSettingsSearch({ setupProvider: "openrouter" })).toEqual({ setupProvider: "openrouter" });
  for (const setupProvider of [true, {}, "", "x".repeat(501)])
    expect(validateProviderSettingsSearch({ setupProvider })).toEqual({});
});

test("provider case and documented aliases retain the original model metadata and target the real provider ID", () => {
  const aliased = {
    id: "sol",
    name: "Internal catalog name",
    displayName: "Chosen label",
    modelProvider: "OpenCode-Zen",
    reasoningEfforts: ["low", "high"],
  };
  const catalog: ProviderDescriptor[] = [
    {
      id: "opencode",
      name: "OpenCode Zen",
      authType: "api_key",
      authenticated: false,
      models: [{ id: "sol", name: "Duplicate" }],
    },
  ];
  const groups = buildModelPickerGroups([aliased], catalog, []);
  expect(groups.flatMap((group) => group.items)).toEqual([
    { type: "setup", model: aliased, providerId: "opencode", providerLabel: "OpenCode Zen" },
  ]);
  expect(modelProviderReady({ modelProvider: "OpenAI" }, providers)).toBe(true);
});

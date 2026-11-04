import { afterEach, expect, test, vi } from "vitest";
import { detectEnvironmentProviders } from "../electron/onboarding/environment";
import { groupProvidersForOnboarding, providerSetupKind } from "../src/lib/onboarding";
import { providerCopy } from "../src/lib/provider-copy";
import { listCustomProviderTables, validateCustomProviderDraft } from "../src/lib/roder-custom-providers";
import {
  configuredModelsFor,
  providerName,
  reasoningEffortsFor,
  resolveReasoningEffort,
} from "../src/lib/roder-models";

afterEach(() => {
  vi.unstubAllGlobals();
});

test.each([
  [{ HOPPER_API_KEY: "primary-secret", RODER_HOPPER_API_KEY: "alias-secret" }, "HOPPER_API_KEY"],
  [{ RODER_HOPPER_API_KEY: "alias-secret" }, "RODER_HOPPER_API_KEY"],
  [{ HOPPER_API_KEY: "  ", RODER_HOPPER_API_KEY: "alias-secret" }, "RODER_HOPPER_API_KEY"],
])("detects Hopper keys without exposing their values: %j", (env, envVar) => {
  const detected = detectEnvironmentProviders(env);
  expect(detected).toEqual([{ providerId: "hopper", label: "Hopper", envVar }]);
  expect(JSON.stringify(detected)).not.toContain("secret");
});

test("does not advertise a blank Hopper API key as connected", () => {
  expect(detectEnvironmentProviders({ HOPPER_API_KEY: " ", RODER_HOPPER_API_KEY: "" })).toEqual([]);
});

test("gives Hopper API-key connection cards readable native provider copy", () => {
  expect(providerCopy.hopper).toMatchObject({
    title: "Hopper",
    method: "API key",
  });
  expect(providerCopy.hopper.description).toMatch(/DeepSeek/);
  expect(providerName("hopper")).toBe("Hopper");
});

test("reserves Hopper configuration for the built-in provider", () => {
  expect(
    validateCustomProviderDraft({
      id: "hopper",
      baseUrl: "https://example.com/v1",
      apiKey: "test-secret",
    }),
  ).toMatch(/built-in/i);
  expect(
    listCustomProviderTables(`
[providers.hopper]
api_key = "test-secret"
base_url = "https://example.com/v1"

[providers.local-gateway]
base_url = "http://localhost:8080/v1"
api_key_env = "LOCAL_KEY"
`),
  ).toEqual([
    {
      id: "local-gateway",
      baseUrl: "http://localhost:8080/v1",
      apiKeyEnv: "LOCAL_KEY",
    },
  ]);
});

test("uses Hopper's backend catalog, API-key setup, and advertised reasoning end to end", async () => {
  vi.resetModules();
  const efforts = ["none", "low", "high", "xhigh", "max"];
  const modelIds = ["deepseek-v4.1-flash-1017", "deepseek-v4.1-flash-1017-abliterated", "future-catalog-model"];
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method) => {
    if (method === "providers/list") {
      return {
        active_provider: "hopper",
        active_model: modelIds[0],
        active_reasoning: "high",
        providers: [
          {
            id: "hopper",
            name: "Hopper",
            auth_type: "api_key",
            authenticated: true,
            models: modelIds.map((id) => ({
              id,
              name: id,
              context_window: 1000000,
              default_reasoning: "high",
              supported_reasoning: efforts.map((effort) => ({ effort, description: effort })),
            })),
          },
        ],
      };
    }
    if (method === "providers/configure") {
      return { configured: true };
    }
    throw new Error(`unexpected ${method}`);
  });
  const localStorage = {
    getItem: () => null,
    setItem: vi.fn<(key: string, value: string) => void>(),
    removeItem: vi.fn<(key: string) => void>(),
  };
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("window", { localStorage, roderDesktop: { request } });
  const { useRoderStore } = await import("../src/stores/roder-store");
  await useRoderStore.getState().refreshProviders();
  const result = useRoderStore.getState();
  const hopper = result.providers[0];
  expect(providerSetupKind(hopper)).toBe("api-key");
  expect(groupProvidersForOnboarding(result.providers).more).toEqual([hopper]);
  expect(result.models.map((model) => model.id)).toEqual(modelIds);
  expect(configuredModelsFor(result.models, result.providers)).toEqual(result.models);
  for (const model of result.models) {
    expect(model.modelProvider).toBe("hopper");
    expect(reasoningEffortsFor(model)).toEqual(efforts);
    expect(resolveReasoningEffort(model, "medium")).toBe("high");
    expect(resolveReasoningEffort(model, "none")).toBe("none");
    expect(resolveReasoningEffort(model, "max")).toBe("max");
  }
  await result.configureProvider("hopper", "test-secret");
  expect(request).toHaveBeenCalledWith("providers/configure", {
    provider: "hopper",
    api_key: "test-secret",
  });
});

import { expect, test } from "vitest";
import {
  listCustomProviderTables,
  normalizeCustomProviderId,
  parseModelIds,
  removeCustomProviderTable,
  removeModelsCacheProvider,
  seedModelsCache,
  upsertCustomProviderTable,
  validateCustomProviderDraft,
} from "../src/lib/roder-custom-providers";

test("normalizes provider ids to lowercase slug form", () => {
  expect(normalizeCustomProviderId(" Local OpenAI ")).toBe("local-openai");
  expect(normalizeCustomProviderId("My.Gateway_1")).toBe("my.gateway_1");
});

test("rejects builtin provider ids and invalid drafts", () => {
  expect(
    validateCustomProviderDraft({
      id: "openai",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
    }),
  ).toMatch(/built-in/i);

  expect(
    validateCustomProviderDraft({
      id: "local-openai",
      baseUrl: "not-a-url",
      apiKey: "sk-test",
    }),
  ).toMatch(/valid url/i);

  expect(
    validateCustomProviderDraft({
      id: "local-openai",
      baseUrl: "https://api.example.com/v1",
    }),
  ).toMatch(/api key/i);
});

test("parses model ids from comma and newline lists", () => {
  expect(parseModelIds("gpt-4o, llama3\nllama3")).toEqual(["gpt-4o", "llama3"]);
});

test("upserts a custom provider table without rewriting unrelated config", () => {
  const original = `provider = "openai"
model = "gpt-5.5"

[providers.openai]
api_key = "sk-openai"

[web_search]
enabled = true
`;

  const next = upsertCustomProviderTable(original, {
    id: "local-openai",
    baseUrl: "http://localhost:11434/v1",
    apiKey: "sk-local",
  });

  expect(next).toContain('provider = "openai"');
  expect(next).toContain("[providers.openai]");
  expect(next).toContain('api_key = "sk-openai"');
  expect(next).toContain("[web_search]");
  expect(next).toContain("[providers.local-openai]");
  expect(next).toContain('base_url = "http://localhost:11434/v1"');
  expect(next).toContain('api_key = "sk-local"');

  const updated = upsertCustomProviderTable(next, {
    id: "local-openai",
    baseUrl: "http://127.0.0.1:8080/v1",
    apiKeyEnv: "LOCAL_OPENAI_API_KEY",
  });
  expect(updated).toContain('base_url = "http://127.0.0.1:8080/v1"');
  expect(updated).toContain('api_key_env = "LOCAL_OPENAI_API_KEY"');
  expect(updated).not.toContain('api_key = "sk-local"');
  expect(updated.match(/\[providers\.local-openai\]/g)).toHaveLength(1);
});

test("lists and removes only custom provider tables", () => {
  const toml = `
[providers.openai]
api_key = "sk"

[providers.local-openai]
base_url = "http://localhost:11434/v1"
api_key = "sk-local"

[providers.other]
base_url = "https://other.example/v1"
api_key_env = "OTHER_KEY"
`;

  expect(listCustomProviderTables(toml).map((entry) => entry.id)).toEqual(["local-openai", "other"]);

  const removed = removeCustomProviderTable(toml, "local-openai");
  expect(removed).not.toContain("[providers.local-openai]");
  expect(removed).toContain("[providers.openai]");
  expect(removed).toContain("[providers.other]");
  expect(listCustomProviderTables(removed).map((entry) => entry.id)).toEqual(["other"]);
});

test("seeds and clears models-cache entries for custom providers", () => {
  const seeded = seedModelsCache(
    { providers: {} },
    "local-openai",
    "http://localhost:11434/v1/",
    ["llama3.2", "gpt-oss"],
    1_700_000_000,
  );

  expect(seeded.providers["local-openai"]).toEqual({
    fetched_at: 1_700_000_000,
    base_url: "http://localhost:11434/v1",
    models: [
      {
        id: "llama3.2",
        name: "llama3.2",
        context_window: null,
        default_reasoning: null,
        supported_reasoning: [],
      },
      {
        id: "gpt-oss",
        name: "gpt-oss",
        context_window: null,
        default_reasoning: null,
        supported_reasoning: [],
      },
    ],
  });

  expect(removeModelsCacheProvider(seeded, "local-openai").providers["local-openai"]).toBeUndefined();
});

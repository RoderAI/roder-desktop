import { expect, test, vi } from "vitest";
import { isRetiredModel } from "../src/lib/roder-models";

test("recognises retired GPT-5.x model ids, including routed and variant ids", () => {
  for (const id of [
    "gpt-5.5",
    "gpt-5.5-fast",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.6-sol",
    "gpt-5.6-luna",
    "gpt-5.3-codex-spark",
    "roder.cloud/openai/gpt-5.5",
    "openai/gpt-5.6-sol",
  ]) {
    expect({ id, retired: isRetiredModel({ id }) }).toEqual({ id, retired: true });
  }
});

test("keeps GPT-6 models and unrelated ids", () => {
  for (const id of ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-6.1-sol", "gpt-oss-120b", "claude-sonnet-5-5"]) {
    expect({ id, retired: isRetiredModel({ id }) }).toEqual({ id, retired: false });
  }
});

test("the store catalog drops retired GPT-5.x models after a providers refresh", async () => {
  vi.resetModules();
  const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  } as unknown as Storage;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  const providers = [
    {
      id: "codex",
      name: "Codex",
      auth_type: "o_auth",
      authenticated: true,
      recommended: true,
      sort_order: 10,
      models: [
        {
          id: "gpt-6-sol",
          name: "GPT-6 Sol",
          default_reasoning: "medium",
          supported_reasoning: [{ effort: "medium" }],
        },
        { id: "gpt-5.5", name: "GPT-5.5", default_reasoning: "medium", supported_reasoning: [{ effort: "medium" }] },
      ],
    },
    {
      id: "cursor",
      name: "Cursor",
      auth_type: "api_key",
      authenticated: true,
      sort_order: 20,
      models: [{ id: "gpt-5.5-fast", name: "GPT-5.5 Fast", supported_reasoning: [] }],
    },
  ];
  globalThis.window = {
    localStorage: storage,
    roderDesktop: {
      start: vi.fn<Window["roderDesktop"]["start"]>(async () => ({
        state: "ready",
        binary: "test",
        cwd: "/workspace",
      })),
      restart: vi.fn<Window["roderDesktop"]["start"]>(async () => ({
        state: "ready",
        binary: "test",
        cwd: "/workspace",
      })),
      status: vi.fn<Window["roderDesktop"]["status"]>(async () => ({
        state: "ready",
        binary: "test",
        cwd: "/workspace",
      })),
      appearance: vi.fn<Window["roderDesktop"]["appearance"]>(async () => "light"),
      openWorkspaceFolder: vi.fn<Window["roderDesktop"]["openWorkspaceFolder"]>(async () => null),
      openWorkspaceFolders: vi.fn<Window["roderDesktop"]["openWorkspaceFolders"]>(async () => null),
      request: vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method) => {
        if (method === "providers/list") {
          return {
            active_provider: "codex",
            active_model: "gpt-6-sol",
            active_reasoning: "medium",
            providers,
            routingOptions: [],
            selectionMode: null,
          };
        }
        return {};
      }),
      onAppearance: () => () => undefined,
      onNotification: () => () => undefined,
      onStatus: () => () => undefined,
      onStderr: () => () => undefined,
    },
  } as unknown as Window & typeof globalThis;

  const { useRoderStore } = await import("../src/stores/roder-store");
  await useRoderStore.getState().refreshProviders();

  expect(useRoderStore.getState().models.map((model) => model.id)).toEqual(["gpt-6-sol"]);
});

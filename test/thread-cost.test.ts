import { mkdir, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  estimateThreadCost,
  findModelPricing,
  formatEstimatedCost,
  openRouterPricing,
  sumTokenCategories,
  type PricingSnapshot,
} from "@/lib/thread-cost";

vi.mock("node:fs/promises", () => ({ mkdir: vi.fn<typeof mkdir>(), writeFile: vi.fn<typeof writeFile>() }));

const snapshot: PricingSnapshot = {
  source: "https://openrouter.ai/api/v1/models",
  fetchedAt: "2026-10-23T00:00:00Z",
  models: [
    {
      id: "anthropic/claude-test",
      name: "Claude Test",
      pricing: {
        prompt: "0.000003",
        completion: "0.000015",
        input_cache_read: "0.0000003",
        input_cache_write: "0.00000375",
      },
    },
    { id: "openai/test", name: "Test", pricing: { prompt: "0.000001", completion: "0.000002" } },
    { id: "other/test", name: "Other Test", pricing: { prompt: "0", completion: "0" } },
    { id: "router/auto", name: "Auto", pricing: { prompt: "-1", completion: "-1" } },
  ],
};

describe("thread cost estimates", () => {
  it("bundles a dated, unique OpenRouter pricing snapshot for offline use", () => {
    expect(openRouterPricing.source).toBe("https://openrouter.ai/api/v1/models");
    expect(Number.isFinite(Date.parse(openRouterPricing.fetchedAt))).toBe(true);
    expect(openRouterPricing.models.length).toBeGreaterThan(0);
    expect(new Set(openRouterPricing.models.map((model) => model.id)).size).toBe(openRouterPricing.models.length);
    for (const model of openRouterPricing.models) {
      expect(Number.isFinite(Number(model.pricing.prompt))).toBe(true);
      expect(Number.isFinite(Number(model.pricing.completion))).toBe(true);
    }
  });

  it("does not round nonzero spend down to free or missing usage to zero", () => {
    expect(formatEstimatedCost(0.0002)).toBe("<$0.01");
    expect(formatEstimatedCost(0)).toBe("$0.00");
    expect(formatEstimatedCost(null)).toBe("Unavailable");
    expect(formatEstimatedCost(1.234)).toBe("$1.23");
    for (const invalid of [NaN, Infinity, -Infinity, -0.001]) {
      expect(formatEstimatedCost(invalid)).toBe("Unavailable");
    }
  });

  it("prices input, cached input and output separately across models", () => {
    const result = estimateThreadCost(
      [
        { group: "claude-test", promptTokens: 1000, cachedPromptTokens: 400, completionTokens: 100 },
        { group: "openai/test", promptTokens: 200, cachedPromptTokens: 0, completionTokens: 50 },
      ],
      snapshot,
    );
    expect(result.total).toBeCloseTo(0.00372);
    expect(result.unpricedModels).toEqual([]);
    expect(result.models[0].cost).toBeCloseTo(0.00342);
    expect(result.models[0].categories).toEqual([
      { label: "Uncached input", tokens: 600, cost: 600 * 0.000003 },
      { label: "Cache read", tokens: 400, cost: 400 * 0.0000003 },
      { label: "Cache write", tokens: 0, cost: 0 },
      { label: "Output", tokens: 100, cost: 100 * 0.000015 },
    ]);
    expect(result.categories.map((category) => category.tokens)).toEqual([800, 400, 0, 150]);
    expect(result.partial).toBe(false);
  });

  it("prices cache creation separately as a subset of reported input", () => {
    const result = estimateThreadCost(
      [
        {
          group: "claude-test",
          promptTokens: 1000,
          cachedPromptTokens: 400,
          cacheCreationPromptTokens: 200,
          completionTokens: 100,
        },
      ],
      snapshot,
    );
    expect(result.models[0].categories).toEqual([
      { label: "Uncached input", tokens: 400, cost: 400 * 0.000003 },
      { label: "Cache read", tokens: 400, cost: 400 * 0.0000003 },
      { label: "Cache write", tokens: 200, cost: 200 * 0.00000375 },
      { label: "Output", tokens: 100, cost: 100 * 0.000015 },
    ]);
    expect(result.total).toBeCloseTo(0.00357);
    expect(result.models[0].knownCost).toBeCloseTo(result.total!);
  });

  it("never substitutes another rate for a missing cache-write price", () => {
    const result = estimateThreadCost(
      [
        {
          group: "openai/test",
          promptTokens: 100,
          cachedPromptTokens: 20,
          cacheCreationPromptTokens: 30,
          completionTokens: 10,
        },
      ],
      snapshot,
    );
    expect(result.models[0].cost).toBeNull();
    expect(result.models[0].knownCost).toBeCloseTo(0.00009);
    expect(result.models[0].categories[2]).toEqual({
      label: "Cache write",
      tokens: 30,
      cost: null,
      partial: true,
    });
    expect(result.total).toBeCloseTo(0.00009);
    expect(result.partial).toBe(true);
    expect(result.unpricedModels).toEqual(["openai/test"]);
  });

  it("keeps read and output subtotals when cache writes cannot be attributed to this model", () => {
    const result = estimateThreadCost(
      [
        {
          group: "claude-test",
          promptTokens: 1000,
          cachedPromptTokens: 400,
          completionTokens: 100,
          cacheWriteTokensUnknown: true,
        },
      ],
      snapshot,
    );
    expect(result.models[0].categories).toEqual([
      { label: "Uncached input", tokens: null, cost: null, partial: true },
      { label: "Cache read", tokens: 400, cost: 400 * 0.0000003 },
      { label: "Cache write", tokens: null, cost: null, partial: true },
      { label: "Output", tokens: 100, cost: 100 * 0.000015 },
    ]);
    expect(result.models[0].cost).toBeNull();
    expect(result.models[0].knownCost).toBeCloseTo(0.00162);
    expect(result.total).toBeCloseTo(0.00162);
    expect(result.partial).toBe(true);
    expect(result.unpricedModels).toEqual(["claude-test"]);
  });

  it("does not guess ambiguous, unknown or dynamically priced models", () => {
    expect(findModelPricing("test", snapshot)).toBeUndefined();
    expect(findModelPricing("unlisted/claude-test", snapshot)).toBeUndefined();
    expect(
      findModelPricing("openai/test", { ...snapshot, models: [...snapshot.models, snapshot.models[1]] }),
    ).toBeUndefined();
    const result = estimateThreadCost(
      [
        { group: "missing", promptTokens: 100, completionTokens: 5, cachedPromptTokens: 0 },
        { group: "router/auto", promptTokens: 100, completionTokens: 5, cachedPromptTokens: 0 },
      ],
      snapshot,
    );
    expect(result.total).toBeNull();
    expect(result.models.every((model) => model.knownCost === null)).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.unpricedModels).toEqual(["missing", "router/auto"]);
  });

  it("retains a known subtotal without presenting missing prices as free", () => {
    const result = estimateThreadCost(
      [
        { group: "openai/test", promptTokens: 1000, completionTokens: 0, cachedPromptTokens: 0 },
        { group: "unknown", promptTokens: 1000, completionTokens: 0, cachedPromptTokens: 0 },
      ],
      snapshot,
    );
    expect(result.total).toBeCloseTo(0.001);
    expect(result.models[1].cost).toBeNull();
    expect(result.unpricedModels).toEqual(["unknown"]);
    expect(result.categories[0]).toEqual({
      label: "Uncached input",
      tokens: 2000,
      cost: 0.001,
      partial: true,
    });
    expect(result.partial).toBe(true);
  });

  it("accepts explicit free pricing and distinguishes absent usage", () => {
    expect(estimateThreadCost([], snapshot).total).toBeNull();
    expect(
      estimateThreadCost(
        [{ group: "other/test", promptTokens: 10, completionTokens: 20, cachedPromptTokens: 0 }],
        snapshot,
      ).total,
    ).toBe(0);
    const zeroUsage = estimateThreadCost(
      [{ group: "unknown", promptTokens: 0, completionTokens: 0, cachedPromptTokens: 0 }],
      snapshot,
    );
    expect(zeroUsage.total).toBe(0);
    expect(zeroUsage.unpricedModels).toEqual([]);
    expect(zeroUsage.categories.every((category) => category.cost === 0)).toBe(true);
  });

  it("falls back to input pricing for unreported cache rates and bounds cache counts", () => {
    const result = estimateThreadCost(
      [{ group: "openai/test", promptTokens: 100, completionTokens: 0, cachedPromptTokens: 500 }],
      snapshot,
    );
    expect(result.total).toBeCloseTo(0.0001);
    expect(result.models[0].categories.map((category) => category.tokens)).toEqual([0, 100, 0, 0]);
    expect(result.models[0].categories[1].cost).toBeCloseTo(0.0001);
  });

  it("shows reported categories without inventing unknown prices or invalid token counts", () => {
    const result = estimateThreadCost(
      [
        { group: "unknown", promptTokens: 10, completionTokens: 2, cachedPromptTokens: 4 },
        { group: "openai/test", promptTokens: -1, completionTokens: 2, cachedPromptTokens: 0 },
      ],
      snapshot,
    );
    expect(result.models[0].categories.map((category) => category.tokens)).toEqual([6, 4, 0, 2]);
    expect(result.models[0].categories.map((category) => category.cost)).toEqual([null, null, 0, null]);
    expect(result.models[1].categories.every((category) => category.tokens === null && category.cost === null)).toBe(
      true,
    );
    expect(estimateThreadCost([], snapshot).categories.every((category) => category.tokens === null)).toBe(true);
  });

  it.each([
    { cachedPromptTokens: 80, cacheCreationPromptTokens: 30 },
    { cachedPromptTokens: 0, cacheCreationPromptTokens: 101 },
    { cachedPromptTokens: 0, cacheCreationPromptTokens: -1 },
    { cachedPromptTokens: 0, cacheCreationPromptTokens: NaN },
    { cachedPromptTokens: 0, cacheCreationPromptTokens: Infinity },
    { cachedPromptTokens: 0, cacheCreationPromptTokens: 0.5 },
    { cachedPromptTokens: 0, cacheCreationPromptTokens: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects impossible or invalid cache creation counts: %j", (counts) => {
    const result = estimateThreadCost(
      [{ group: "claude-test", promptTokens: 100, completionTokens: 2, ...counts }],
      snapshot,
    );
    expect(result.models[0].cost).toBeNull();
    expect(result.models[0].knownCost).toBeNull();
    expect(result.models[0].categories.every((category) => category.tokens === null && category.cost === null)).toBe(
      true,
    );
    expect(result.total).toBeNull();
    expect(result.partial).toBe(true);
  });

  it("retains known category subtotals when another model has invalid usage", () => {
    const result = estimateThreadCost(
      [
        { group: "openai/test", promptTokens: 100, cachedPromptTokens: 20, completionTokens: 10 },
        { group: "claude-test", promptTokens: -1, cachedPromptTokens: 0, completionTokens: 10 },
      ],
      snapshot,
    );
    expect(result.total).toBeCloseTo(0.00012);
    expect(result.categories).toEqual([
      { label: "Uncached input", tokens: 80, cost: 80 * 0.000001, partial: true },
      { label: "Cache read", tokens: 20, cost: 20 * 0.000001, partial: true },
      { label: "Cache write", tokens: 0, cost: 0, partial: true },
      { label: "Output", tokens: 10, cost: 10 * 0.000002, partial: true },
    ]);
  });

  it("keeps partial category markers when aggregating already aggregated subtotals", () => {
    const categories = sumTokenCategories([
      [
        { label: "Uncached input", tokens: 10, cost: 0.01, partial: true },
        { label: "Cache read", tokens: 0, cost: 0 },
        { label: "Cache write", tokens: 0, cost: 0 },
        { label: "Output", tokens: 0, cost: 0 },
      ],
    ]);
    expect(categories[0]).toEqual({ label: "Uncached input", tokens: 10, cost: 0.01, partial: true });
  });

  it("does not treat overflowing costs as valid estimates", () => {
    const result = estimateThreadCost(
      [{ group: "huge", promptTokens: 2, cachedPromptTokens: 0, completionTokens: 0 }],
      {
        ...snapshot,
        models: [{ id: "huge", name: "Huge", pricing: { prompt: String(Number.MAX_VALUE), completion: "0" } }],
      },
    );
    expect(result.total).toBeNull();
    expect(result.models[0].cost).toBeNull();
    expect(result.models[0].knownCost).toBeNull();
    expect(result.models[0].categories[0].cost).toBeNull();
  });

  it.each([
    { promptTokens: 0.5, cachedPromptTokens: 0, completionTokens: 0 },
    { promptTokens: 1, cachedPromptTokens: 0.5, completionTokens: 0 },
    { promptTokens: 1, cachedPromptTokens: 0, completionTokens: 0.5 },
    { promptTokens: Number.MAX_SAFE_INTEGER + 1, cachedPromptTokens: 0, completionTokens: 0 },
    { promptTokens: 1, cachedPromptTokens: Number.MAX_SAFE_INTEGER + 1, completionTokens: 0 },
    { promptTokens: 1, cachedPromptTokens: 0, completionTokens: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects fractional or unsafe protocol token counts: %j", (counts) => {
    const result = estimateThreadCost([{ group: "openai/test", ...counts }], snapshot);
    expect(result.total).toBeNull();
    expect(result.models[0].categories.every((category) => category.tokens === null && category.cost === null)).toBe(
      true,
    );
  });

  it("does not fall back from explicitly invalid cache prices to ordinary input rates", () => {
    const result = estimateThreadCost(
      [
        {
          group: "invalid-cache",
          promptTokens: 100,
          cachedPromptTokens: 100,
          completionTokens: 0,
        },
      ],
      {
        ...snapshot,
        models: [
          {
            id: "invalid-cache",
            name: "Invalid Cache",
            pricing: { prompt: "0.000001", completion: "0.000002", input_cache_read: "-1" },
          },
        ],
      },
    );
    expect(result.total).toBeNull();
    expect(result.models[0].categories[1].cost).toBeNull();
  });
});

describe("pricing snapshot refresh", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("preserves reported cache-write rates without inventing missing rates", async () => {
    const data = [
      {
        id: "vendor/cached",
        name: "Cached",
        pricing: {
          prompt: "0.000003",
          completion: "0.000015",
          input_cache_read: "0.0000003",
          input_cache_write: "0.00000375",
        },
      },
      { id: "vendor/absent", name: "Absent", pricing: { prompt: "0.000001", completion: "0.000002" } },
      {
        id: "vendor/invalid",
        name: "Invalid",
        pricing: { prompt: "0.000001", completion: "0.000002", input_cache_write: 0.00000125 },
      },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data }) }));
    vi.spyOn(console, "log").mockImplementation(() => {});

    await import("../scripts/update-openrouter-pricing.mjs");

    expect(fetch).toHaveBeenCalledWith("https://openrouter.ai/api/v1/models");
    expect(mkdir).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledTimes(1);
    const written = JSON.parse(String(vi.mocked(writeFile).mock.calls[0][1])) as PricingSnapshot;
    expect(written.models.find((model) => model.id === "vendor/cached")?.pricing.input_cache_write).toBe("0.00000375");
    expect(written.models.find((model) => model.id === "vendor/absent")?.pricing).not.toHaveProperty(
      "input_cache_write",
    );
    expect(written.models.find((model) => model.id === "vendor/invalid")?.pricing).not.toHaveProperty(
      "input_cache_write",
    );
  });
});

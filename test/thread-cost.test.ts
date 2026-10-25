import { describe, expect, it } from "vitest";
import {
  estimateThreadCost,
  findModelPricing,
  formatEstimatedCost,
  openRouterPricing,
  type PricingSnapshot,
} from "@/lib/thread-cost";

const snapshot: PricingSnapshot = {
  source: "https://openrouter.ai/api/v1/models",
  fetchedAt: "2026-10-23T00:00:00Z",
  models: [
    {
      id: "anthropic/claude-test",
      name: "Claude Test",
      pricing: { prompt: "0.000003", completion: "0.000015", input_cache_read: "0.0000003" },
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
      { label: "Output", tokens: 100, cost: 100 * 0.000015 },
    ]);
    expect(result.categories.map((category) => category.tokens)).toEqual([800, 400, 150]);
  });

  it("does not guess ambiguous, unknown or dynamically priced models", () => {
    expect(findModelPricing("test", snapshot)).toBeUndefined();
    const result = estimateThreadCost(
      [
        { group: "missing", promptTokens: 100, completionTokens: 5, cachedPromptTokens: 0 },
        { group: "router/auto", promptTokens: 100, completionTokens: 5, cachedPromptTokens: 0 },
      ],
      snapshot,
    );
    expect(result.total).toBeNull();
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
  });

  it("accepts explicit free pricing and distinguishes absent usage", () => {
    expect(estimateThreadCost([], snapshot).total).toBeNull();
    expect(
      estimateThreadCost(
        [{ group: "other/test", promptTokens: 10, completionTokens: 20, cachedPromptTokens: 0 }],
        snapshot,
      ).total,
    ).toBe(0);
  });

  it("falls back to input pricing for unreported cache rates and bounds cache counts", () => {
    const result = estimateThreadCost(
      [{ group: "openai/test", promptTokens: 100, completionTokens: 0, cachedPromptTokens: 500 }],
      snapshot,
    );
    expect(result.total).toBeCloseTo(0.0001);
    expect(result.models[0].categories.map((category) => category.tokens)).toEqual([0, 100, 0]);
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
    expect(result.models[0].categories.map((category) => category.tokens)).toEqual([6, 4, 2]);
    expect(result.models[0].categories.every((category) => category.cost === null)).toBe(true);
    expect(result.models[1].categories.every((category) => category.tokens === null && category.cost === null)).toBe(
      true,
    );
    expect(estimateThreadCost([], snapshot).categories.every((category) => category.tokens === null)).toBe(true);
  });
});

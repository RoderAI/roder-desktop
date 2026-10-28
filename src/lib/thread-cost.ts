import bundledPricing from "@/data/openrouter-pricing.json";

export type PricingSnapshot = {
  source: string;
  fetchedAt: string;
  models: {
    id: string;
    name: string;
    pricing: { prompt: string; completion: string; input_cache_read?: string; input_cache_write?: string };
  }[];
};

export type ModelTokenUsage = {
  group: string;
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens: number;
  cacheCreationPromptTokens?: number;
  cacheWriteTokensUnknown?: boolean;
};

export const openRouterPricing: PricingSnapshot = bundledPricing;
const usdFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function findModelPricing(model: string, snapshot = openRouterPricing) {
  const exact = snapshot.models.filter((entry) => entry.id === model);
  if (exact.length) return exact.length === 1 ? exact[0] : undefined;
  if (model.includes("/")) return undefined;
  const matches = snapshot.models.filter((entry) => entry.id.split("/").at(-1) === model);
  return matches.length === 1 ? matches[0] : undefined;
}

function rate(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export type TokenCostCategory = {
  label: string;
  tokens: number | null;
  cost: number | null;
  partial?: boolean;
};
const tokenCategoryLabels = ["Uncached input", "Cache read", "Cache write", "Output"];

function validCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validCost(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function sumKnown(values: (number | null)[]): number | null {
  const known = values.filter(validCost);
  if (!known.length) return null;
  const total = known.reduce((sum, value) => sum + value, 0);
  return validCost(total) ? total : null;
}

export function sumTokenCategories(breakdowns: TokenCostCategory[][]): TokenCostCategory[] {
  return tokenCategoryLabels.map((label) => {
    const entries = breakdowns.map((categories) => categories.find((category) => category.label === label));
    const tokenSubtotal = sumKnown(entries.map((entry) => (validCount(entry?.tokens) ? entry.tokens : null)));
    const tokens = validCount(tokenSubtotal) ? tokenSubtotal : null;
    const cost = sumKnown(entries.map((entry) => (validCost(entry?.cost) ? entry.cost : null)));
    const partial =
      entries.length > 0 &&
      (tokens === null ||
        cost === null ||
        entries.some((entry) => entry?.partial || !validCount(entry?.tokens) || !validCost(entry?.cost)));
    return {
      label,
      tokens,
      cost,
      ...(partial ? { partial: true } : {}),
    };
  });
}

export function estimateThreadCost(rows: ModelTokenUsage[], snapshot = openRouterPricing) {
  const models = rows.map((row) => {
    const model = findModelPricing(row.group, snapshot);
    const promptRate = rate(model?.pricing.prompt);
    const completionRate = rate(model?.pricing.completion);
    const cacheRate = model?.pricing.input_cache_read === undefined ? promptRate : rate(model.pricing.input_cache_read);
    const cacheWriteRate = rate(model?.pricing.input_cache_write);
    const cacheWriteTokens = row.cacheCreationPromptTokens === undefined ? 0 : row.cacheCreationPromptTokens;
    // Retain the legacy read-only clamp, but never hide overlapping cache writes.
    const validUsage =
      [row.promptTokens, row.completionTokens, row.cachedPromptTokens, cacheWriteTokens].every(validCount) &&
      (cacheWriteTokens === 0 || row.cachedPromptTokens + cacheWriteTokens <= row.promptTokens);
    const cachedTokens = Math.min(row.promptTokens, row.cachedPromptTokens);
    const counts = [
      row.promptTokens - cachedTokens - cacheWriteTokens,
      cachedTokens,
      cacheWriteTokens,
      row.completionTokens,
    ];
    const rates = [promptRate, cacheRate, cacheWriteRate, completionRate];
    const categories: TokenCostCategory[] = tokenCategoryLabels.map((label, index) => {
      const unknownCacheSplit = row.cacheWriteTokensUnknown && (index === 0 || index === 2);
      const tokens = validUsage && !unknownCacheSplit ? counts[index] : null;
      const amount = tokens === 0 ? 0 : tokens !== null && rates[index] !== null ? tokens * rates[index]! : null;
      const cost = validCost(amount) ? amount : null;
      return { label, tokens, cost, ...(cost === null ? { partial: true } : {}) };
    });
    const cost = categories.every((category) => category.cost !== null)
      ? sumKnown(categories.map((category) => category.cost))
      : null;
    // Empty categories alone do not make an entirely unpriced model a known $0 subtotal.
    const knownCost =
      cost ??
      sumKnown(
        categories
          .filter((category) => category.tokens !== null && category.tokens > 0)
          .map((category) => category.cost),
      );
    return { ...row, name: model?.name ?? row.group, cost, knownCost, categories };
  });
  const total = sumKnown(models.map((model) => model.knownCost));
  return {
    models,
    categories: sumTokenCategories(models.map((model) => model.categories)),
    total,
    partial: models.some((model) => model.cost === null) || (models.length > 0 && total === null),
    unpricedModels: models.filter((model) => model.cost === null).map((model) => model.group),
  };
}

export function formatEstimatedCost(cost: number | null): string {
  if (!validCost(cost)) return "Unavailable";
  if (cost > 0 && cost < 0.01) return "<$0.01";
  return usdFormatter.format(cost);
}

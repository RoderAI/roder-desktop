import bundledPricing from "@/data/openrouter-pricing.json";

export type PricingSnapshot = {
  source: string;
  fetchedAt: string;
  models: {
    id: string;
    name: string;
    pricing: { prompt: string; completion: string; input_cache_read?: string };
  }[];
};

export type ModelTokenUsage = {
  group: string;
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens: number;
};

export const openRouterPricing: PricingSnapshot = bundledPricing;
const usdFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function findModelPricing(model: string, snapshot = openRouterPricing) {
  const exact = snapshot.models.find((entry) => entry.id === model);
  if (exact) return exact;
  if (model.includes("/")) return undefined;
  const matches = snapshot.models.filter((entry) => entry.id.split("/").at(-1) === model);
  return matches.length === 1 ? matches[0] : undefined;
}

function rate(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

type TokenCostCategory = { label: string; tokens: number | null; cost: number | null };
const tokenCategoryLabels = ["Uncached input", "Cache read", "Output"];

export function sumTokenCategories(breakdowns: TokenCostCategory[][]): TokenCostCategory[] {
  return tokenCategoryLabels.map((label, index) => {
    const entries = breakdowns.map((categories) => categories[index]);
    return {
      label,
      tokens:
        entries.length && entries.every((entry) => entry.tokens !== null)
          ? entries.reduce((sum, entry) => sum + entry.tokens!, 0)
          : null,
      cost:
        entries.length && entries.every((entry) => entry.cost !== null)
          ? entries.reduce((sum, entry) => sum + entry.cost!, 0)
          : null,
    };
  });
}

export function estimateThreadCost(rows: ModelTokenUsage[], snapshot = openRouterPricing) {
  const models = rows.map((row) => {
    const model = findModelPricing(row.group, snapshot);
    const promptRate = rate(model?.pricing.prompt);
    const completionRate = rate(model?.pricing.completion);
    const cacheRate = rate(model?.pricing.input_cache_read) ?? promptRate;
    const validUsage = [row.promptTokens, row.completionTokens, row.cachedPromptTokens].every(
      (count) => Number.isFinite(count) && count >= 0,
    );
    const cachedTokens = Math.min(row.promptTokens, row.cachedPromptTokens);
    const counts = [row.promptTokens - cachedTokens, cachedTokens, row.completionTokens];
    const rates = [promptRate, cacheRate, completionRate];
    const categories = tokenCategoryLabels.map((label, index) => ({
      label,
      tokens: validUsage ? counts[index] : null,
      cost: validUsage && rates[index] !== null ? counts[index] * rates[index]! : null,
    }));
    const cost =
      validUsage && promptRate !== null && completionRate !== null && cacheRate !== null
        ? (row.promptTokens - cachedTokens) * promptRate +
          cachedTokens * cacheRate +
          row.completionTokens * completionRate
        : null;
    return { ...row, name: model?.name ?? row.group, cost, categories };
  });
  const priced = models.filter((model) => model.cost !== null);
  return {
    models,
    categories: sumTokenCategories(models.map((model) => model.categories)),
    total: priced.length ? priced.reduce((sum, model) => sum + model.cost!, 0) : null,
    unpricedModels: models.filter((model) => model.cost === null).map((model) => model.group),
  };
}

export function formatEstimatedCost(cost: number | null): string {
  if (cost === null) return "Unavailable";
  if (cost > 0 && cost < 0.01) return "<$0.01";
  return usdFormatter.format(cost);
}

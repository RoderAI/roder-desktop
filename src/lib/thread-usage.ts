import type { ModelTokenUsage } from "@/lib/thread-cost";

export type RecordedTokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens: number;
  cacheCreationPromptTokens: number;
};

export function readRecordedTokenUsage(value: unknown): RecordedTokenUsage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const usage = value as Record<string, unknown>;
  const promptTokens = usage.prompt_tokens;
  const completionTokens = usage.completion_tokens;
  const cachedPromptTokens = usage.cached_prompt_tokens ?? 0;
  const cacheCreationPromptTokens = usage.cache_creation_prompt_tokens ?? 0;
  const counts = [promptTokens, completionTokens, cachedPromptTokens, cacheCreationPromptTokens];
  if (!counts.every((count) => typeof count === "number" && Number.isSafeInteger(count) && count >= 0)) return null;
  const prompt = promptTokens as number;
  const completion = completionTokens as number;
  const cached = cachedPromptTokens as number;
  const writes = cacheCreationPromptTokens as number;
  const total = usage.total_tokens ?? prompt + completion;
  if (
    typeof total !== "number" ||
    !Number.isSafeInteger(total) ||
    total < prompt + completion ||
    cached + writes > prompt
  )
    return null;
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total,
    cachedPromptTokens: cached,
    cacheCreationPromptTokens: writes,
  };
}

export function sumRecordedUsage(usages: RecordedTokenUsage[]): RecordedTokenUsage {
  return usages.reduce(
    (total, usage) => ({
      promptTokens: total.promptTokens + usage.promptTokens,
      completionTokens: total.completionTokens + usage.completionTokens,
      totalTokens: total.totalTokens + usage.totalTokens,
      cachedPromptTokens: total.cachedPromptTokens + usage.cachedPromptTokens,
      cacheCreationPromptTokens: total.cacheCreationPromptTokens + usage.cacheCreationPromptTokens,
    }),
    { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedPromptTokens: 0, cacheCreationPromptTokens: 0 },
  );
}

export function usageFromModelRows(rows: ModelTokenUsage[]): RecordedTokenUsage {
  return sumRecordedUsage(
    rows.flatMap((row) => {
      const usage = readRecordedTokenUsage({
        prompt_tokens: row.promptTokens,
        completion_tokens: row.completionTokens,
        cached_prompt_tokens: Math.min(row.promptTokens, row.cachedPromptTokens),
        cache_creation_prompt_tokens: row.cacheCreationPromptTokens ?? 0,
      });
      return usage ? [usage] : [];
    }),
  );
}

export function reconcileRecordedUsage(rows: ModelTokenUsage[], metadata: unknown) {
  const analytics = usageFromModelRows(rows);
  const recorded = readRecordedTokenUsage(metadata);
  if (!recorded) return { usage: analytics, unattributedTokens: 0 };
  const usage = {
    promptTokens: Math.max(analytics.promptTokens, recorded.promptTokens),
    completionTokens: Math.max(analytics.completionTokens, recorded.completionTokens),
    totalTokens: Math.max(analytics.totalTokens, recorded.totalTokens),
    cachedPromptTokens: Math.max(analytics.cachedPromptTokens, recorded.cachedPromptTokens),
    cacheCreationPromptTokens: Math.max(analytics.cacheCreationPromptTokens, recorded.cacheCreationPromptTokens),
  };
  usage.totalTokens = Math.max(usage.totalTokens, usage.promptTokens + usage.completionTokens);
  return { usage, unattributedTokens: usage.totalTokens - analytics.totalTokens };
}

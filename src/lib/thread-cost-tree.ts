import { estimateThreadCost, sumTokenCategories, type ModelTokenUsage, type PricingSnapshot } from "@/lib/thread-cost";
import type { RoderThread, SubagentTraceSummary } from "@/types/roder";

type CostThread = { id: string; title: string; rows: ModelTokenUsage[]; incomplete: boolean };
type CostTree = { threads: CostThread[]; incomplete: boolean };
type CostApi = {
  readThread: (id: string) => Promise<{ thread: RoderThread | null }>;
  threadTokenUsage: (id: string) => Promise<{ rows: ModelTokenUsage[] }>;
  listSubagentTraces: (id: string, turnId: string) => Promise<{ traces: SubagentTraceSummary[] }>;
};

export async function loadThreadCostTree(
  rootId: string,
  api: CostApi,
  liveTraces: (id: string) => SubagentTraceSummary[] = () => [],
): Promise<CostTree> {
  const tree: CostTree = { threads: [], incomplete: false };
  const queue = [{ id: rootId, title: "This thread" }];
  const seen = new Set([rootId]);
  let remainingTracePages = 256;
  for (let index = 0; index < queue.length; index++) {
    const entry = queue[index];
    const [details, usage] = await Promise.allSettled([api.readThread(entry.id), api.threadTokenUsage(entry.id)]);
    const thread = details.status === "fulfilled" ? details.value.thread : null;
    const rows = usage.status === "fulfilled" && Array.isArray(usage.value.rows) ? usage.value.rows : [];
    const costThread: CostThread = {
      ...entry,
      title: entry.id === rootId ? "This thread" : thread?.name || entry.title,
      rows,
      incomplete: !thread || usage.status === "rejected" || rows.length === 0 || rows.length >= 1000,
    };
    tree.threads.push(costThread);
    const traces = [...liveTraces(entry.id)];
    const allTurnIds = [
      ...new Set([
        ...(thread?.status.activeTurnId ? [thread.status.activeTurnId] : []),
        ...(thread?.turns ?? []).map((turn) => turn.id).reverse(),
      ]),
    ];
    const turnIds = allTurnIds.slice(0, Math.min(32, remainingTracePages));
    remainingTracePages -= turnIds.length;
    if (turnIds.length < allTurnIds.length) {
      tree.incomplete = true;
      costThread.incomplete = true;
    }
    for (let offset = 0; offset < turnIds.length; offset += 4) {
      const pages = await Promise.allSettled(
        turnIds.slice(offset, offset + 4).map((turnId) => api.listSubagentTraces(entry.id, turnId)),
      );
      for (const page of pages) {
        if (page.status === "fulfilled") traces.push(...page.value.traces);
        else tree.incomplete = true;
      }
    }
    for (const trace of traces) {
      if (!trace.childThreadId) {
        tree.incomplete = true;
        continue;
      }
      if (seen.has(trace.childThreadId)) continue;
      if (seen.size >= 200) {
        tree.incomplete = true;
        continue;
      }
      seen.add(trace.childThreadId);
      queue.push({ id: trace.childThreadId, title: trace.title || "Subagent" });
    }
  }
  return tree;
}

export function estimateThreadTreeCost(tree: CostTree, pricing?: PricingSnapshot) {
  const threads = tree.threads.map((thread) => {
    const estimate = estimateThreadCost(thread.rows, pricing);
    return { ...thread, ...estimate, partial: thread.incomplete || estimate.unpricedModels.length > 0 };
  });
  const byModel = new Map<string, ModelTokenUsage>();
  for (const thread of tree.threads) {
    for (const row of thread.rows) {
      const existing = byModel.get(row.group);
      byModel.set(
        row.group,
        existing
          ? {
              group: row.group,
              promptTokens: existing.promptTokens + row.promptTokens,
              completionTokens: existing.completionTokens + row.completionTokens,
              cachedPromptTokens: existing.cachedPromptTokens + Math.min(row.promptTokens, row.cachedPromptTokens),
            }
          : { ...row, cachedPromptTokens: Math.min(row.promptTokens, row.cachedPromptTokens) },
      );
    }
  }
  const estimate = estimateThreadCost([...byModel.values()], pricing);
  const models = estimate.models.map((model) => {
    const entries = threads.flatMap((thread) => thread.models.filter((entry) => entry.group === model.group));
    const known = entries.filter((entry) => entry.cost !== null);
    return {
      ...model,
      categories: sumTokenCategories(entries.map((entry) => entry.categories)),
      cost: known.length ? known.reduce((sum, entry) => sum + entry.cost!, 0) : null,
      partial: entries.some((entry) => entry.cost === null),
    };
  });
  const known = threads.filter((thread) => thread.total !== null);
  return {
    ...estimate,
    models,
    unpricedModels: [...new Set(threads.flatMap((thread) => thread.unpricedModels))],
    total: known.length ? known.reduce((sum, thread) => sum + thread.total!, 0) : null,
    threads,
    partial: tree.incomplete || threads.some((thread) => thread.partial),
  };
}

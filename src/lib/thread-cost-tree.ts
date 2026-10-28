import { estimateThreadCost, sumTokenCategories, type ModelTokenUsage, type PricingSnapshot } from "@/lib/thread-cost";
import {
  readRecordedTokenUsage,
  reconcileRecordedUsage,
  sumRecordedUsage,
  usageFromModelRows,
  type RecordedTokenUsage,
} from "@/lib/thread-usage";
import type { RoderThread, SubagentTraceSummary } from "@/types/roder";

type CostThread = {
  id: string;
  title: string;
  rows: ModelTokenUsage[];
  incomplete: boolean;
  source?: "analytics" | "trace" | "unavailable";
  usage?: RecordedTokenUsage;
  usageAvailable?: boolean;
  unattributedTokens?: number;
  depth?: number;
};
type CostTree = {
  threads: CostThread[];
  incomplete: boolean;
  warnings?: string[];
  scannedTurns?: number;
  skippedTurns?: number;
};
type CostApi = {
  readThreadHistory: (
    id: string,
    options: { limit: number },
  ) => Promise<{ thread: RoderThread | null; hasMore?: boolean }>;
  threadTokenUsage: (id: string) => Promise<{ rows: ModelTokenUsage[] }>;
  listSubagentTraces: (id: string, turnId: string) => Promise<{ traces: SubagentTraceSummary[] }>;
  listThreads?: (limit?: number, cursor?: string | null) => Promise<{ data: RoderThread[]; nextCursor: string | null }>;
};

type PendingThread = {
  id: string;
  title: string;
  depth: number;
  traces: Map<string, SubagentTraceSummary>;
};

export type ThreadCostLoadOptions = { maxTracePages?: number; maxThreads?: number };

export async function loadThreadCostTree(
  rootId: string,
  api: CostApi,
  liveTraces: (id: string) => SubagentTraceSummary[] = () => [],
  options: ThreadCostLoadOptions = {},
): Promise<CostTree> {
  const warnings = new Set<string>();
  const tree: CostTree = { threads: [], incomplete: false, warnings: [], scannedTurns: 0, skippedTurns: 0 };
  const queue: PendingThread[] = [{ id: rootId, title: "This thread", depth: 0, traces: new Map() }];
  const seen = new Map([[rootId, queue[0]]]);
  const loaded: {
    entry: PendingThread;
    thread: RoderThread | null;
    rows: ModelTokenUsage[];
    failed: boolean;
    historyIncomplete: boolean;
  }[] = [];
  const children = await persistentChildren(api, warnings);
  const threadLimit = options.maxThreads ?? 200;
  let remainingTracePages = options.maxTracePages ?? 256;

  function enqueue(id: string, title: string, depth: number, trace?: SubagentTraceSummary): void {
    let entry = seen.get(id);
    if (!entry) {
      if (seen.size >= threadLimit) {
        warnings.add("The descendant limit was reached; some agent usage is missing.");
        return;
      }
      entry = { id, title, depth, traces: new Map() };
      seen.set(id, entry);
      queue.push(entry);
    }
    if (trace) addTraceSnapshot(entry.traces, trace);
  }

  for (let index = 0; index < queue.length; index++) {
    const entry = queue[index];
    const [details, usage] = await Promise.allSettled([
      api.readThreadHistory(entry.id, { limit: 160 }),
      api.threadTokenUsage(entry.id),
    ]);
    const thread = details.status === "fulfilled" ? details.value.thread : null;
    const rows = usage.status === "fulfilled" && Array.isArray(usage.value.rows) ? usage.value.rows : [];
    const historyIncomplete = details.status === "fulfilled" && details.value.hasMore === true;
    loaded.push({ entry, thread, rows, failed: usage.status === "rejected", historyIncomplete });
    if (historyIncomplete) {
      warnings.add("Older task-agent history was not scanned; descendant usage may be missing.");
    }
    for (const child of children.get(entry.id) ?? []) {
      enqueue(child.id, child.name || child.preview || "Subagent", entry.depth + 1);
    }
    const traces = [...liveTraces(entry.id)];
    const allTurnIds = [
      ...new Set([
        ...(thread?.status.activeTurnId ? [thread.status.activeTurnId] : []),
        ...(thread?.turns ?? []).map((turn) => turn.id).reverse(),
      ]),
    ];
    const turnIds = allTurnIds.slice(0, remainingTracePages);
    remainingTracePages -= turnIds.length;
    tree.scannedTurns! += turnIds.length;
    tree.skippedTurns! += allTurnIds.length - turnIds.length;
    if (turnIds.length < allTurnIds.length) {
      warnings.add("The history scan limit was reached; older task-agent usage may be missing.");
    }
    for (let offset = 0; offset < turnIds.length; offset += 4) {
      const pages = await Promise.allSettled(
        turnIds.slice(offset, offset + 4).map((turnId) => api.listSubagentTraces(entry.id, turnId)),
      );
      for (const page of pages) {
        if (page.status === "fulfilled") traces.push(...page.value.traces);
        else warnings.add("Some agent trace history could not be loaded.");
      }
    }
    for (const trace of traces) {
      if (!trace.childThreadId) {
        warnings.add("Some agent traces have no child identity and could not be counted.");
        continue;
      }
      if (trace.childThreadId === rootId) continue;
      enqueue(trace.childThreadId, trace.title || "Subagent", entry.depth + 1, trace);
    }
  }

  tree.threads = loaded.map(({ entry, thread, rows: analyticsRows, failed, historyIncomplete }) => {
    const fallbackRows = traceUsageRows(entry.traces);
    const source = analyticsRows.length ? "analytics" : fallbackRows.length ? "trace" : "unavailable";
    const rows = reconcileInputCache(analyticsRows.length ? analyticsRows : fallbackRows, thread?.usage);
    const reconciled = reconcileRecordedUsage(rows, thread?.usage);
    const metadataBehind = usageIsBehind(readRecordedTokenUsage(thread?.usage), usageFromModelRows(analyticsRows));
    const hasMetadata = readRecordedTokenUsage(thread?.usage) !== null;
    const running = Boolean(thread?.status.activeTurnId || thread?.status.type === "running");
    const missingFailedUsage = thread?.turns?.some(
      (turn) => (turn.status === "failed" || turn.status === "interrupted") && !turn.usage,
    );
    const nonstandardTier = thread?.turns?.some(
      (turn) => turn.usage?.service_tier && turn.usage.service_tier !== "default",
    );
    const incomplete =
      !thread ||
      historyIncomplete ||
      !hasMetadata ||
      failed ||
      source !== "analytics" ||
      analyticsRows.length >= 1000 ||
      reconciled.unattributedTokens > 0 ||
      running ||
      metadataBehind ||
      missingFailedUsage ||
      nonstandardTier ||
      rows.some((row) => row.cacheWriteTokensUnknown);
    if (missingFailedUsage)
      warnings.add("A failed or interrupted turn has no usage record; consumed tokens may be missing.");
    if (metadataBehind) warnings.add("Usage sources are still synchronizing; recorded totals may change.");
    if (nonstandardTier)
      warnings.add("Some turns used a non-default service tier; standard rates may not match their charges.");
    if (source === "analytics" && !hasMetadata)
      warnings.add("Cumulative thread usage is unavailable; model analytics may omit compaction or cache writes.");
    if (source === "trace")
      warnings.add("Some task usage comes from trace snapshots; historical or provider records may be incomplete.");
    if (source === "unavailable" && (!hasMetadata || reconciled.usage.totalTokens > 0)) {
      warnings.add("Some recorded usage has no model attribution or analytics are unavailable.");
    }
    if (reconciled.unattributedTokens > 0)
      warnings.add("Thread totals include tokens missing from model analytics, such as compaction or delayed records.");
    if (running) warnings.add("A turn is still running. Recorded totals update when turns finish.");
    if (rows.some((row) => row.cacheWriteTokensUnknown))
      warnings.add("Some input-cache counts are unavailable or lack model attribution; input pricing is partial.");
    return {
      id: entry.id,
      title: entry.id === rootId ? "This thread" : thread?.name || entry.title,
      depth: entry.depth,
      rows,
      source,
      usageAvailable:
        hasMetadata ||
        rows.some(
          (row) =>
            readRecordedTokenUsage({
              prompt_tokens: row.promptTokens,
              completion_tokens: row.completionTokens,
              cached_prompt_tokens: Math.min(row.promptTokens, row.cachedPromptTokens),
              cache_creation_prompt_tokens: row.cacheCreationPromptTokens ?? 0,
            }) !== null,
        ),
      incomplete,
      ...reconciled,
    };
  });
  tree.warnings = [...warnings];
  tree.incomplete = warnings.size > 0;
  return tree;
}

async function persistentChildren(api: CostApi, warnings: Set<string>): Promise<Map<string, RoderThread[]>> {
  const children = new Map<string, RoderThread[]>();
  if (!api.listThreads) return children;
  let cursor: string | null = null;
  const cursors = new Set<string>();
  try {
    for (let page = 0; page < 50; page++) {
      const result = await api.listThreads(100, cursor);
      for (const thread of result.data) {
        if (!thread.parentThreadId || thread.workspaceFork) continue;
        const group = children.get(thread.parentThreadId) ?? [];
        group.push(thread);
        children.set(thread.parentThreadId, group);
      }
      if (!result.nextCursor) return children;
      if (cursors.has(result.nextCursor)) break;
      cursors.add(result.nextCursor);
      cursor = result.nextCursor;
    }
    warnings.add("The thread index is incomplete; some persistent agents may be missing.");
  } catch {
    warnings.add("The thread index could not be loaded; agent discovery is limited to available traces.");
  }
  return children;
}

function addTraceSnapshot(traces: Map<string, SubagentTraceSummary>, trace: SubagentTraceSummary): void {
  const key = trace.childTurnId || trace.traceId;
  const previous = traces.get(key);
  const currentUsage = readRecordedTokenUsage(trace.usage);
  const previousUsage = readRecordedTokenUsage(previous?.usage);
  if (!previous || (currentUsage && (!previousUsage || currentUsage.totalTokens >= previousUsage.totalTokens))) {
    traces.set(key, trace);
  }
}

function traceUsageRows(traces: Map<string, SubagentTraceSummary>): ModelTokenUsage[] {
  return [...traces.values()].flatMap((trace) => {
    const usage = readRecordedTokenUsage(trace.usage);
    return usage
      ? [
          {
            group: trace.model || "(unknown)",
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            cachedPromptTokens: usage.cachedPromptTokens,
            cacheCreationPromptTokens: usage.cacheCreationPromptTokens,
          },
        ]
      : [];
  });
}

function reconcileInputCache(rows: ModelTokenUsage[], metadata: unknown): ModelTokenUsage[] {
  const usage = readRecordedTokenUsage(metadata);
  const recorded = usageFromModelRows(rows);
  if (!usage || usageIsBehind(usage, recorded)) {
    return rows.map((row) =>
      row.cacheCreationPromptTokens === undefined && row.promptTokens > row.cachedPromptTokens
        ? { ...row, cacheWriteTokensUnknown: true }
        : row,
    );
  }
  if (
    rows.length === 1 &&
    usage.promptTokens === recorded.promptTokens &&
    usage.completionTokens === recorded.completionTokens
  ) {
    // Exact single-model coverage lets us restore cache counters lost by analytics.
    return [
      {
        ...rows[0],
        cachedPromptTokens: usage.cachedPromptTokens,
        cacheCreationPromptTokens: usage.cacheCreationPromptTokens,
      },
    ];
  }
  if (
    usage.cacheCreationPromptTokens === recorded.cacheCreationPromptTokens &&
    usage.cachedPromptTokens === recorded.cachedPromptTokens
  )
    return rows;
  return rows.map((row) => ({ ...row, cacheWriteTokensUnknown: true }));
}

function usageIsBehind(metadata: RecordedTokenUsage | null, recorded: RecordedTokenUsage): boolean {
  return Boolean(
    metadata &&
    (metadata.promptTokens < recorded.promptTokens ||
      metadata.completionTokens < recorded.completionTokens ||
      metadata.totalTokens < recorded.totalTokens ||
      metadata.cachedPromptTokens < recorded.cachedPromptTokens ||
      metadata.cacheCreationPromptTokens < recorded.cacheCreationPromptTokens),
  );
}

export function estimateThreadTreeCost(tree: CostTree, pricing?: PricingSnapshot) {
  const threads = tree.threads.map((thread) => {
    const estimate = estimateThreadCost(thread.rows, pricing);
    return {
      ...thread,
      ...estimate,
      usage: thread.usage ?? usageFromModelRows(thread.rows),
      usageAvailable: thread.usageAvailable ?? thread.rows.length > 0,
      partial: thread.incomplete || estimate.partial,
    };
  });
  const groups = [...new Set(threads.flatMap((thread) => thread.models.map((model) => model.group)))];
  const models = groups.map((group) => {
    const entries = threads.flatMap((thread) => thread.models.filter((entry) => entry.group === group));
    const usage = usageFromModelRows(entries);
    const known = entries.filter((entry) => entry.knownCost !== null);
    return {
      group,
      name: entries[0].name,
      ...usage,
      categories: sumTokenCategories(entries.map((entry) => entry.categories)),
      cost: known.length ? known.reduce((sum, entry) => sum + entry.knownCost!, 0) : null,
      partial: entries.some((entry) => entry.cost === null),
    };
  });
  const known = threads.filter((thread) => thread.total !== null);
  return {
    models,
    categories: sumTokenCategories(threads.map((thread) => thread.categories)),
    unpricedModels: [...new Set(threads.flatMap((thread) => thread.unpricedModels))],
    total: known.length ? known.reduce((sum, thread) => sum + thread.total!, 0) : null,
    usage: sumRecordedUsage(threads.map((thread) => thread.usage)),
    usageAvailable: threads.some((thread) => thread.usageAvailable),
    unattributedTokens: threads.reduce((sum, thread) => sum + (thread.unattributedTokens ?? 0), 0),
    warnings: tree.warnings ?? [],
    scannedTurns: tree.scannedTurns ?? 0,
    skippedTurns: tree.skippedTurns ?? 0,
    threads,
    partial: tree.incomplete || threads.some((thread) => thread.partial),
  };
}

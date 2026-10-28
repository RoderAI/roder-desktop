import { expect, test } from "vitest";
import { estimateThreadTreeCost, loadThreadCostTree } from "../src/lib/thread-cost-tree";
import type { PricingSnapshot } from "../src/lib/thread-cost";
import type { RoderThread, SubagentTraceSummary } from "../src/types/roder";

const pricing: PricingSnapshot = {
  source: "test",
  fetchedAt: "2026-10-24",
  models: [{ id: "test/model", name: "Test", pricing: { prompt: "1", completion: "2", input_cache_write: "3" } }],
};
const rows = [{ group: "test/model", promptTokens: 10, completionTokens: 2, cachedPromptTokens: 0 }];
const thread = (id: string, extra: Partial<RoderThread> = {}): RoderThread => ({
  id,
  preview: id,
  cwd: "/workspace",
  model: "model",
  modelProvider: "test",
  createdAt: 1,
  updatedAt: 1,
  status: { type: "idle", activeTurnId: null, activeFlags: [] },
  turns: [],
  usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cached_prompt_tokens: 0 },
  ...extra,
});
const trace = (extra: Partial<SubagentTraceSummary> = {}): SubagentTraceSummary => ({
  traceId: "task-trace",
  parent: { threadId: "root", turnId: "turn" },
  childThreadId: "synthetic-child",
  childTurnId: "child-turn",
  title: "Review",
  role: "reviewer",
  status: "completed",
  elapsedMs: 1,
  model: "test/model",
  usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6, cached_prompt_tokens: 0 },
  ...extra,
});

test("counts trace-only task agents once when no persisted child thread or analytics exists", async () => {
  const summary = trace();
  const tree = await loadThreadCostTree(
    "root",
    {
      readThreadHistory: async (id) => ({
        thread: id === "root" ? thread(id, { turns: [{ id: "turn" }] as RoderThread["turns"] }) : null,
      }),
      threadTokenUsage: async (id) => ({ rows: id === "root" ? rows : [] }),
      listSubagentTraces: async () => ({ traces: [summary, summary] }),
    },
    (id) => (id === "root" ? [summary] : []),
  );
  const estimate = estimateThreadTreeCost(tree, pricing);
  expect(estimate.total).toBe(21);
  expect(estimate.usage.totalTokens).toBe(18);
  expect(estimate.threads.find((entry) => entry.id === "synthetic-child")?.source).toBe("trace");
  expect(estimate.partial).toBe(true);
});

test("persistent parent links discover old nested agents without counting independent workspace forks", async () => {
  const all = [
    thread("root"),
    thread("child", { parentThreadId: "root" }),
    thread("nested", { parentThreadId: "child" }),
    thread("fork", { parentThreadId: "root", workspaceFork: { id: "fork" } }),
  ];
  const tree = await loadThreadCostTree("root", {
    listThreads: async () => ({ data: all, nextCursor: null }),
    readThreadHistory: async (id) => ({ thread: all.find((entry) => entry.id === id) ?? null }),
    threadTokenUsage: async () => ({ rows }),
    listSubagentTraces: async () => ({ traces: [] }),
  });
  expect(tree.threads.map((entry) => entry.id)).toEqual(["root", "child", "nested"]);
  expect(estimateThreadTreeCost(tree, pricing).total).toBe(42);
});

test("cumulative metadata exposes missing compaction or delayed analytics without guessing model attribution", async () => {
  const tree = await loadThreadCostTree("root", {
    readThreadHistory: async (id) => ({
      thread: thread(id, {
        usage: { prompt_tokens: 30, completion_tokens: 4, total_tokens: 34, cached_prompt_tokens: 0 },
      }),
    }),
    threadTokenUsage: async () => ({ rows }),
    listSubagentTraces: async () => ({ traces: [] }),
  });
  const estimate = estimateThreadTreeCost(tree, pricing);
  expect(estimate.usage.totalTokens).toBe(34);
  expect(estimate.unattributedTokens).toBe(22);
  expect(estimate.total).toBe(14);
  expect(estimate.partial).toBe(true);
});

test("per-thread analytics wins over trace snapshots and inherited turn history is not billed twice", async () => {
  const tree = await loadThreadCostTree("root", {
    readThreadHistory: async (id) => ({
      thread: thread(id, {
        turns: [
          { id: "inherited", usage: { prompt_tokens: 1000000, completion_tokens: 0, total_tokens: 1000000 } },
        ] as RoderThread["turns"],
      }),
    }),
    threadTokenUsage: async () => ({ rows }),
    listSubagentTraces: async (id) => ({
      traces:
        id === "root"
          ? [
              trace({
                usage: { prompt_tokens: 1000, completion_tokens: 10, total_tokens: 1010 },
              }),
            ]
          : [],
    }),
  });
  const estimate = estimateThreadTreeCost(tree, pricing);
  expect(estimate.total).toBe(28);
  expect(estimate.usage.totalTokens).toBe(24);
});

test("cache writes use cumulative counts when one model exactly covers the thread", async () => {
  const tree = await loadThreadCostTree("root", {
    readThreadHistory: async (id) => ({
      thread: thread(id, {
        usage: {
          prompt_tokens: 10,
          completion_tokens: 2,
          total_tokens: 12,
          cached_prompt_tokens: 0,
          cache_creation_prompt_tokens: 4,
        },
      }),
    }),
    threadTokenUsage: async () => ({ rows }),
    listSubagentTraces: async () => ({ traces: [] }),
  });
  const estimate = estimateThreadTreeCost(tree, pricing);
  expect(estimate.total).toBe(22);
  expect(estimate.categories.find((entry) => entry.label === "Cache write")?.tokens).toBe(4);
});

test("history scanning does not silently skip agents older than the last 32 turns", async () => {
  const tree = await loadThreadCostTree("root", {
    readThreadHistory: async (id) => ({
      thread:
        id === "root"
          ? thread(id, {
              turns: Array.from({ length: 40 }, (_, index) => ({ id: String(index) })) as RoderThread["turns"],
            })
          : null,
    }),
    threadTokenUsage: async (id) => ({ rows: id === "root" ? rows : [] }),
    listSubagentTraces: async (_, turnId) => ({ traces: turnId === "0" ? [trace()] : [] }),
  });
  expect(tree.threads.some((entry) => entry.id === "synthetic-child")).toBe(true);
});

test.each(["failed", "interrupted"] as const)(
  "missing %s usage and non-default service tiers remain partial",
  async (status) => {
    const tree = await loadThreadCostTree("root", {
      readThreadHistory: async (id) => ({
        thread: thread(id, {
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
          turns: [
            { id: "missing-usage", status, items: [], itemsView: "default" },
            {
              id: "priority",
              status: "completed",
              items: [],
              itemsView: "default",
              usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, service_tier: "priority" },
            },
          ],
        }),
      }),
      threadTokenUsage: async () => ({ rows }),
      listSubagentTraces: async () => ({ traces: [] }),
    });
    const estimate = estimateThreadTreeCost(tree, pricing);
    expect(estimate.partial).toBe(true);
    expect(estimate.warnings).toContain(
      "A failed or interrupted turn has no usage record; consumed tokens may be missing.",
    );
    expect(estimate.warnings).toContain(
      "Some turns used a non-default service tier; standard rates may not match their charges.",
    );
  },
);

test("legacy analytics without cumulative metadata does not pretend unknown cache writes are uncached input", async () => {
  const tree = await loadThreadCostTree("root", {
    readThreadHistory: async (id) => ({ thread: thread(id, { usage: undefined }) }),
    threadTokenUsage: async () => ({ rows }),
    listSubagentTraces: async () => ({ traces: [] }),
  });
  const estimate = estimateThreadTreeCost(tree, pricing);
  expect(estimate.usage.totalTokens).toBe(12);
  expect(estimate.total).toBe(4);
  expect(estimate.partial).toBe(true);
  expect(estimate.categories.find((category) => category.label === "Uncached input")?.cost).toBeNull();
});

test("analytics ahead of its metadata snapshot is partial and does not guess the input/cache split", async () => {
  const tree = await loadThreadCostTree("root", {
    readThreadHistory: async (id) => ({ thread: thread(id) }),
    threadTokenUsage: async () => ({ rows: [{ ...rows[0], promptTokens: 110, completionTokens: 22 }] }),
    listSubagentTraces: async () => ({ traces: [] }),
  });
  const estimate = estimateThreadTreeCost(tree, pricing);
  expect(estimate.usage.totalTokens).toBe(132);
  expect(estimate.total).toBe(44);
  expect(estimate.partial).toBe(true);
  expect(estimate.warnings).toContain("Usage sources are still synchronizing; recorded totals may change.");
});

test("an exact single-model record recovers cached reads omitted from its analytics snapshot", async () => {
  const tree = await loadThreadCostTree("root", {
    readThreadHistory: async (id) => ({
      thread: thread(id, {
        usage: {
          prompt_tokens: 10,
          completion_tokens: 2,
          total_tokens: 12,
          cached_prompt_tokens: 4,
        },
      }),
    }),
    threadTokenUsage: async () => ({ rows }),
    listSubagentTraces: async () => ({ traces: [] }),
  });
  const cachePricing: PricingSnapshot = {
    ...pricing,
    models: [{ ...pricing.models[0], pricing: { ...pricing.models[0].pricing, input_cache_read: "0.1" } }],
  };
  const estimate = estimateThreadTreeCost(tree, cachePricing);
  expect(estimate.total).toBeCloseTo(10.4);
  expect(estimate.categories.find((category) => category.label === "Cache read")?.tokens).toBe(4);
});

test("cache writes spanning multiple models retain only attributable cost components", async () => {
  const tree = await loadThreadCostTree("root", {
    readThreadHistory: async (id) => ({
      thread: thread(id, {
        usage: {
          prompt_tokens: 20,
          completion_tokens: 4,
          total_tokens: 24,
          cache_creation_prompt_tokens: 6,
        },
      }),
    }),
    threadTokenUsage: async () => ({ rows: [rows[0], { ...rows[0], group: "test/other" }] }),
    listSubagentTraces: async () => ({ traces: [] }),
  });
  const estimate = estimateThreadTreeCost(tree, {
    ...pricing,
    models: [...pricing.models, { ...pricing.models[0], id: "test/other" }],
  });
  expect(estimate.total).toBe(8);
  expect(estimate.usage.cacheCreationPromptTokens).toBe(6);
  expect(estimate.partial).toBe(true);
});

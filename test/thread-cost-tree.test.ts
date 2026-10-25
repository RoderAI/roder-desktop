import { expect, test } from "vitest";
import { loadThreadCostTree, estimateThreadTreeCost } from "@/lib/thread-cost-tree";
import type { RoderThread, SubagentTraceSummary } from "@/types/roder";
import type { PricingSnapshot } from "@/lib/thread-cost";

const pricing: PricingSnapshot = {
  source: "test",
  fetchedAt: "today",
  models: [{ id: "test/model", name: "Test", pricing: { prompt: "1", completion: "2" } }],
};
const usage = [{ group: "test/model", promptTokens: 2, completionTokens: 1, cachedPromptTokens: 0 }];
function trace(childThreadId: string): SubagentTraceSummary {
  return {
    traceId: childThreadId,
    childThreadId,
    childTurnId: "turn",
    parent: { threadId: "root", turnId: "turn" },
    title: childThreadId,
    role: "worker",
    status: "completed",
    elapsedMs: 1,
    usage: { cost: 999 },
  };
}
function thread(id: string): RoderThread {
  return {
    id,
    name: id,
    turns: [{ id: "old" }, { id: "new" }],
    status: { type: "idle", activeTurnId: null, activeFlags: [] },
  } as RoderThread;
}

test("discovers persisted nested children once, including repeated traces and self cycles", async () => {
  const calls: string[] = [];
  const tree = await loadThreadCostTree(
    "root",
    {
      readThread: async (id) => ({ thread: thread(id) }),
      threadTokenUsage: async (id) => {
        calls.push(id);
        return { rows: usage };
      },
      listSubagentTraces: async (id) => ({
        traces:
          id === "root" ? [trace("child"), trace("root")] : id === "child" ? [trace("nested"), trace("child")] : [],
      }),
    },
    () => [trace("child")],
  );
  expect(calls.sort()).toEqual(["child", "nested", "root"]);
  const result = estimateThreadTreeCost(tree, pricing);
  expect(result.total).toBe(12);
  expect(result.partial).toBe(false);
  expect(result.models[0].promptTokens).toBe(6);
  expect(result.threads.map((row) => row.total)).toEqual([4, 4, 4]);
});

test("retains successful trace pages and known costs when siblings or discovery fail", async () => {
  const tree = await loadThreadCostTree("root", {
    readThread: async (id) => ({ thread: thread(id) }),
    threadTokenUsage: async (id) => {
      if (id === "missing") throw Error("missing stats");
      return { rows: usage };
    },
    listSubagentTraces: async (id, turn) => {
      if (id === "root" && turn === "old") throw Error("missing trace page");
      return { traces: id === "root" ? [trace("missing")] : [] };
    },
  });
  const result = estimateThreadTreeCost(tree, pricing);
  expect(result.total).toBe(4);
  expect(result.partial).toBe(true);
  expect(result.threads.find((row) => row.id === "missing")?.total).toBeNull();
});

test("unknown child models and absent analytics never become a complete zero total", async () => {
  const tree = await loadThreadCostTree("root", {
    readThread: async (id) => ({ thread: thread(id) }),
    threadTokenUsage: async (id) => ({ rows: id === "root" ? usage : [{ ...usage[0], group: "unknown" }] }),
    listSubagentTraces: async (id) => ({ traces: id === "root" ? [trace("child")] : [] }),
  });
  expect(estimateThreadTreeCost(tree, pricing)).toMatchObject({ total: 4, partial: true, unpricedModels: ["unknown"] });
});

test("empty usage and missing thread metadata remain partial and do not hide live children", async () => {
  const tree = await loadThreadCostTree(
    "root",
    {
      readThread: async () => ({ thread: null }),
      threadTokenUsage: async () => ({ rows: [] }),
      listSubagentTraces: async () => ({ traces: [] }),
    },
    (id) => (id === "root" ? [trace("child")] : []),
  );
  expect(tree.threads.map((row) => row.id)).toEqual(["root", "child"]);
  expect(estimateThreadTreeCost(tree, pricing)).toMatchObject({ total: null, partial: true });
});

test("bounds trace hydration concurrency and prices excess cache counts per thread", async () => {
  let active = 0;
  let maximum = 0;
  const tree = await loadThreadCostTree("root", {
    readThread: async (id) => ({
      thread: {
        ...thread(id),
        turns: Array.from({ length: 13 }, (_, index) => ({ id: String(index) })) as RoderThread["turns"],
      },
    }),
    threadTokenUsage: async (id) => ({ rows: [{ ...usage[0], cachedPromptTokens: id === "root" ? 999 : 0 }] }),
    listSubagentTraces: async (id) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return { traces: id === "root" ? [trace("child")] : [] };
    },
  });
  expect(maximum).toBeLessThanOrEqual(4);
  const result = estimateThreadTreeCost(tree, pricing);
  expect(result.models[0].cachedPromptTokens).toBe(2);
  expect(result.models[0].cost).toBe(result.total);
  expect(result.models[0].categories.map((category) => category.tokens)).toEqual([2, 2, 2]);
  expect(result.threads[0].categories.map((category) => category.tokens)).toEqual([0, 2, 1]);
  expect(result.threads[1].categories.map((category) => category.tokens)).toEqual([2, 0, 1]);
  expect(result.models[0].categories.reduce((sum, category) => sum + category.cost!, 0)).toBe(result.total);
});

test("invalid child counts cannot cancel valid model usage or create a fabricated model contribution", async () => {
  const tree = await loadThreadCostTree("root", {
    readThread: async (id) => ({ thread: thread(id) }),
    threadTokenUsage: async (id) => ({ rows: id === "root" ? usage : [{ ...usage[0], promptTokens: -1 }] }),
    listSubagentTraces: async (id) => ({ traces: id === "root" ? [trace("child")] : [] }),
  });
  const result = estimateThreadTreeCost(tree, pricing);
  expect(result).toMatchObject({ total: 4, partial: true });
  expect(result.models[0]).toMatchObject({ cost: 4, partial: true });
});

test("long histories scan a bounded recent window, retain active turns and self cost, and mark partial", async () => {
  const requested: string[] = [];
  const tree = await loadThreadCostTree("root", {
    readThread: async (id) => ({
      thread: {
        ...thread(id),
        turns:
          id === "root"
            ? (Array.from({ length: 10000 }, (_, index) => ({ id: String(index) })) as RoderThread["turns"])
            : [],
        status: { type: "idle", activeFlags: [], activeTurnId: id === "root" ? "active" : null },
      },
    }),
    threadTokenUsage: async () => ({ rows: usage }),
    listSubagentTraces: async (_, turnId) => {
      requested.push(turnId);
      return { traces: turnId === "active" ? [trace("child")] : [] };
    },
  });
  expect(requested.length).toBeLessThanOrEqual(32);
  expect(requested).toContain("active");
  expect(requested).toContain("9999");
  expect(estimateThreadTreeCost(tree, pricing)).toMatchObject({ total: 8, partial: true });
});

test("the trace page budget is shared across all descendants", async () => {
  let requests = 0;
  const tree = await loadThreadCostTree("root", {
    readThread: async (id) => ({
      thread: {
        ...thread(id),
        turns: Array.from({ length: 32 }, (_, index) => ({ id: String(index) })) as RoderThread["turns"],
      },
    }),
    threadTokenUsage: async () => ({ rows: usage }),
    listSubagentTraces: async (id) => {
      requests++;
      return { traces: id === "root" ? Array.from({ length: 20 }, (_, index) => trace(`child-${index}`)) : [] };
    },
  });
  expect(requests).toBe(256);
  expect(tree.threads).toHaveLength(21);
  expect(estimateThreadTreeCost(tree, pricing)).toMatchObject({ total: 84, partial: true });
});

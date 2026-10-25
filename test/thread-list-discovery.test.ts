import { expect, test } from "vitest";
import { discoverThreadListTraces } from "../src/lib/thread-list";
import type { RoderThread, SubagentTraceSummary } from "../src/types/roder";

test("discovers saved subagents before expansion and distinguishes empty threads from failures", async () => {
  const trace = { traceId: "saved-child" } as SubagentTraceSummary;
  const discovered: Record<string, SubagentTraceSummary[]> = {};
  const failures: string[] = [];
  await discoverThreadListTraces(
    ["parent", "empty", "unavailable"],
    {
      readThread: async (id) => {
        if (id === "unavailable") throw new Error("Offline");
        return { thread: { turns: [{ id }], status: { activeTurnId: null } } as RoderThread };
      },
      listSubagentTraces: async (id) => ({ traces: id === "parent" ? [trace] : [] }),
    },
    (id, traces) => {
      discovered[id] = traces;
    },
    (id) => {
      failures.push(id);
    },
  );
  expect(discovered).toEqual({ parent: [trace], empty: [] });
  expect(failures).toEqual(["unavailable"]);
});

test("limits background thread discovery and stops scheduling after unmount", async () => {
  let active = true;
  let pending = 0;
  let peak = 0;
  let reads = 0;
  const results: string[] = [];
  await discoverThreadListTraces(
    Array.from({ length: 20 }, (_, i) => String(i)),
    {
      readThread: async () => {
        reads++;
        pending++;
        peak = Math.max(peak, pending);
        await Promise.resolve();
        pending--;
        return { thread: { turns: [], status: { activeTurnId: null } } as unknown as RoderThread };
      },
      listSubagentTraces: async () => ({ traces: [] }),
    },
    (id) => {
      results.push(id);
      active = false;
    },
    () => {},
    () => active,
  );
  expect(peak).toBe(4);
  expect(reads).toBe(4);
  expect(results).toHaveLength(1);
});

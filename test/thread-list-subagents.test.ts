import { expect, test } from "vitest";
import { subagentThreadShortcuts } from "../src/lib/thread-list-subagents";
import { normalizeRouteSearch, openWorkspacePanelTab } from "../src/lib/route-search";
import type { SubagentTraceView } from "../src/types/roder";

const trace: SubagentTraceView = {
  traceId: "trace-old",
  parent: { threadId: "parent", turnId: "turn" },
  childThreadId: "child",
  childTurnId: "child-turn",
  title: "Audit login",
  role: "reviewer",
  model: "model-a",
  status: "running",
  elapsedMs: 1,
  createdAt: 1,
  updatedAt: 2,
};

test("picker shortcuts use real child identities and the latest trace for each child", () => {
  const latest = { ...trace, traceId: "trace-new", status: "completed" as const, updatedAt: 4 };
  expect(subagentThreadShortcuts([trace, { ...trace, traceId: "trace-only", childThreadId: "" }, latest])).toEqual([
    latest,
  ]);
  expect(subagentThreadShortcuts([])).toEqual([]);
});

test("Overview preserves the existing subagents panel URL identity", () => {
  const state = normalizeRouteSearch({ panelTabs: "subagents,files", panelActive: "subagents", panelOpen: "true" });
  expect(state.panelActive).toBe("subagents");
  expect(openWorkspacePanelTab(state, "subagents")).toEqual({
    panelTabs: ["subagents", "files"],
    panelActive: "subagents",
    panelOpen: true,
  });
});

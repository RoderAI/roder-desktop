import { expect, test } from "vitest";
import { filterThreadList, loadThreadListTraces, threadListProject, threadListStatus } from "../src/lib/thread-list";
import { fullPageRouteForPathname } from "../src/lib/route-selection";
import type { RoderThread, SubagentTraceSummary, Workspace } from "../src/types/roder";

const thread: RoderThread = {
  id: "parent",
  name: "Fix login",
  preview: "Investigate authentication",
  model: "model-a",
  modelProvider: "provider",
  cwd: "/work/app",
  workspaceId: "app",
  createdAt: 1,
  updatedAt: 2,
  status: { type: "running", activeTurnId: "turn", activeFlags: [] },
};
const workspace: Workspace = {
  id: "app",
  name: "Desktop",
  roots: [{ id: "root", name: "app", path: "/work/app" }],
  defaultRootId: "root",
  updatedAt: 1,
};
const trace: SubagentTraceSummary = {
  traceId: "trace",
  parent: { threadId: "parent", turnId: "turn" },
  childThreadId: "child",
  childTurnId: "child-turn",
  title: "Audit cookies",
  role: "reviewer",
  status: "completed",
  elapsedMs: 10,
};

test("thread filters search real metadata and combine status and project", () => {
  expect(filterThreadList([thread], {}, [workspace], { search: "DESKTOP", status: "running", project: "app" })).toEqual(
    [thread],
  );
  expect(filterThreadList([thread], {}, [workspace], { search: "provider", status: "idle", project: "app" })).toEqual(
    [],
  );
  expect(threadListProject({ ...thread, workspaceId: null }, [workspace])?.id).toBe("app");
  expect(threadListProject({ ...thread, cwd: "/elsewhere", workspaceId: null }, [workspace])).toBeUndefined();
});

test("matching subagent metadata keeps its actual parent discoverable", () => {
  expect(
    filterThreadList([thread], { parent: [trace] }, [workspace], {
      search: "cookies",
      status: "completed",
      project: "app",
    }),
  ).toEqual([thread]);
  expect(
    filterThreadList([thread], { parent: [trace] }, [workspace], {
      search: "cookies",
      status: "running",
      project: "app",
    }),
  ).toEqual([]);
});

test("approval and input flags are waiting, not working", () => {
  expect(threadListStatus({ ...thread, status: { ...thread.status, activeFlags: ["approvalRequired"] } })).toBe(
    "waiting",
  );
  expect(threadListStatus(thread)).toBe("running");
});

test("management routes are full pages, but actual threads remain chat routes", () => {
  expect(fullPageRouteForPathname("/threads/")).toBe("threads");
  expect(fullPageRouteForPathname("/issues")).toBe("issues");
  expect(fullPageRouteForPathname("/persistent-agents")).toBe("persistentAgents");
  expect(fullPageRouteForPathname("/plugins/explore")).toBe("plugins");
  expect(fullPageRouteForPathname("/threads/real-id")).toBeNull();
});

test("expanding a thread loads every persisted turn and the active turn without duplicate traces", async () => {
  const requested: string[] = [];
  const result = await loadThreadListTraces("parent", {
    readThread: async () => ({ thread: { ...thread, turns: [{ id: "old" }, { id: "turn" }] as RoderThread["turns"] } }),
    listSubagentTraces: async (threadId, turnId) => {
      requested.push(`${threadId}:${turnId}`);
      return { traces: [trace] };
    },
  });
  expect(requested).toEqual(["parent:old", "parent:turn"]);
  expect(result).toEqual([trace]);
});

test("missing thread details report an error rather than an empty successful subagent list", async () => {
  await expect(
    loadThreadListTraces("missing", {
      readThread: async () => ({ thread: null }),
      listSubagentTraces: async () => ({ traces: [] }),
    }),
  ).rejects.toThrow("Thread is no longer available");
});

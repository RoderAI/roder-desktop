import { expect, test, vi } from "vitest";
import { loadedTurnIdsKey, loadThreadHunks, threadHunkScopeKey } from "../src/lib/thread-hunk-loading";
import type { HunkListResult, WorkspaceChangesListResult } from "../src/types/roder";

test("streaming item changes keep the shell's loaded-turn subscription stable", () => {
  const first = [{ id: "turn-a", items: ["first"] }];
  const delta = [{ id: "turn-a", items: ["first", "streamed"] }];
  expect(loadedTurnIdsKey(first)).toBe(loadedTurnIdsKey(delta));
  expect(loadedTurnIdsKey([{ id: "older" }, ...delta])).not.toBe(loadedTurnIdsKey(first));
  expect(loadedTurnIdsKey(undefined)).toBe("[]");
});

function client() {
  return {
    listHunks: vi.fn<(threadId: string, options?: { turnId?: string }) => Promise<HunkListResult>>(async () => ({
      hunks: [],
    })),
    listWorkspaceChanges: vi.fn<
      (threadId: string, options?: { turnId?: string }) => Promise<WorkspaceChangesListResult>
    >(async () => ({
      changes: [],
    })),
  };
}

test("unloaded transcript makes no requests and turn membership has a stable key", async () => {
  const ipc = client();
  expect(threadHunkScopeKey(["b", "a", "a"])).toBe(threadHunkScopeKey(["a", "b"]));
  expect(await loadThreadHunks(ipc, "thread", threadHunkScopeKey([]))).toEqual({
    hunks: [],
    observedChanges: [],
  });
  expect(ipc.listHunks).not.toHaveBeenCalled();
  expect(ipc.listWorkspaceChanges).not.toHaveBeenCalled();
});

test("queries only loaded turn IDs using the existing turnId options", async () => {
  const ipc = client();
  await loadThreadHunks(ipc, "thread", threadHunkScopeKey(["recent-b", "recent-a", "recent-a"]));
  const expected = [
    ["thread", { turnId: "recent-a" }],
    ["thread", { turnId: "recent-b" }],
  ];
  expect(ipc.listHunks.mock.calls).toEqual(expected);
  expect(ipc.listWorkspaceChanges.mock.calls).toEqual(expected);
});

test("explicit whole-thread review requests each endpoint once without a turn filter", async () => {
  const ipc = client();
  await loadThreadHunks(ipc, "thread", threadHunkScopeKey(undefined));
  expect(ipc.listHunks.mock.calls).toEqual([["thread", {}]]);
  expect(ipc.listWorkspaceChanges.mock.calls).toEqual([["thread", {}]]);
});

test("combines observations from each loaded turn for review summaries", async () => {
  const ipc = client();
  ipc.listWorkspaceChanges.mockImplementation(async (_threadId, options) => ({
    changes: [
      {
        id: `change-${options?.turnId}`,
        threadId: "thread",
        turnId: options!.turnId!,
        toolCallId: "tool",
        toolName: "apply_patch",
        source: "gitReconciled",
        confidence: "observedAfterTool",
        files: [],
        createdAt: "2026-01-01T00:00:00Z",
      },
    ],
  }));
  const result = await loadThreadHunks(ipc, "thread", threadHunkScopeKey(["a", "b"]));
  expect(result.observedChanges.map((change) => change.turnId)).toEqual(["a", "b"]);
});

test("limits combined endpoint concurrency to four requests", async () => {
  const ipc = client();
  const releases: (() => void)[] = [];
  let running = 0;
  let maxRunning = 0;
  const wait = async () => {
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    await new Promise<void>((resolve) => releases.push(resolve));
    running -= 1;
  };
  ipc.listHunks.mockImplementation(async () => {
    await wait();
    return { hunks: [] };
  });
  ipc.listWorkspaceChanges.mockImplementation(async () => {
    await wait();
    return { changes: [] };
  });
  const result = loadThreadHunks(ipc, "thread", threadHunkScopeKey(["a", "b", "c", "d", "e"]));
  expect(running).toBe(4);
  while (releases.length) {
    releases.shift()!();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }
  await result;
  expect(maxRunning).toBe(4);
  expect(ipc.listHunks).toHaveBeenCalledTimes(5);
  expect(ipc.listWorkspaceChanges).toHaveBeenCalledTimes(5);
});

test("disposed scopes stop scheduling queued requests", async () => {
  const ipc = client();
  let disposed = false;
  ipc.listHunks.mockImplementation(async () => {
    disposed = true;
    return { hunks: [] };
  });
  await loadThreadHunks(ipc, "thread", threadHunkScopeKey(["a", "b", "c"]), () => disposed);
  expect(ipc.listHunks).toHaveBeenCalledTimes(1);
  expect(ipc.listWorkspaceChanges).not.toHaveBeenCalled();
});

test("older harnesses without workspace observations still return hunk results", async () => {
  const ipc = client();
  ipc.listWorkspaceChanges.mockRejectedValue(new Error("Method not found"));
  await expect(loadThreadHunks(ipc, "thread", threadHunkScopeKey(["a"]))).resolves.toEqual({
    hunks: [],
    observedChanges: [],
  });
  ipc.listWorkspaceChanges.mockRejectedValue(new Error("transport failed"));
  await expect(loadThreadHunks(ipc, "thread", threadHunkScopeKey(["a"]))).rejects.toThrow("transport failed");
});

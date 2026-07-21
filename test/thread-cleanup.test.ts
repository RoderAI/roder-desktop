import { expect, test, vi } from "vitest";
import type { RoderThread } from "../src/types/roder";
import {
  DEFAULT_STALE_EMPTY_THREAD_MIN_AGE_SECONDS,
  collectStaleEmptyThreadIds,
  isStaleEmptyThread,
  resetStaleEmptyThreadCleanupForTests,
  runStaleEmptyThreadCleanup,
} from "../src/lib/thread-cleanup";

const NOW = 1_774_000_000;
const STALE_AT = NOW - DEFAULT_STALE_EMPTY_THREAD_MIN_AGE_SECONDS - 60;
const FRESH_AT = NOW - 5 * 60;

function thread(overrides: Partial<RoderThread> = {}): RoderThread {
  return {
    id: "thread-1",
    preview: "Untitled thread",
    modelProvider: "openai",
    model: "gpt-5.5",
    createdAt: STALE_AT,
    updatedAt: STALE_AT,
    status: { type: "idle", activeTurnId: null, activeFlags: [] },
    cwd: "/workspace",
    messageCount: 0,
    ...overrides,
  };
}

test("fresh empty untitled thread is not stale", () => {
  expect(
    isStaleEmptyThread(
      thread({ createdAt: FRESH_AT, updatedAt: FRESH_AT }),
      NOW,
    ),
  ).toBe(false);
});

test("old empty untitled idle thread is stale", () => {
  expect(isStaleEmptyThread(thread(), NOW)).toBe(true);
});

test("old thread with messages is not stale", () => {
  expect(isStaleEmptyThread(thread({ messageCount: 3 }), NOW)).toBe(false);
});

test("running or active-turn thread is not stale", () => {
  expect(
    isStaleEmptyThread(
      thread({ status: { type: "running", activeTurnId: null, activeFlags: [] } }),
      NOW,
    ),
  ).toBe(false);
  expect(
    isStaleEmptyThread(
      thread({ status: { type: "idle", activeTurnId: "turn-1", activeFlags: [] } }),
      NOW,
    ),
  ).toBe(false);
});

test("named or non-default preview is not stale", () => {
  expect(isStaleEmptyThread(thread({ preview: "Fix the flaky test" }), NOW)).toBe(false);
  expect(isStaleEmptyThread(thread({ preview: "Untitled agent" }), NOW)).toBe(true);
});

test("age uses the later of createdAt and updatedAt", () => {
  expect(
    isStaleEmptyThread(
      thread({ createdAt: STALE_AT, updatedAt: FRESH_AT }),
      NOW,
    ),
  ).toBe(false);
  expect(
    isStaleEmptyThread(
      thread({ createdAt: FRESH_AT, updatedAt: STALE_AT }),
      NOW,
    ),
  ).toBe(false);
});

test("missing messageCount is not treated as empty", () => {
  expect(isStaleEmptyThread(thread({ messageCount: undefined }), NOW)).toBe(false);
  expect(isStaleEmptyThread(thread({ messageCount: null }), NOW)).toBe(false);
});

test("collectStaleEmptyThreadIds pages through list results and excludes protected ids", async () => {
  const pages = [
    {
      data: [
        thread({ id: "stale-a" }),
        thread({ id: "active", createdAt: STALE_AT, updatedAt: STALE_AT }),
        thread({ id: "with-messages", messageCount: 2 }),
        thread({ id: "fresh", createdAt: FRESH_AT, updatedAt: FRESH_AT }),
      ],
      nextCursor: "cursor-1",
    },
    {
      data: [
        thread({ id: "protected" }),
        thread({ id: "stale-b" }),
        thread({
          id: "running",
          status: { type: "running", activeTurnId: null, activeFlags: [] },
        }),
      ],
      nextCursor: null,
    },
  ];
  const listThreads = vi.fn(async (_limit: number, cursor?: string | null) => {
    if (!cursor) {
      return pages[0];
    }
    if (cursor === "cursor-1") {
      return pages[1];
    }
    throw new Error(`unexpected cursor ${cursor}`);
  });

  const ids = await collectStaleEmptyThreadIds({
    listThreads,
    nowSeconds: NOW,
    pageSize: 100,
    maxPages: 20,
    activeThreadId: "active",
    protectedThreadIds: ["protected"],
  });

  expect(ids).toEqual(["stale-a", "stale-b"]);
  expect(listThreads).toHaveBeenCalledTimes(2);
  expect(listThreads).toHaveBeenNthCalledWith(1, 100, undefined);
  expect(listThreads).toHaveBeenNthCalledWith(2, 100, "cursor-1");
});

test("collectStaleEmptyThreadIds stops at maxPages", async () => {
  const listThreads = vi.fn(async () => ({
    data: [thread({ id: `page-${listThreads.mock.calls.length}` })],
    nextCursor: `cursor-${listThreads.mock.calls.length}`,
  }));

  const ids = await collectStaleEmptyThreadIds({
    listThreads,
    nowSeconds: NOW,
    pageSize: 100,
    maxPages: 3,
  });

  expect(listThreads).toHaveBeenCalledTimes(3);
  expect(ids).toEqual(["page-1", "page-2", "page-3"]);
});

test("runStaleEmptyThreadCleanup archives matches, refreshes, and runs once per session", async () => {
  resetStaleEmptyThreadCleanupForTests();

  const listThreads = vi.fn(async () => ({
    data: [
      thread({ id: "stale-a" }),
      thread({ id: "active" }),
      thread({ id: "stale-b" }),
    ],
    nextCursor: null,
  }));
  const archiveThread = vi.fn(async () => ({}));
  const refreshThreads = vi.fn(async () => undefined);
  let activeThreadId = "active";

  const first = await runStaleEmptyThreadCleanup({
    listThreads,
    archiveThread,
    refreshThreads,
    getActiveThreadId: () => activeThreadId,
    nowSeconds: NOW,
  });

  expect(first.archivedIds).toEqual(["stale-a", "stale-b"]);
  expect(archiveThread).toHaveBeenCalledTimes(2);
  expect(archiveThread).toHaveBeenCalledWith("stale-a");
  expect(archiveThread).toHaveBeenCalledWith("stale-b");
  expect(refreshThreads).toHaveBeenCalledTimes(1);

  archiveThread.mockClear();
  refreshThreads.mockClear();
  listThreads.mockClear();

  const second = await runStaleEmptyThreadCleanup({
    listThreads,
    archiveThread,
    refreshThreads,
    getActiveThreadId: () => activeThreadId,
    nowSeconds: NOW,
  });

  expect(second.archivedIds).toEqual([]);
  expect(listThreads).not.toHaveBeenCalled();
  expect(archiveThread).not.toHaveBeenCalled();
  expect(refreshThreads).not.toHaveBeenCalled();
});

test("runStaleEmptyThreadCleanup skips archive when the active thread changes mid-sweep", async () => {
  resetStaleEmptyThreadCleanupForTests();

  const listThreads = vi.fn(async () => ({
    data: [thread({ id: "stale-a" }), thread({ id: "becomes-active" })],
    nextCursor: null,
  }));
  const archiveThread = vi.fn(async () => ({}));
  const refreshThreads = vi.fn(async () => undefined);
  let activeThreadId = "";

  archiveThread.mockImplementation(async (threadId: string) => {
    if (threadId === "stale-a") {
      activeThreadId = "becomes-active";
    }
    return {};
  });

  const result = await runStaleEmptyThreadCleanup({
    listThreads,
    archiveThread,
    refreshThreads,
    getActiveThreadId: () => activeThreadId,
    nowSeconds: NOW,
  });

  expect(result.archivedIds).toEqual(["stale-a"]);
  expect(archiveThread).toHaveBeenCalledTimes(1);
  expect(archiveThread).toHaveBeenCalledWith("stale-a");
  expect(refreshThreads).toHaveBeenCalledTimes(1);
});

test("runStaleEmptyThreadCleanup does not refresh when nothing was archived", async () => {
  resetStaleEmptyThreadCleanupForTests();

  const listThreads = vi.fn(async () => ({
    data: [thread({ id: "fresh", createdAt: FRESH_AT, updatedAt: FRESH_AT })],
    nextCursor: null,
  }));
  const archiveThread = vi.fn(async () => ({}));
  const refreshThreads = vi.fn(async () => undefined);

  const result = await runStaleEmptyThreadCleanup({
    listThreads,
    archiveThread,
    refreshThreads,
    getActiveThreadId: () => "",
    nowSeconds: NOW,
  });

  expect(result.archivedIds).toEqual([]);
  expect(archiveThread).not.toHaveBeenCalled();
  expect(refreshThreads).not.toHaveBeenCalled();
});

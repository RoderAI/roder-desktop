import { expect, test, vi } from "vitest";
import type { RoderThread } from "../src/types/roder";

function thread(id: string, ids: number[]): RoderThread {
  return {
    id,
    cwd: "/workspace",
    preview: id,
    model: "test",
    modelProvider: "test",
    createdAt: 1,
    updatedAt: 1,
    status: { type: "idle", activeTurnId: null, activeFlags: [] },
    turns: [
      {
        id: `${id}-turn`,
        status: "completed",
        itemsView: "default",
        items: ids.map((index) => ({ id: `message-${index}`, type: "agentMessage", text: `Message ${index}` })),
      },
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setup(request: (method: string, params?: unknown) => Promise<unknown>) {
  vi.resetModules();
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  globalThis.window = { localStorage: storage, roderDesktop: { request } } as unknown as Window & typeof globalThis;
  const { useRoderStore: store } = await import("../src/stores/roder-store");
  store.setState({ status: { state: "ready", binary: "test", appServerMethods: ["thread/history/read"] } });
  return store;
}

test("selecting a thread requests only the recent page and keeps history out of sidebar summaries", async () => {
  const recent = thread(
    "a",
    Array.from({ length: 160 }, (_, index) => index + 500),
  );
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method) =>
    method === "thread/history/read" ? { thread: recent, before: "older-a", hasMore: true } : { goal: null },
  );
  const store = await setup(request);
  await store.getState().selectThread("a");
  expect(request).toHaveBeenCalledWith("thread/history/read", { threadId: "a", limit: 160 });
  expect(request.mock.calls.some(([method]) => method === "thread/read")).toBe(false);
  expect(store.getState().threadDetails.a.turns?.[0].items).toHaveLength(160);
  expect(store.getState().threads[0].turns).toBeUndefined();
  expect(store.getState().threadHistoryByThread.a).toMatchObject({ loaded: true, hasMore: true, before: "older-a" });
});

test("older loads deduplicate requests, prepend items and preserve streaming changes", async () => {
  const older = deferred<{ thread: RoderThread; before: string | null; hasMore: boolean }>();
  const recent = thread("a", [2, 3]);
  recent.turns![0].items[1].status = "inProgress";
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method, value) => {
    if (method !== "thread/history/read") return { goal: null };
    return (value as { before?: string }).before
      ? older.promise
      : { thread: recent, before: "cursor-a", hasMore: true };
  });
  const store = await setup(request);
  await store.getState().selectThread("a");
  const first = store.getState().loadOlderThreadHistory("a");
  const duplicate = store.getState().loadOlderThreadHistory("a");
  store.getState().applyNotification({
    method: "item/agentMessage/delta",
    params: {
      seq: 1,
      eventId: "live",
      threadId: "a",
      turnId: "a-turn",
      timestamp: "2026-10-01T00:00:00Z",
      event: { type: "itemDelta", itemId: "message-3", delta: { type: "agentMessageText", delta: " live" } },
    },
  });
  older.resolve({ thread: thread("a", [0, 1, 2]), before: null, hasMore: false });
  await Promise.all([first, duplicate]);
  expect(request.mock.calls.filter(([method]) => method === "thread/history/read")).toHaveLength(2);
  const items = store.getState().threadDetails.a.turns?.[0].items ?? [];
  expect(items.map((item) => item.id)).toEqual(["message-0", "message-1", "message-2", "message-3"]);
  expect(items.at(-1)).toMatchObject({ text: "Message 3 live" });
  expect(store.getState().threadHistoryByThread.a).toMatchObject({ hasMore: false, loadingOlder: false });
});

test("out-of-order selections cannot overwrite a newer page of the same thread", async () => {
  const stale = deferred<unknown>();
  let reads = 0;
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method, value) => {
    if (method !== "thread/history/read") return { goal: null };
    const id = (value as { threadId: string }).threadId;
    if (id === "a" && reads++ === 0) return stale.promise;
    return { thread: thread(id, [10]), before: null, hasMore: false };
  });
  const store = await setup(request);
  const first = store.getState().selectThread("a");
  await store.getState().selectThread("b");
  await store.getState().selectThread("a");
  stale.resolve({ thread: thread("a", [1]), before: "stale", hasMore: true });
  await first;
  expect(store.getState().activeThreadId).toBe("a");
  expect(store.getState().threadDetails.a.turns?.[0].items[0].id).toBe("message-10");
  expect(store.getState().threadHistoryByThread.a.hasMore).toBe(false);
});

test("switching away cancels stale older results and bounds the inactive transcript cache", async () => {
  const older = deferred<unknown>();
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method, value) => {
    if (method !== "thread/history/read") return { goal: null };
    const params = value as { threadId: string; before?: string };
    if (params.before) return older.promise;
    return { thread: thread(params.threadId, [800, 801]), before: "older", hasMore: true };
  });
  const store = await setup(request);
  await store.getState().selectThread("a");
  store.setState((state) => ({
    threadDetails: {
      ...state.threadDetails,
      a: thread(
        "a",
        Array.from({ length: 500 }, (_, index) => index),
      ),
    },
  }));
  const loading = store.getState().loadOlderThreadHistory("a");
  await store.getState().selectThread("b");
  expect(store.getState().threadDetails.a.turns?.[0].items).toHaveLength(160);
  older.resolve({ thread: thread("a", [0, 1]), before: null, hasMore: false });
  await loading;
  expect(store.getState().threadDetails.a.turns?.[0].items).toHaveLength(160);
  expect(store.getState().activeThreadId).toBe("b");
});

test("failed older pages retain their cursor and can be retried or reset to recent history", async () => {
  let fail = true;
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method, value) => {
    if (method !== "thread/history/read") return { goal: null };
    if ((value as { before?: string }).before) {
      if (fail) throw new Error("Connection failed");
      return { thread: thread("a", [1]), before: null, hasMore: false };
    }
    return { thread: thread("a", [2]), before: "cursor", hasMore: true };
  });
  const store = await setup(request);
  await store.getState().selectThread("a");
  await store.getState().loadOlderThreadHistory("a");
  expect(store.getState().threadHistoryByThread.a).toMatchObject({
    before: "cursor",
    loadingOlder: false,
    error: "Connection failed",
  });
  expect(store.getState().threadDetails.a.turns?.[0].items).toHaveLength(1);
  fail = false;
  await store.getState().loadOlderThreadHistory("a");
  expect(store.getState().threadHistoryByThread.a).toMatchObject({ error: null, hasMore: false });
  await store.getState().selectThread("a", { refreshHistory: true });
  expect(store.getState().threadDetails.a.turns?.[0].items.map((item) => item.id)).toEqual(["message-2"]);
});

test("unsupported upstream history surfaces an error instead of falling back to a full transcript", async () => {
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method) => {
    if (method === "thread/history/read") throw new Error("Method not found: thread/history/read");
    if (method === "thread/read") throw new Error("Unbounded fallback must not be used");
    return { goal: null };
  });
  const store = await setup(request);
  await store.getState().selectThread("a");
  expect(store.getState().threadHistoryByThread.a).toMatchObject({
    loaded: false,
    loading: false,
    error: "Method not found: thread/history/read",
  });
  expect(request.mock.calls.some(([method]) => method === "thread/read")).toBe(false);
});

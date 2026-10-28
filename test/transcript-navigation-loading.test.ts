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
        items: ids.map((index) => ({ id: `message-${index}`, type: "userMessage", text: `Question ${index}` })),
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

type HistoryPage = { thread: RoderThread; before: string | null; hasMore: boolean };
type ReadOlder = (before: string) => Promise<HistoryPage>;

async function setup(readOlder: ReadOlder = async () => ({ thread: thread("a", [1]), before: null, hasMore: false })) {
  vi.resetModules();
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method, value) => {
    if (method !== "thread/history/read") return { goal: null };
    const params = value as { threadId: string; before?: string };
    if (params.before) return readOlder(params.before);
    return { thread: thread(params.threadId, [3]), before: "older-2", hasMore: true };
  });
  globalThis.window = { localStorage: storage, roderDesktop: { request } } as unknown as Window & typeof globalThis;
  const { useRoderStore: store } = await import("../src/stores/roder-store");
  const { loadTranscriptNavigationMessage: load } = await import("../src/lib/transcript-navigation-loading");
  store.setState({ status: { state: "ready", binary: "test", appServerMethods: ["thread/history/read"] } });
  await store.getState().selectThread("a");
  request.mockClear();
  return { store, load, request };
}

test("loads older pages sequentially until the requested user message is present", async () => {
  const { store, load, request } = await setup(async (before) =>
    before === "older-2"
      ? { thread: thread("a", [2]), before: "older-1", hasMore: true }
      : { thread: thread("a", [1]), before: "older-0", hasMore: true },
  );
  await load("a", "message-1");
  expect(request.mock.calls).toEqual([
    ["thread/history/read", { threadId: "a", before: "older-2", limit: 120 }],
    ["thread/history/read", { threadId: "a", before: "older-1", limit: 120 }],
  ]);
  expect(store.getState().threadDetails.a.turns?.[0].items.map((item) => item.id)).toEqual([
    "message-1",
    "message-2",
    "message-3",
  ]);
});

test("does not load history for a message that is already present", async () => {
  const { load, request } = await setup();
  await load("a", "message-3");
  expect(request).not.toHaveBeenCalled();
});

test("does not start when cancelled, inactive, or missing history state", async () => {
  const { load, request } = await setup();
  await load("a", "message-1", () => true);
  await load("b", "message-1");
  expect(request).not.toHaveBeenCalled();
});

test("waits for an existing older page without duplicating its request", async () => {
  const older = deferred<HistoryPage>();
  const { store, load, request } = await setup(() => older.promise);
  const inFlight = store.getState().loadOlderThreadHistory("a");
  const navigation = load("a", "message-1");
  expect(request).toHaveBeenCalledTimes(1);
  older.resolve({ thread: thread("a", [1]), before: "older-0", hasMore: true });
  await Promise.all([inFlight, navigation]);
  expect(request).toHaveBeenCalledTimes(1);
});

test("continues after an existing older page finishes without the target", async () => {
  const older = deferred<HistoryPage>();
  let reads = 0;
  const { store, load, request } = await setup(async () => {
    reads += 1;
    return reads === 1 ? older.promise : { thread: thread("a", [1]), before: null, hasMore: false };
  });
  const inFlight = store.getState().loadOlderThreadHistory("a");
  const navigation = load("a", "message-1");
  older.resolve({ thread: thread("a", [2]), before: "older-1", hasMore: true });
  await Promise.all([inFlight, navigation]);
  expect(request).toHaveBeenCalledTimes(2);
});

test("surfaces an existing older-page failure without silently retrying", async () => {
  const { store, load, request } = await setup();
  store.setState((state) => ({
    threadHistoryByThread: {
      ...state.threadHistoryByThread,
      a: { ...state.threadHistoryByThread.a, loadingOlder: true },
    },
  }));
  const navigation = load("a", "message-1");
  store.setState((state) => ({
    threadHistoryByThread: {
      ...state.threadHistoryByThread,
      a: { ...state.threadHistoryByThread.a, loadingOlder: false, error: "Existing page failed" },
    },
  }));
  await expect(navigation).rejects.toThrow("Existing page failed");
  expect(request).not.toHaveBeenCalled();
});

test("stops after cancellation while its older page is in flight", async () => {
  const older = deferred<HistoryPage>();
  const { load, request } = await setup(() => older.promise);
  let cancelled = false;
  const navigation = load("a", "message-1", () => cancelled);
  cancelled = true;
  older.resolve({ thread: thread("a", [2]), before: "older-1", hasMore: true });
  await navigation;
  expect(request).toHaveBeenCalledTimes(1);
});

test("aborting a wait stops navigation before the existing page settles", async () => {
  const older = deferred<HistoryPage>();
  const { store, load, request } = await setup(() => older.promise);
  const inFlight = store.getState().loadOlderThreadHistory("a");
  const controller = new AbortController();
  const navigation = load("a", "message-1", () => false, controller.signal);
  controller.abort();
  await navigation;
  expect(store.getState().threadHistoryByThread.a.loadingOlder).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
  older.resolve({ thread: thread("a", [2]), before: "older-1", hasMore: true });
  await inFlight;
  expect(request).toHaveBeenCalledTimes(1);
});

test.each(["thread", "request"] as const)("stops while waiting when the %s changes", async (change) => {
  const older = deferred<HistoryPage>();
  const { store, load, request } = await setup(() => older.promise);
  const inFlight = store.getState().loadOlderThreadHistory("a");
  const navigation = load("a", "message-1");
  if (change === "thread") {
    store.setState({ activeThreadId: "b" });
  } else {
    store.setState((state) => ({
      threadHistoryByThread: {
        ...state.threadHistoryByThread,
        a: { ...state.threadHistoryByThread.a, requestId: state.threadHistoryByThread.a.requestId + 1 },
      },
    }));
  }
  await navigation;
  older.resolve({ thread: thread("a", [2]), before: "older-1", hasMore: true });
  await inFlight;
  expect(request).toHaveBeenCalledTimes(1);
});

test("surfaces an older-page request error", async () => {
  const { load, request } = await setup(async () => {
    throw new Error("History connection failed");
  });
  await expect(load("a", "message-1")).rejects.toThrow("History connection failed");
  expect(request).toHaveBeenCalledTimes(1);
});

test("ignores replacement request errors after an obsolete load completes", async () => {
  const older = deferred<HistoryPage>();
  const { store, load } = await setup(() => older.promise);
  const navigation = load("a", "message-1");
  store.setState((state) => ({
    threadHistoryByThread: {
      ...state.threadHistoryByThread,
      a: {
        ...state.threadHistoryByThread.a,
        requestId: state.threadHistoryByThread.a.requestId + 1,
        error: "Replacement request failed",
      },
    },
  }));
  older.resolve({ thread: thread("a", [2]), before: "older-1", hasMore: true });
  await expect(navigation).resolves.toBeUndefined();
});

test("rejects a stalled cursor instead of repeatedly requesting the same page", async () => {
  const { load, request } = await setup(async () => ({
    thread: thread("a", [2]),
    before: "older-2",
    hasMore: true,
  }));
  await expect(load("a", "message-1")).rejects.toThrow("no longer available");
  expect(request).toHaveBeenCalledTimes(1);
});

test("surfaces exhaustion when the target does not exist in older history", async () => {
  const { load, request } = await setup();
  await expect(load("a", "message-missing")).rejects.toThrow("no longer available");
  expect(request).toHaveBeenCalledTimes(1);
});

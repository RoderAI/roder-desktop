import { expect, test, vi } from "vitest";
import {
  HISTORY_CACHE_PAGES,
  SparseTranscriptHistory,
  historyBlockRange,
  sparseHistorySegments,
  type IndexedTranscriptHistory,
  type IndexedTranscriptPage,
} from "../src/lib/sparse-transcript-history";

type Reader = ConstructorParameters<typeof SparseTranscriptHistory>[1];
const index: IndexedTranscriptHistory = {
  supported: true,
  threadId: "thread",
  before: "anchor",
  olderCount: 1_000_000,
  totalCount: 1_000_160,
};
function page(start: number, end: number): IndexedTranscriptPage {
  return {
    start,
    end,
    thread: {
      id: "thread",
      preview: "",
      modelProvider: "mock",
      model: "mock",
      createdAt: 0,
      updatedAt: 0,
      cwd: "/tmp",
      status: { type: "idle", activeTurnId: null, activeFlags: [] },
      turns: [
        {
          id: "turn",
          status: "completed",
          itemsView: "full",
          items: Array.from({ length: end - start }, (_, i) => ({
            id: String(start + i),
            type: "agentMessage",
            text: "text",
            status: "completed",
          })),
        },
      ],
    },
  };
}
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

test("huge jump reads exactly one bounded range, without traversing predecessors", async () => {
  const read = vi.fn<Reader>(async ({ start, end }) => page(start, end));
  const cache = new SparseTranscriptHistory(index, read);
  const initial = cache.getSnapshot();
  expect(cache.getSnapshot()).toBe(initial);
  cache.loadRange(900_000, 900_032);
  await flush();
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith({
    threadId: "thread",
    before: "anchor",
    olderCount: 1_000_000,
    start: 900_000,
    end: 900_032,
  });
  const loaded = cache.getSnapshot();
  cache.loadRange(900_000, 900_032);
  await flush();
  expect(read).toHaveBeenCalledTimes(1);
  expect(cache.getSnapshot()).toBe(loaded);
  expect(initial.windows).toEqual([]);
});

test("short byte-capped pages preserve the missing prefix and avoid overlapping reads", async () => {
  const read = vi.fn<Reader>(async ({ start, end }) => page(Math.max(start, end - 10), end));
  const cache = new SparseTranscriptHistory(index, read);
  cache.loadRange(0, 32);
  await flush();
  expect(read).toHaveBeenCalledTimes(1);
  expect(sparseHistorySegments({ start: 0, end: 32 }, cache.getSnapshot().windows)).toEqual([
    { start: 0, end: 22 },
    { start: 22, end: 32, page: cache.getSnapshot().windows[0] },
  ]);
  cache.loadRange(0, 32);
  await flush();
  expect(read.mock.calls[1][0]).toMatchObject({ start: 0, end: 22 });
  expect(cache.getSnapshot().windows.map(({ start, end }) => [start, end])).toEqual([
    [22, 32],
    [12, 22],
  ]);
});

test("bounds concurrency and queue, prioritizing the newest viewport work", async () => {
  const completions: (() => void)[] = [];
  const read = vi.fn<Reader>(
    ({ start, end }) =>
      new Promise<IndexedTranscriptPage>((resolve) => {
        completions.push(() => resolve(page(start, end)));
      }),
  );
  const cache = new SparseTranscriptHistory(index, read);
  cache.loadRange(0, 32);
  cache.loadRange(32, 64);
  await flush();
  for (let i = 2; i < 100; i++) cache.loadRange(i * 32, (i + 1) * 32);
  expect(read).toHaveBeenCalledTimes(2);
  expect(cache.getSnapshot().pending.length).toBeLessThanOrEqual(6);
  completions[0]();
  await flush();
  expect(read).toHaveBeenCalledTimes(3);
  expect(read.mock.calls[2][0]).toMatchObject({ start: 99 * 32, end: 100 * 32 });
  cache.dispose();
});

test("loading adjacent visible gaps does not discard an earlier queued gap", async () => {
  const completions: (() => void)[] = [];
  const read = vi.fn<Reader>(
    ({ start, end }) =>
      new Promise((resolve) => {
        completions.push(() => resolve(page(start, end)));
      }),
  );
  const cache = new SparseTranscriptHistory(index, read);
  for (let i = 0; i < 4; i++) cache.loadRange(i * 32, (i + 1) * 32);
  await flush();
  expect(cache.getSnapshot().pending).toHaveLength(4);
  completions[0]();
  completions[1]();
  await flush();
  expect(read.mock.calls.map(([range]) => range.start).sort((a, b) => a - b)).toEqual([0, 32, 64, 96]);
  cache.dispose();
});

test("unmounted gaps cancel queued payload work", async () => {
  const read = vi.fn<Reader>(() => new Promise(() => {}));
  const cache = new SparseTranscriptHistory(index, read);
  cache.loadRange(0, 32);
  cache.loadRange(32, 64);
  cache.loadRange(64, 96);
  cache.cancelRange(64, 96);
  expect(cache.getSnapshot().pending).toEqual([
    { start: 0, end: 32 },
    { start: 32, end: 64 },
  ]);
  cache.dispose();
});

test("byte-capped pages in mounted sections are retained without an eviction/refetch loop", async () => {
  const cache = new SparseTranscriptHistory(index, async ({ start, end }) => page(start, end));
  const release = cache.retainRange(0, 32);
  for (let i = 0; i < 12; i++) {
    cache.loadRange(i, i + 1);
    await flush();
  }
  expect(cache.getSnapshot().windows).toHaveLength(12);
  expect(sparseHistorySegments({ start: 0, end: 12 }, cache.getSnapshot().windows).every((part) => part.page)).toBe(
    true,
  );
  release();
  expect(cache.getSnapshot().windows).toHaveLength(HISTORY_CACHE_PAGES);
});

test("all intersecting gaps eventually load even when the viewport exceeds the pending queue capacity", async () => {
  const read = vi.fn<Reader>(async ({ start, end }) => page(start, end));
  const cache = new SparseTranscriptHistory(index, read);
  const releases = Array.from({ length: 12 }, (_, i) => cache.watchRange(i * 32, (i + 1) * 32));
  for (let i = 0; i < 12; i++) {
    expect(cache.getSnapshot().pending.length).toBeLessThanOrEqual(6);
    await flush();
  }
  expect(read).toHaveBeenCalledTimes(12);
  expect(cache.getSnapshot().windows).toHaveLength(12);
  expect(cache.getSnapshot().pending).toEqual([]);
  releases.forEach((release) => release());
  expect(cache.getSnapshot().windows).toHaveLength(HISTORY_CACHE_PAGES);
  cache.dispose();
});

test("cache payload count stays bounded and recently viewed windows survive eviction", async () => {
  const cache = new SparseTranscriptHistory(index, async ({ start, end }) => page(start, end));
  for (let i = 0; i < HISTORY_CACHE_PAGES; i++) {
    cache.loadRange(i * 32, (i + 1) * 32);
    await flush();
  }
  cache.loadRange(0, 32);
  cache.loadRange(192, 224);
  await flush();
  expect(cache.getSnapshot().windows).toHaveLength(HISTORY_CACHE_PAGES);
  expect(cache.getSnapshot().windows.some((window) => window.start === 0)).toBe(true);
  expect(cache.getSnapshot().windows.some((window) => window.start === 32)).toBe(false);
});

test("errors need explicit retry and malformed pages are rejected", async () => {
  const read = vi.fn<Reader>(async () => page(0, 31));
  const cache = new SparseTranscriptHistory(index, read);
  cache.loadRange(0, 32);
  await flush();
  expect(cache.getSnapshot().errors["0:32"]).toMatch(/does not match/);
  cache.loadRange(0, 32);
  await flush();
  expect(read).toHaveBeenCalledTimes(1);
  read.mockImplementation(async () => page(0, 32));
  cache.retry(0, 32);
  await flush();
  expect(cache.getSnapshot().errors).toEqual({});
  expect(cache.getSnapshot().windows).toHaveLength(1);
});

test("dispose releases cached payloads and ignores late completion", async () => {
  let resolve!: (page: IndexedTranscriptPage) => void;
  const cache = new SparseTranscriptHistory(
    index,
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const listener = vi.fn<() => void>();
  cache.subscribe(listener);
  cache.loadRange(0, 32);
  await flush();
  cache.dispose();
  listener.mockClear();
  resolve(page(0, 32));
  await flush();
  expect(listener).not.toHaveBeenCalled();
  expect(cache.getSnapshot()).toEqual({ windows: [], pending: [], errors: {} });
});

test("segments are ordered, contiguous, exact, and clip pages to the requested block", () => {
  const first = page(0, 10);
  const last = page(20, 40);
  expect(sparseHistorySegments({ start: 5, end: 32 }, [last, first])).toEqual([
    { start: 5, end: 10, page: first },
    { start: 10, end: 20 },
    { start: 20, end: 32, page: last },
  ]);
  expect(historyBlockRange(2, 70)).toEqual({ start: 64, end: 70 });
  expect(historyBlockRange(3, 70)).toEqual({ start: 70, end: 70 });
});

test("large caller ranges cannot create unbounded queued work or oversized reads", async () => {
  const read = vi.fn<Reader>(async ({ start, end }) => page(start, end));
  const cache = new SparseTranscriptHistory(index, read);
  cache.loadRange(0, 1_000_000);
  expect(cache.getSnapshot().pending.length).toBeLessThanOrEqual(6);
  await flush();
  expect(read.mock.calls.length).toBeLessThanOrEqual(6);
  for (const [range] of read.mock.calls) expect(range.end - range.start).toBeLessThanOrEqual(64);
});

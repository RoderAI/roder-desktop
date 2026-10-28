import { expect, test, vi } from "vitest";
import {
  createThreadHistoryService,
  type ThreadHistoryPage,
  type ThreadHistoryParams,
} from "../electron/threads/thread-history";

test("forwards canonical upstream paging parameters without loading a snapshot", async () => {
  const page: ThreadHistoryPage = { thread: null, before: "opaque-next", hasMore: true };
  const request = vi.fn<(method: string, params: ThreadHistoryParams) => Promise<ThreadHistoryPage>>(async () => page);
  const service = createThreadHistoryService({ request });
  const params = { threadId: "large", before: "opaque-anchor", limit: 120, maxBytes: 4096 };
  expect(await service.read(params)).toBe(page);
  expect(request).toHaveBeenCalledExactlyOnceWith("thread/history/read", params);
  expect(request.mock.calls.some(([method]) => method === "thread/read")).toBe(false);
});

test("does not cache initial or older pages in Electron", async () => {
  const request = vi.fn<(method: string, params: ThreadHistoryParams) => Promise<ThreadHistoryPage>>(async () => ({
    thread: null,
    before: null,
    hasMore: false,
  }));
  const service = createThreadHistoryService({ request });
  await service.read({ threadId: "a" });
  await service.read({ threadId: "a" });
  await service.read({ threadId: "a", before: "old" });
  await service.read({ threadId: "a", before: "old" });
  expect(request).toHaveBeenCalledTimes(4);
  expect(request.mock.calls.every(([method]) => method === "thread/history/read")).toBe(true);
});

test("unsupported upstream and stale cursor errors propagate without full-read fallback", async () => {
  const request = vi.fn<(method: string, params: ThreadHistoryParams) => Promise<ThreadHistoryPage>>(async () => {
    throw new Error("thread/history/read unsupported");
  });
  const service = createThreadHistoryService({ request });
  await expect(service.read({ threadId: "a" })).rejects.toThrow("unsupported");
  await expect(service.read({ threadId: "a", before: "stale" })).rejects.toThrow("unsupported");
  expect(request.mock.calls).toEqual([
    ["thread/history/read", { threadId: "a" }],
    ["thread/history/read", { threadId: "a", before: "stale" }],
  ]);
});

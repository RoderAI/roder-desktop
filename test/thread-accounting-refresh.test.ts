import { afterEach, expect, test, vi } from "vitest";
import {
  createThreadAccountingRefreshScheduler,
  shouldRefreshThreadAccounting,
} from "../src/lib/thread-accounting-refresh";

afterEach(() => vi.useRealTimers());

test("batches completion bursts and rechecks after asynchronous analytics ingestion settles", () => {
  vi.useFakeTimers();
  const refresh = vi.fn<() => void>();
  const scheduler = createThreadAccountingRefreshScheduler(refresh);
  scheduler.schedule();
  vi.advanceTimersByTime(100);
  scheduler.schedule();
  vi.advanceTimersByTime(249);
  expect(refresh).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(refresh).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1250);
  expect(refresh).toHaveBeenCalledTimes(2);
  scheduler.dispose();
});

test("disposing an accounting view cancels all pending work", () => {
  vi.useFakeTimers();
  const refresh = vi.fn<() => void>();
  const scheduler = createThreadAccountingRefreshScheduler(refresh);
  scheduler.schedule();
  scheduler.dispose();
  scheduler.schedule();
  vi.runAllTimers();
  expect(refresh).not.toHaveBeenCalled();
});

test("refreshes for tracked turns and newly discovered children but ignores unrelated token deltas", () => {
  const tracked = new Set(["root"]);
  expect(shouldRefreshThreadAccounting({ method: "turn/completed", params: { threadId: "root" } }, tracked)).toBe(true);
  expect(shouldRefreshThreadAccounting({ method: "turn/completed", params: { thread_id: "root" } }, tracked)).toBe(
    true,
  );
  expect(shouldRefreshThreadAccounting({ method: "turn/completed", params: { threadId: "unrelated" } }, tracked)).toBe(
    false,
  );
  expect(
    shouldRefreshThreadAccounting(
      {
        method: "turn/subagentTraceCompleted",
        params: { summary: { parent: { threadId: "root" }, childThreadId: "new-child" } },
      },
      tracked,
    ),
  ).toBe(true);
  expect(
    shouldRefreshThreadAccounting({ method: "item/agentMessage/delta", params: { threadId: "root" } }, tracked),
  ).toBe(false);
  expect(
    shouldRefreshThreadAccounting({ method: "team/member/completed", params: { threadId: "new-child" } }, tracked),
  ).toBe(true);
});

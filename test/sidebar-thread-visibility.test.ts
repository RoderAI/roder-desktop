import { expect, test } from "vitest";
import { visibleThreadsForGroup } from "../src/lib/sidebar-thread-visibility";

function thread(id) {
  return { id };
}

test("collapsed sidebar groups show at most five threads and report the hidden count", () => {
  const threads = [1, 2, 3, 4, 5, 6, 7].map((id) => thread(`thread-${id}`));

  const result = visibleThreadsForGroup(threads, false);

  expect(result.visibleThreads.map((item) => item.id)).toEqual([
    "thread-1",
    "thread-2",
    "thread-3",
    "thread-4",
    "thread-5",
  ]);
  expect(result.primaryThreads.map((item) => item.id)).toEqual([
    "thread-1",
    "thread-2",
    "thread-3",
    "thread-4",
    "thread-5",
  ]);
  expect(result.overflowThreads.map((item) => item.id)).toEqual(["thread-6", "thread-7"]);
  expect(result.hiddenCount).toBe(2);
  expect(result.canShowMore).toBe(true);
  expect(result.canShowLess).toBe(false);
});

test("expanded sidebar groups show all threads and offer a show less action", () => {
  const threads = [1, 2, 3, 4, 5, 6].map((id) => thread(`thread-${id}`));

  const result = visibleThreadsForGroup(threads, true);

  expect(result.visibleThreads.length).toBe(6);
  expect(result.primaryThreads.length).toBe(5);
  expect(result.overflowThreads.map((item) => item.id)).toEqual(["thread-6"]);
  expect(result.hiddenCount).toBe(0);
  expect(result.canShowMore).toBe(false);
  expect(result.canShowLess).toBe(true);
});

test("groups with five or fewer threads do not need a show more action", () => {
  const threads = [1, 2, 3, 4, 5].map((id) => thread(`thread-${id}`));

  const result = visibleThreadsForGroup(threads, false);

  expect(result.visibleThreads.length).toBe(5);
  expect(result.primaryThreads.length).toBe(5);
  expect(result.overflowThreads.length).toBe(0);
  expect(result.hiddenCount).toBe(0);
  expect(result.canShowMore).toBe(false);
  expect(result.canShowLess).toBe(false);
});

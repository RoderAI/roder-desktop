import { expect, test } from "vitest";
import {
  captureHistoryScrollAnchor,
  nestedScrollConsumesUpwardGesture,
  restoreHistoryScrollAnchor,
  shouldLoadOlderHistory,
} from "../src/lib/transcript-history";

test("only upward user scrolling near the beginning requests another page", () => {
  const state = { hasMore: true, loading: false, userIntent: true, movingUp: true, scrollTop: 120 };
  expect(shouldLoadOlderHistory(state)).toBe(true);
  expect(shouldLoadOlderHistory({ ...state, userIntent: false })).toBe(false);
  expect(shouldLoadOlderHistory({ ...state, loading: true })).toBe(false);
  expect(shouldLoadOlderHistory({ ...state, movingUp: false })).toBe(false);
  expect(shouldLoadOlderHistory({ ...state, error: "Failed" })).toBe(false);
  expect(shouldLoadOlderHistory({ ...state, scrollTop: 500 })).toBe(false);
});

test("scrolling inside expanded tool output does not fetch outer history until its own top", () => {
  const viewport = { scrollTop: 0, scrollHeight: 1000, clientHeight: 500, parentElement: null };
  const output = { scrollTop: 80, scrollHeight: 800, clientHeight: 120, parentElement: viewport };
  expect(nestedScrollConsumesUpwardGesture(output, viewport)).toBe(true);
  output.scrollTop = 0;
  expect(nestedScrollConsumesUpwardGesture(output, viewport)).toBe(false);
});

test("prepending history keeps the same visible message and pixel offset", () => {
  const anchor = captureHistoryScrollAnchor(
    [
      { key: "a", start: 100, end: 160 },
      { key: "b", start: 160, end: 220 },
    ],
    120,
    400,
  );
  expect(restoreHistoryScrollAnchor(anchor, ["older", "a", "b"], (index) => [0, 500, 560][index], 800)).toBe(520);
  // A tool group may change key when its earlier tools are loaded; use the next stable row.
  expect(restoreHistoryScrollAnchor(anchor, ["merged-tools", "b"], (index) => [0, 560][index], 800)).toBe(520);
  expect(restoreHistoryScrollAnchor(anchor, [], () => undefined, 800)).toBe(520);
});

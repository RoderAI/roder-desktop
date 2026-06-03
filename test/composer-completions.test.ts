import { expect, test } from "vitest";
import {
  completionKey,
  completionOptionId,
  currentCompletionUiState,
  moveCompletionIndex,
  shouldShowCompletionMenu,
  type CompletionUiState,
} from "../src/lib/composer-completions";

test("builds stable keys and option ids for completion menus", () => {
  expect(completionKey({ start: 2, end: 5, query: "rev" })).toBe("2:5:rev");
  expect(completionKey(null)).toBeNull();
  expect(completionOptionId("commands", 3)).toBe("commands-option-3");
});

test("moves completion highlight with wrapping navigation", () => {
  expect(moveCompletionIndex(0, 3, "next")).toBe(1);
  expect(moveCompletionIndex(2, 3, "next")).toBe(0);
  expect(moveCompletionIndex(0, 3, "previous")).toBe(2);
  expect(moveCompletionIndex(-1, 3, "next")).toBe(0);
  expect(moveCompletionIndex(-1, 3, "previous")).toBe(2);
  expect(moveCompletionIndex(0, 0, "next")).toBe(-1);
});

test("resets transient menu state when the completion key changes", () => {
  const state: CompletionUiState = {
    completionKey: "0:2:re",
    dismissedCompletionKey: "0:2:re",
    highlightedIndex: 2,
  };

  expect(currentCompletionUiState(state, "0:3:rev")).toEqual({
    completionKey: "0:3:rev",
    dismissedCompletionKey: null,
    highlightedIndex: 0,
  });
});

test("hides only the dismissed completion key", () => {
  expect(shouldShowCompletionMenu("0:2:re", "0:2:re", 2)).toBe(false);
  expect(shouldShowCompletionMenu("0:3:rev", "0:2:re", 2)).toBe(true);
  expect(shouldShowCompletionMenu(null, null, 2)).toBe(false);
  expect(shouldShowCompletionMenu("0:3:rev", null, 0)).toBe(false);
});

import { expect, test } from "vitest";
import { mergeRouteSearchUpdate, normalizeRouteSearch } from "../src/lib/route-search";

test("route search defaults preserve practical app layout state", () => {
  expect(normalizeRouteSearch({})).toEqual({
    tool: null,
    reviewScope: "thread",
    reviewTurnId: "",
    reviewPath: "",
    extension: "",
    extensionPanel: "",
    sidebar: true,
    leftWidth: 274,
    rightWidth: 560,
    provider: "all",
    q: "",
    categories: [],
  });
});

test("route search rejects unknown literals and clamps layout widths", () => {
  expect(
    normalizeRouteSearch({
      tool: "debugger",
      reviewScope: "file",
      reviewTurnId: "turn-1",
      reviewPath: "src/app.ts",
      sidebar: "false",
      leftWidth: "120",
      rightWidth: "1200",
      provider: "github",
      categories: "codex,local",
    }),
  ).toEqual({
    tool: null,
    reviewScope: "thread",
    reviewTurnId: "turn-1",
    reviewPath: "src/app.ts",
    extension: "",
    extensionPanel: "",
    sidebar: false,
    leftWidth: 220,
    rightWidth: 820,
    provider: "all",
    q: "",
    categories: ["codex", "local"],
  });
});

test("route search accepts supported practical URL state values", () => {
  expect(
    normalizeRouteSearch({
      tool: "extensions",
      reviewScope: "branch",
      reviewPath: "src/review-panel.tsx",
      extension: "github",
      extensionPanel: "settings",
      sidebar: "false",
      leftWidth: "320",
      rightWidth: "640",
      provider: "codex",
      q: "lint",
      categories: "developer-tools,automation",
    }),
  ).toEqual({
    tool: "extensions",
    reviewScope: "branch",
    reviewTurnId: "",
    reviewPath: "src/review-panel.tsx",
    extension: "github",
    extensionPanel: "settings",
    sidebar: false,
    leftWidth: 320,
    rightWidth: 640,
    provider: "codex",
    q: "lint",
    categories: ["developer-tools", "automation"],
  });
});

test("route search updates merge with current state for hash-history URL writes", () => {
  const current = normalizeRouteSearch({
    tool: "review",
    reviewScope: "branch",
    rightWidth: "640",
  });

  expect(mergeRouteSearchUpdate(current, { reviewPath: "src/review-panel.tsx" })).toEqual({
    ...current,
    reviewPath: "src/review-panel.tsx",
  });
  expect(mergeRouteSearchUpdate(current, (state) => ({ rightWidth: state.rightWidth + 20 }))).toEqual({
    ...current,
    rightWidth: 660,
  });
  expect(mergeRouteSearchUpdate(current, null)).toBeNull();
});

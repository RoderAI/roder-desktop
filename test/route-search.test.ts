import { expect, test } from "vitest";
import { normalizeRouteSearch } from "../src/lib/route-search";

test("route search defaults preserve practical app layout state", () => {
  expect(normalizeRouteSearch({})).toEqual({
    tool: null,
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
      sidebar: "false",
      leftWidth: "120",
      rightWidth: "1200",
      provider: "github",
      categories: "codex,local",
    }),
  ).toEqual({
    tool: null,
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

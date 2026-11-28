import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  filterRoderAgents,
  ordinarySidebarThreads,
  sidebarSearchReducer,
  SidebarSearchField,
} from "../src/components/app-sidebar";

const agents = [
  {
    name: "Release guide",
    mission: "Ship desktop updates",
    workspaceId: "workspace-one",
    threadId: "roderAgent-one",
  },
  {
    name: "Quality guide",
    mission: "Review regressions",
    workspaceId: "workspace-two",
    threadId: "roderAgent-two",
  },
];
const workspaces = [
  { id: "workspace-one", name: "Desktop" },
  { id: "workspace-two", name: "Website" },
];

test("Roder search matches actual names, missions and workspace names case-insensitively", () => {
  expect(filterRoderAgents(agents, " RELEASE ", workspaces)).toEqual([agents[0]]);
  expect(filterRoderAgents(agents, "regressions", workspaces)).toEqual([agents[1]]);
  expect(filterRoderAgents(agents, "website", workspaces)).toEqual([agents[1]]);
  expect(filterRoderAgents(agents, "missing", workspaces)).toEqual([]);
  expect(filterRoderAgents(agents, " ", workspaces)).toEqual(agents);
});

test("persistent threads stay separate regardless of search matches and preserve ordinary thread order", () => {
  const threads = [{ id: "ordinary-one" }, { id: "roderAgent-one" }, { id: "ordinary-two" }, { id: "roderAgent-two" }];
  expect(ordinarySidebarThreads(threads, agents)).toEqual([threads[0], threads[2]]);
  expect(ordinarySidebarThreads(threads, [])).toEqual(threads);
  expect(ordinarySidebarThreads(threads, agents)).not.toContain(threads[1]);
});

test("sidebar hides child agents even when their parent is outside the loaded thread page", () => {
  const threads = [
    { id: "root" },
    { id: "machine_ui", parentThreadId: "root" },
    { id: "machine_storage", parentThreadId: "unloaded-parent" },
    { id: "nested", parentThreadId: "machine_ui" },
    { id: "cloud_review", parentThreadId: null },
  ];

  expect(ordinarySidebarThreads(threads, [])).toEqual([threads[0], threads[4]]);
  expect(threads).toHaveLength(5);
});

test("sidebar also hides child identities learned from traces without removing their parent", () => {
  const threads = [{ id: "parent" }, { id: "child" }, { id: "other" }];
  const traces = {
    parent: [{ childThreadId: "child" }, { childThreadId: "" }],
    unloadedParent: [{ childThreadId: "other" }, { childThreadId: "child" }],
  };

  expect(ordinarySidebarThreads(threads, [], traces)).toEqual([threads[0]]);
});

test("sidebar hides parent-owned workspace forks because isolated subagents also use them", () => {
  const threads = [
    { id: "fork", parentThreadId: "root", workspaceFork: { id: "workspace-fork" } },
    { id: "child", parentThreadId: "root", workspaceFork: null },
    { id: "roderAgent-one", parentThreadId: "root", workspaceFork: { id: "other-fork" } },
  ];
  const traces = { root: [{ childThreadId: "fork" }, { childThreadId: "child" }] };

  expect(ordinarySidebarThreads(threads, agents, traces)).toEqual([]);
});

test("sidebar search is opt-in and closing or Escape cannot leave a hidden filter", () => {
  const initial = { open: false, query: "" };
  expect(sidebarSearchReducer(initial, { type: "query", query: "ignored while hidden" })).toEqual(initial);
  const opened = sidebarSearchReducer(initial, { type: "open" });
  const searching = sidebarSearchReducer(opened, { type: "query", query: "release" });
  expect(searching).toEqual({ open: true, query: "release" });
  expect(sidebarSearchReducer(searching, { type: "close" })).toEqual(initial);
});

test("sidebar search field renders no input by default and an accessible close control when explicitly opened", () => {
  const props = { label: "Search Roders", onChange: () => undefined, onClose: () => undefined };
  expect(
    renderToStaticMarkup(createElement(SidebarSearchField, { ...props, search: { open: false, query: "" } })),
  ).toBe("");
  const opened = renderToStaticMarkup(
    createElement(SidebarSearchField, { ...props, search: { open: true, query: "release" } }),
  );
  expect(opened).toContain('aria-label="Search Roders"');
  expect(opened).toContain('value="release"');
  expect(opened).toContain('aria-label="Close search"');
});

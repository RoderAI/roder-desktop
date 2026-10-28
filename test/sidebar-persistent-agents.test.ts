import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  filterPersistentAgents,
  ordinarySidebarThreads,
  sidebarSearchReducer,
  SidebarSearchField,
} from "../src/components/app-sidebar";

const agents = [
  {
    name: "Release guide",
    mission: "Ship desktop updates",
    workspaceId: "workspace-one",
    threadId: "persistentAgent-one",
  },
  {
    name: "Quality guide",
    mission: "Review regressions",
    workspaceId: "workspace-two",
    threadId: "persistentAgent-two",
  },
];
const workspaces = [
  { id: "workspace-one", name: "Desktop" },
  { id: "workspace-two", name: "Website" },
];

test("persistent agent search matches actual names, missions and workspace names case-insensitively", () => {
  expect(filterPersistentAgents(agents, " RELEASE ", workspaces)).toEqual([agents[0]]);
  expect(filterPersistentAgents(agents, "regressions", workspaces)).toEqual([agents[1]]);
  expect(filterPersistentAgents(agents, "website", workspaces)).toEqual([agents[1]]);
  expect(filterPersistentAgents(agents, "missing", workspaces)).toEqual([]);
  expect(filterPersistentAgents(agents, " ", workspaces)).toEqual(agents);
});

test("persistent threads stay separate regardless of search matches and preserve ordinary thread order", () => {
  const threads = [
    { id: "ordinary-one" },
    { id: "persistentAgent-one" },
    { id: "ordinary-two" },
    { id: "persistentAgent-two" },
  ];
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
    { id: "persistentAgent-one", parentThreadId: "root", workspaceFork: { id: "other-fork" } },
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
  const props = { label: "Search persistent agents", onChange: () => undefined, onClose: () => undefined };
  expect(
    renderToStaticMarkup(createElement(SidebarSearchField, { ...props, search: { open: false, query: "" } })),
  ).toBe("");
  const opened = renderToStaticMarkup(
    createElement(SidebarSearchField, { ...props, search: { open: true, query: "release" } }),
  );
  expect(opened).toContain('aria-label="Search persistent agents"');
  expect(opened).toContain('value="release"');
  expect(opened).toContain('aria-label="Close search"');
});

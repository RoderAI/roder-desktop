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

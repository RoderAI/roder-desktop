import { expect, test } from "vitest";
import {
  archiveRouteAfterThreadRemoval,
  defaultRouteForHydratedState,
  defaultPluginsRoute,
  isPluginsRoutePath,
  normalizeSettingsSectionParam,
  pluginsRouteForSection,
  threadSelectionForRoute,
} from "../src/lib/route-selection";

test("thread routes select the URL thread without pushing custom thread history", () => {
  expect(threadSelectionForRoute({ route: "thread", threadId: "thread-a", activeThreadId: "thread-b" })).toEqual({
    threadId: "thread-a",
    pushHistory: false,
  });
  expect(threadSelectionForRoute({ route: "thread", threadId: "thread-a", activeThreadId: "thread-a" })).toBeNull();
});

test("new route clears active thread selection so prompt send starts a thread", () => {
  expect(threadSelectionForRoute({ route: "new", activeThreadId: "thread-a" })).toEqual({
    threadId: "",
    pushHistory: false,
  });
  expect(threadSelectionForRoute({ route: "new", activeThreadId: "" })).toBeNull();
});

test("settings route accepts known sections and falls back to general", () => {
  expect(normalizeSettingsSectionParam("appearance")).toBe("appearance");
  expect(normalizeSettingsSectionParam("not-real")).toBe("general");
  expect(normalizeSettingsSectionParam(undefined)).toBe("general");
});

test("empty route redirects to the persisted thread or new agent route after hydration", () => {
  expect(defaultRouteForHydratedState({ activeThreadId: "thread-a" })).toBe("/threads/thread-a");
  expect(defaultRouteForHydratedState({ activeThreadId: "" })).toBe("/new");
});

test("plugins installed and explore views are route-owned pages", () => {
  expect(defaultPluginsRoute()).toBe("/plugins/installed");
  expect(pluginsRouteForSection("installed")).toBe("/plugins/installed");
  expect(pluginsRouteForSection("explore")).toBe("/plugins/explore");
  expect(isPluginsRoutePath("/plugins")).toBe(true);
  expect(isPluginsRoutePath("/plugins/installed")).toBe(true);
  expect(isPluginsRoutePath("/plugins/explore")).toBe(true);
  expect(isPluginsRoutePath("/threads/thread-a")).toBe(false);
});

test("active archive navigates to the next thread or the new route", () => {
  expect(
    archiveRouteAfterThreadRemoval({
      activeThreadId: "thread-a",
      archivedThreadId: "thread-a",
      threads: [{ id: "thread-a" }, { id: "thread-b" }],
    }),
  ).toEqual({ route: "thread", threadId: "thread-b" });
  expect(
    archiveRouteAfterThreadRemoval({
      activeThreadId: "thread-a",
      archivedThreadId: "thread-a",
      threads: [{ id: "thread-a" }],
    }),
  ).toEqual({ route: "new" });
  expect(
    archiveRouteAfterThreadRemoval({
      activeThreadId: "thread-a",
      archivedThreadId: "thread-b",
      threads: [{ id: "thread-a" }, { id: "thread-b" }],
    }),
  ).toBeNull();
});

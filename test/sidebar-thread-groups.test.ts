import { expect, test } from "vitest";
import { groupThreadsByFolder, moveSidebarProject, sidebarProjectOrder } from "../src/lib/sidebar-thread-groups";

function thread(id, cwd, updatedAt = 100) {
  return {
    id,
    name: id,
    preview: "",
    cwd,
    updatedAt,
    status: { type: "idle", activeTurnId: null, activeFlags: [] },
    turns: [],
  };
}

test("sidebar project order follows the most recently updated thread by default", () => {
  const threads = [
    thread("old-a", "/workspace/project-a", 20),
    thread("new-b", "/workspace/project-b", 200),
    thread("new-a", "/workspace/project-a", 300),
  ];
  expect(sidebarProjectOrder(threads, [])).toEqual(["/workspace/project-a", "/workspace/project-b"]);
  expect(sidebarProjectOrder([threads[0], threads[1]], [])).toEqual([
    "/workspace/project-b",
    "/workspace/project-a",
  ]);
});

test("sidebar project order preserves manually arranged projects and prepends new projects", () => {
  const currentOrder = ["/workspace/project-a", "/workspace/project-b"];
  const threads = [
    thread("thread-c", "/workspace/project-c"),
    thread("thread-a", "/workspace/project-a"),
    thread("thread-b", "/workspace/project-b"),
  ];

  expect(Array.from(sidebarProjectOrder(threads, currentOrder))).toEqual([
    "/workspace/project-c",
    "/workspace/project-a",
    "/workspace/project-b",
  ]);
});

test("sidebar project groups follow the stable project order", () => {
  const threads = [
    thread("thread-b-new", "/workspace/project-b"),
    thread("thread-a", "/workspace/project-a"),
    thread("thread-b-old", "/workspace/project-b", 50),
  ];

  const groups = groupThreadsByFolder(threads, ["/workspace/project-a", "/workspace/project-b"]);

  expect(Array.from(groups, (group) => group.key)).toEqual(["/workspace/project-a", "/workspace/project-b"]);
  expect(Array.from(groups[1].threads, (item) => item.id)).toEqual(["thread-b-new", "thread-b-old"]);
});

test("threads within a project are ordered by most recent activity", () => {
  const groups = groupThreadsByFolder(
    [thread("old", "/workspace/project-a", 10), thread("new", "/workspace/project-a", 50)],
    [],
  );
  expect(groups[0].threads.map((item) => item.id)).toEqual(["new", "old"]);
});

test("dragging a project before another changes order without changing its threads", () => {
  const order = ["/a", "/b", "/c"];
  expect(moveSidebarProject(order, "/c", "/a")).toEqual(["/c", "/a", "/b"]);
  expect(moveSidebarProject(order, "/a", "/c")).toEqual(["/b", "/a", "/c"]);
  expect(moveSidebarProject(order, "/missing", "/a")).toBe(order);
});

test("sidebar project groups display Windows folder names", () => {
  const groups = groupThreadsByFolder(
    [thread("local", "C:\\Users\\pz\\w\\gode"), thread("unc", "\\\\server\\share\\project")],
    [],
  );

  expect(Array.from(groups, (group) => group.title)).toEqual(["gode", "project"]);
});

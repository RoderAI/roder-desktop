import { expect, test } from "vitest";
import { groupThreadsByFolder, sidebarProjectOrder } from "../src/lib/sidebar-thread-groups";

function thread(id, cwd) {
  return {
    id,
    name: id,
    preview: "",
    cwd,
    updatedAt: 100,
    status: { type: "idle", activeTurnId: null, activeFlags: [] },
    turns: [],
  };
}

test("sidebar project order keeps existing projects in place and prepends new projects", () => {
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
    thread("thread-b-old", "/workspace/project-b"),
  ];

  const groups = groupThreadsByFolder(threads, ["/workspace/project-a", "/workspace/project-b"]);

  expect(Array.from(groups, (group) => group.key)).toEqual(["/workspace/project-a", "/workspace/project-b"]);
  expect(Array.from(groups[1].threads, (item) => item.id)).toEqual(["thread-b-new", "thread-b-old"]);
});

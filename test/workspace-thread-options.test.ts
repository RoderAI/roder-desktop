import { expect, test } from "vitest";
import {
  buildFolderOptions,
  buildThreadOptions,
  latestThreadInFolder,
  workspaceName,
} from "../src/lib/workspace-thread-options";
import type { RoderThread } from "../src/types/roder";

test("folder options include the active workspace first and summarize non-demo threads", () => {
  const threads = [
    thread({ id: "old-app", cwd: "/work/app", updatedAt: 100 }),
    thread({ id: "new-api", cwd: "/work/api/", updatedAt: 300_000 }),
    thread({ id: "new-app", cwd: "/work/app/", updatedAt: 200_000 }),
    thread({ id: "demo-app", cwd: "/work/app", updatedAt: 999_000 }),
  ];

  expect(buildFolderOptions(threads, "/work/api/")).toEqual([
    { path: "/work/api", name: "api", updatedAt: expect.any(Number), threadCount: 1 },
    { path: "/work/app", name: "app", updatedAt: 200_000_000, threadCount: 2 },
  ]);
});

test("folder options preserve an active workspace with no threads", () => {
  expect(buildFolderOptions([thread({ id: "thread-a", cwd: "/work/app", updatedAt: 100 })], "/work/new")).toEqual([
    { path: "/work/new", name: "new", updatedAt: expect.any(Number), threadCount: 0 },
    { path: "/work/app", name: "app", updatedAt: 100_000, threadCount: 1 },
  ]);
});

test("thread options and latest thread selection are scoped to the selected folder", () => {
  const threads = [
    thread({ id: "api-old", cwd: "/work/api", updatedAt: 100 }),
    thread({ id: "app-new", cwd: "/work/app", updatedAt: 400 }),
    thread({ id: "api-new", cwd: "/work/api/", updatedAt: 300 }),
    thread({ id: "demo-api", cwd: "/work/api", updatedAt: 900 }),
  ];

  expect(buildThreadOptions(threads, "/work/api").map((item) => item.id)).toEqual(["api-new", "api-old"]);
  expect(latestThreadInFolder(threads, "/work/api")?.id).toBe("api-new");
  expect(latestThreadInFolder(threads, "/work/missing")).toBeUndefined();
});

test("workspaceName handles Windows paths", () => {
  expect(workspaceName("C:\\Users\\example\\gode-desktop")).toBe("gode-desktop");
  expect(workspaceName("\\\\server\\share\\project")).toBe("project");
});

function thread(overrides: Pick<RoderThread, "id" | "cwd" | "updatedAt">): RoderThread {
  return {
    preview: "",
    modelProvider: "openai",
    model: "gpt-5",
    createdAt: overrides.updatedAt,
    status: { type: "completed", activeTurnId: null, activeFlags: [] },
    ...overrides,
  };
}

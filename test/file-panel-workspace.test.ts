import { expect, test } from "vitest";
import {
  filePanelShouldIndexDirectory,
  filePanelWorkspaceFilesAvailable,
  filePanelWorkspaceKey,
  indexFilePanelWorkspaceRoots,
  mergeFilePanelIndexedPaths,
  resolveFilePanelPath,
  workspaceFilesEntriesToIndexedPaths,
} from "../src/lib/file-panel";
import {
  directoryEntry,
  fileEntry,
  readDirectoryResult,
  roots,
  workspaceFileEntry,
  workspaceFileMethods,
} from "./file-panel-fixtures";
import type { WorkspaceFileEntry } from "../src/types/roder";

test("file panel resolves relative paths without escaping the selected root", () => {
  expect(resolveFilePanelPath(roots, { rootId: "root_b", relativePath: "src/index.ts" })).toEqual({
    absolutePath: "/workspace/packages/app/src/index.ts",
    root: roots[1],
  });
  expect(resolveFilePanelPath(roots, { rootId: "root_b", relativePath: "src/../README.md" })).toEqual({
    absolutePath: "/workspace/packages/app/README.md",
    root: roots[1],
  });

  expect(() => resolveFilePanelPath(roots, { rootId: "root_b", relativePath: "../secrets.txt" })).toThrow(
    "outside the workspace root",
  );
  expect(() => resolveFilePanelPath(roots, { rootId: "root_missing", relativePath: "README.md" })).toThrow(
    "Workspace root not found",
  );
});

test("file panel workspace key changes when switching projects", () => {
  const projectA = [{ id: "root_1", name: "app", path: "/workspace/project-a" }];
  const projectB = [{ id: "root_2", name: "app", path: "/workspace/project-b" }];
  const multiRoot = [
    { id: "root_1", name: "app", path: "/workspace/project-a" },
    { id: "root_2", name: "api", path: "/workspace/project-b" },
  ];

  expect(filePanelWorkspaceKey("ws_1", projectA, "root_1", true)).not.toBe(
    filePanelWorkspaceKey("ws_2", projectB, "root_2", true),
  );
  expect(filePanelWorkspaceKey("ws_1", multiRoot, "root_1", true)).not.toBe(
    filePanelWorkspaceKey("ws_1", multiRoot, "root_2", true),
  );
  expect(filePanelWorkspaceKey("ws_1", projectA, "root_1", true)).not.toBe(
    filePanelWorkspaceKey("ws_1", projectA, "root_1", false),
  );
});

test("file panel requires the canonical workspace file API methods", () => {
  expect(filePanelWorkspaceFilesAvailable(workspaceFileMethods)).toBe(true);
  expect(filePanelWorkspaceFilesAvailable(["fs/readDirectory", "fs/readFile"])).toBe(false);
  expect(
    filePanelWorkspaceFilesAvailable(workspaceFileMethods.filter((method) => method !== "workspace/files/query")),
  ).toBe(false);
});

test("file panel indexing keeps readable paths when a nested directory fails", async () => {
  const result = await indexFilePanelWorkspaceRoots([roots[0]], 100, async (path) => {
    if (path === "/workspace/app") {
      return readDirectoryResult([directoryEntry("private"), directoryEntry("src"), fileEntry("README.md")]);
    }
    if (path === "/workspace/app/private") {
      throw new Error("Permission denied");
    }
    if (path === "/workspace/app/src") {
      return readDirectoryResult([fileEntry("index.ts")]);
    }
    throw new Error(`Unexpected path ${path}`);
  });

  expect(result).toEqual({
    truncated: false,
    indexedPaths: [
      { rootId: "root_a", relativePath: "private", kind: "directory" },
      { rootId: "root_a", relativePath: "src", kind: "directory" },
      { rootId: "root_a", relativePath: "README.md", kind: "file" },
      { rootId: "root_a", relativePath: "src/index.ts", kind: "file" },
    ],
    directoryErrors: [{ rootId: "root_a", relativePath: "private", error: "Permission denied" }],
  });
});

test("file panel skips heavy directories while indexing", () => {
  expect(filePanelShouldIndexDirectory("src")).toBe(true);
  expect(filePanelShouldIndexDirectory("node_modules")).toBe(false);
  expect(filePanelShouldIndexDirectory("packages/app/.git")).toBe(false);
});

test("file panel maps workspace file entries into indexed paths", () => {
  const entries: WorkspaceFileEntry[] = [
    workspaceFileEntry({ path: "src", name: "src", kind: "directory", hasChildren: true }),
    workspaceFileEntry({ path: "src/index.ts", name: "index.ts", kind: "file", hasChildren: false }),
    workspaceFileEntry({ path: "", name: "app", kind: "directory", hasChildren: true }),
  ];

  expect(workspaceFilesEntriesToIndexedPaths(entries)).toEqual([
    { rootId: "root_a", relativePath: "src", kind: "directory", hasChildren: true },
    { rootId: "root_a", relativePath: "src/index.ts", kind: "file", hasChildren: false },
    { rootId: "root_a", relativePath: "", kind: "directory", hasChildren: true },
  ]);
  expect(
    mergeFilePanelIndexedPaths(
      [{ rootId: "root_a", relativePath: "src", kind: "directory", hasChildren: true }],
      [{ rootId: "root_a", relativePath: "src/index.ts", kind: "file", hasChildren: false }],
    ),
  ).toEqual([
    { rootId: "root_a", relativePath: "src", kind: "directory", hasChildren: true },
    { rootId: "root_a", relativePath: "src/index.ts", kind: "file", hasChildren: false },
  ]);
});

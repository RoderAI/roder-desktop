import { expect, test } from "vitest";
import {
  filePanelSearchLauncherResults,
  type FilePanelSearchLauncherResult,
} from "../src/lib/file-panel/search-launcher";
import { roots, workspaceFileEntry } from "./file-panel-fixtures";
import type { WorkspaceFilesQueryMatch } from "../src/types/roder";

test("file search launcher maps file matches into root-aware results", () => {
  const [result] = filePanelSearchLauncherResults(roots, [
    match({ path: "src/index.ts", name: "index.ts", kind: "file", rootId: "root_a" }),
  ]);

  expect(result).toEqual({
    key: "root_a\u0000src/index.ts",
    title: "index.ts",
    subtitle: "app/src/index.ts",
    rootLabel: "app",
    indexedPath: { rootId: "root_a", relativePath: "src/index.ts", kind: "file", hasChildren: false },
  } satisfies FilePanelSearchLauncherResult);
});

test("file search launcher maps directory matches into folder results", () => {
  const [result] = filePanelSearchLauncherResults(roots, [
    match({ path: "src/components", name: "components", kind: "directory", rootId: "root_b", hasChildren: true }),
  ]);

  expect(result).toEqual(
    expect.objectContaining({
      key: "root_b\u0000src/components",
      title: "components",
      subtitle: "app - packages/app/src/components",
      rootLabel: "app - packages/app",
      indexedPath: { rootId: "root_b", relativePath: "src/components", kind: "directory", hasChildren: true },
    }),
  );
});

test("file search launcher disambiguates duplicate relative paths across roots", () => {
  const results = filePanelSearchLauncherResults(roots, [
    match({ path: "README.md", name: "README.md", kind: "file", rootId: "root_a" }),
    match({ path: "README.md", name: "README.md", kind: "file", rootId: "root_b" }),
  ]);

  expect(results.map((result) => result.key)).toEqual(["root_a\u0000README.md", "root_b\u0000README.md"]);
  expect(results.map((result) => result.subtitle)).toEqual(["app/README.md", "app - packages/app/README.md"]);
});

test("file search launcher labels root directory matches", () => {
  const [result] = filePanelSearchLauncherResults(roots, [
    match({ path: "", name: "app", kind: "directory", rootId: "root_a", hasChildren: true }),
  ]);

  expect(result.title).toBe("app");
  expect(result.subtitle).toBe("/workspace/app");
});

test("file search launcher drops malformed entries", () => {
  expect(
    filePanelSearchLauncherResults(roots, [
      {
        entry: { rootId: "", rootName: "app", path: "README.md", name: "README.md", kind: "file", hasChildren: false },
        score: 1,
        matchPositions: [],
      },
      {
        entry: {
          rootId: "root_a",
          rootName: "app",
          path: "README.md",
          name: "README.md",
          kind: "other",
          hasChildren: false,
        },
        score: 1,
        matchPositions: [],
      } as unknown as WorkspaceFilesQueryMatch,
    ]),
  ).toEqual([]);
});

function match(entry: Parameters<typeof workspaceFileEntry>[0]): WorkspaceFilesQueryMatch {
  return { entry: workspaceFileEntry(entry), score: 100, matchPositions: [] };
}

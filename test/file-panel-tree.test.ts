import { expect, test } from "vitest";
import {
  filePanelFileIcon,
  filePanelFileIconSpriteSheet,
  filePanelDirectoryChain,
  filePanelIndexedPathByTreePath,
  filePanelReloadableDirectoryPaths,
  filePanelRootItems,
  filePanelSearchResultLimitSummary,
  filePanelSearchPaths,
  filePanelSelectionKey,
  filePanelTabTitle,
  filePanelTreeInitialExpandedPaths,
  filePanelTreeInitialExpansion,
  filePanelTreePaths,
  nextFilePanelActiveTabKey,
  type FilePanelIndexedPath,
} from "../src/lib/file-panel";
import { indexedPath, roots } from "./file-panel-fixtures";

test("file panel root items disambiguate multi-root workspace labels", () => {
  expect(filePanelRootItems(roots)).toEqual([
    expect.objectContaining({ id: "root_a", label: "app", treePath: "app" }),
    expect.objectContaining({ id: "root_b", label: "app - packages/app", treePath: "app - packages-app" }),
  ]);
});

test("file panel tree paths preserve duplicate relative paths across roots", () => {
  const paths = filePanelTreePaths(roots, [
    indexedPath("root_a", "", "directory"),
    indexedPath("root_b", "", "directory"),
    indexedPath("root_a", "README.md"),
    indexedPath("root_b", "README.md"),
    indexedPath("root_b", "src/index.ts"),
  ]);

  expect(paths).toEqual([
    "app/",
    "app/README.md",
    "app - packages-app/",
    "app - packages-app/README.md",
    "app - packages-app/src/index.ts",
  ]);
});

test("file panel tree paths include explicit directories from workspace entries", () => {
  const paths = filePanelTreePaths(roots, [
    indexedPath("root_a", "voice-plan-feedback", "directory"),
    indexedPath("root_a", "voice-plan-feedback/notes.md"),
  ]);
  const indexedPathByTreePath = filePanelIndexedPathByTreePath(roots, [
    indexedPath("root_a", "voice-plan-feedback", "directory"),
    indexedPath("root_a", "voice-plan-feedback/notes.md"),
  ]);

  expect(paths).toEqual(["app/voice-plan-feedback/", "app/voice-plan-feedback/notes.md"]);
  expect(indexedPathByTreePath.get("app/voice-plan-feedback/")).toEqual(
    expect.objectContaining({ kind: "directory", relativePath: "voice-plan-feedback" }),
  );
  expect(indexedPathByTreePath.get("app/voice-plan-feedback/notes.md")).toEqual(
    expect.objectContaining({ kind: "file", relativePath: "voice-plan-feedback/notes.md" }),
  );
});

test("file panel directory chain expands ancestors before a nested folder", () => {
  expect(
    filePanelDirectoryChain({
      rootId: "root_a",
      relativePath: "src/components/ui",
      kind: "directory",
      hasChildren: false,
    }),
  ).toEqual([
    { rootId: "root_a", relativePath: "src", kind: "directory", hasChildren: true },
    { rootId: "root_a", relativePath: "src/components", kind: "directory", hasChildren: true },
    { rootId: "root_a", relativePath: "src/components/ui", kind: "directory", hasChildren: false },
  ]);
});

test("file panel path search includes matching files with root context", () => {
  const results = filePanelSearchPaths(
    roots,
    [indexedPath("root_a", "README.md"), indexedPath("root_b", "README.md"), indexedPath("root_b", "src/index.ts")],
    "read me",
  );

  expect(results).toEqual([
    expect.objectContaining({ rootId: "root_a", relativePath: "README.md" }),
    expect.objectContaining({ rootId: "root_b", relativePath: "README.md" }),
  ]);
});

test("file panel opens tree results while searching", () => {
  expect(filePanelTreeInitialExpansion("")).toBe(1);
  expect(filePanelTreeInitialExpansion("   ")).toBe(1);
  expect(filePanelTreeInitialExpansion("index")).toBe("open");
  expect(
    filePanelTreeInitialExpandedPaths(["app/README.md", "app/src/index.ts", "app/src/components/file-panel.tsx"], 1),
  ).toEqual(["app"]);
  expect(filePanelTreeInitialExpandedPaths(["app/", "app/README.md", "app/src/"], 1)).toEqual(["app"]);
  expect(
    filePanelTreeInitialExpandedPaths(
      ["app/README.md", "app/src/index.ts", "app/src/components/file-panel.tsx"],
      "open",
    ),
  ).toEqual(["app", "app/src", "app/src/components"]);
});

test("file panel derives stable file tab labels and active tab fallbacks", () => {
  const first = { key: filePanelSelectionKey({ rootId: "root_a", relativePath: "src/index.ts" }) };
  const second = { key: filePanelSelectionKey({ rootId: "root_a", relativePath: "README.md" }) };
  const third = { key: filePanelSelectionKey({ rootId: "root_b", relativePath: "src/index.ts" }) };

  expect(first.key).not.toBe(third.key);
  expect(filePanelTabTitle({ rootId: "root_a", relativePath: "src/index.ts" })).toBe("index.ts");
  expect(nextFilePanelActiveTabKey([first, second, third], second.key, second.key)).toBe(third.key);
  expect(nextFilePanelActiveTabKey([first, second, third], third.key, third.key)).toBe(second.key);
  expect(nextFilePanelActiveTabKey([first, second, third], first.key, second.key)).toBe(first.key);
});

test("file panel summarizes capped search results when the index is larger than the result limit", () => {
  expect(filePanelSearchResultLimitSummary(199, 5000, 200)).toBeNull();
  expect(filePanelSearchResultLimitSummary(200, 200, 200)).toBeNull();
  expect(filePanelSearchResultLimitSummary(200, 5000, 200)).toBe("Showing first 200 matches from 5000 indexed files.");
});

test("file panel resolves file type icons from the tree icon set", () => {
  expect(filePanelFileIcon("src/index.ts")).toEqual(
    expect.objectContaining({
      name: "file-tree-builtin-typescript",
      remappedFrom: "file-tree-icon-file",
      token: "typescript",
    }),
  );
  expect(filePanelFileIcon("src/App.tsx")).toEqual(
    expect.objectContaining({ name: "file-tree-builtin-react", token: "react" }),
  );
  expect(filePanelFileIconSpriteSheet).toContain('id="file-tree-builtin-typescript"');
});

test("file panel reloads previously loaded nested directories as their parents reappear", () => {
  const rootDirectory = {
    rootId: "root_a",
    relativePath: "",
    kind: "directory",
    hasChildren: true,
  } satisfies FilePanelIndexedPath;
  const srcDirectory = {
    rootId: "root_a",
    relativePath: "src",
    kind: "directory",
    hasChildren: true,
  } satisfies FilePanelIndexedPath;
  const componentsDirectory = {
    rootId: "root_a",
    relativePath: "src/components",
    kind: "directory",
    hasChildren: true,
  } satisfies FilePanelIndexedPath;
  const previouslyLoadedDirectoryKeys = new Set([
    filePanelSelectionKey(srcDirectory),
    filePanelSelectionKey(componentsDirectory),
  ]);
  const skippedDirectoryKeys = new Set([filePanelSelectionKey(rootDirectory)]);

  expect(
    filePanelReloadableDirectoryPaths(
      [rootDirectory, srcDirectory],
      previouslyLoadedDirectoryKeys,
      skippedDirectoryKeys,
    ),
  ).toEqual([srcDirectory]);

  skippedDirectoryKeys.add(filePanelSelectionKey(srcDirectory));
  expect(
    filePanelReloadableDirectoryPaths(
      [rootDirectory, srcDirectory, componentsDirectory],
      previouslyLoadedDirectoryKeys,
      skippedDirectoryKeys,
    ),
  ).toEqual([componentsDirectory]);
});

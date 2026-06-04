import { expect, test } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  decodeFileContent,
  filePanelFileIcon,
  filePanelFileIconSpriteSheet,
  filePanelIndexedPathByTreePath,
  filePanelRootItems,
  filePanelSearchPaths,
  filePanelShouldIndexDirectory,
  filePanelSelectionKey,
  filePanelTabTitle,
  filePanelTreeInitialExpansion,
  filePanelTreePaths,
  indexFilePanelWorkspaceRoots,
  nextFilePanelActiveTabKey,
  resolveFilePanelPath,
  type FilePanelIndexedPath,
} from "../src/lib/file-panel";
import { highlightFileContent, languageForFilePath } from "../src/lib/file-syntax-highlight";
import type { FileSystemReadDirectoryResult, WorkspaceRoot } from "../src/types/roder";

const roots: WorkspaceRoot[] = [
  { id: "root_a", name: "app", path: "/workspace/app" },
  { id: "root_b", name: "app", path: "/workspace/packages/app" },
];

test("file panel root items disambiguate multi-root workspace labels", () => {
  expect(filePanelRootItems(roots)).toEqual([
    expect.objectContaining({ id: "root_a", label: "app", treePath: "app" }),
    expect.objectContaining({ id: "root_b", label: "app - packages/app", treePath: "app - packages-app" }),
  ]);
});

test("file panel tree paths preserve duplicate relative paths across roots", () => {
  const paths = filePanelTreePaths(roots, [
    indexedPath("root_a", "README.md"),
    indexedPath("root_b", "README.md"),
    indexedPath("root_b", "src/index.ts"),
  ]);

  expect(paths).toEqual(["app/README.md", "app - packages-app/README.md", "app - packages-app/src/index.ts"]);
});

test("file panel tree paths let the tree library infer directories from files", () => {
  const paths = filePanelTreePaths(roots, [
    indexedPath("root_a", "voice-plan-feedback", "directory"),
    indexedPath("root_a", "voice-plan-feedback/notes.md"),
  ]);
  const indexedPathByTreePath = filePanelIndexedPathByTreePath(roots, [
    indexedPath("root_a", "voice-plan-feedback", "directory"),
    indexedPath("root_a", "voice-plan-feedback/notes.md"),
  ]);

  expect(paths).toEqual(["app/voice-plan-feedback/notes.md"]);
  expect(indexedPathByTreePath.has("app/voice-plan-feedback")).toBe(false);
  expect(indexedPathByTreePath.get("app/voice-plan-feedback/notes.md")).toEqual(
    expect.objectContaining({ kind: "file", relativePath: "voice-plan-feedback/notes.md" }),
  );
});

test("file panel resolves relative paths without escaping the selected root", () => {
  expect(resolveFilePanelPath(roots, { rootId: "root_b", relativePath: "src/index.ts" })).toEqual({
    absolutePath: "/workspace/packages/app/src/index.ts",
    root: roots[1],
  });

  expect(() => resolveFilePanelPath(roots, { rootId: "root_b", relativePath: "../secrets.txt" })).toThrow(
    "outside the workspace root",
  );
  expect(() => resolveFilePanelPath(roots, { rootId: "root_missing", relativePath: "README.md" })).toThrow(
    "Workspace root not found",
  );
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

test("file panel decodes text and rejects binary or oversized content", () => {
  expect(decodeFileContent(btoa("hello\nworld"), { maxBytes: 1024 })).toEqual({
    status: "text",
    text: "hello\nworld",
    bytes: 11,
  });
  expect(decodeFileContent(btoa("hello\u0000world"), { maxBytes: 1024 })).toEqual({
    status: "binary",
    bytes: 11,
  });
  expect(decodeFileContent(btoa("hello"), { maxBytes: 2 })).toEqual({
    status: "too-large",
    bytes: 5,
  });
});

test("file panel detects syntax languages from common file paths", () => {
  expect(languageForFilePath("src/components/file-panel.tsx")).toBe("tsx");
  expect(languageForFilePath("package.json")).toBe("json");
  expect(languageForFilePath(".env.example")).toBe("dotenv");
  expect(languageForFilePath("unknown.custom-extension")).toBe("text");
});

test("file panel highlights text with the same Pierre themes as diffs", async () => {
  const highlighted = await highlightFileContent("src/file.ts", 'const value: number = "<script>";\n');

  expect(highlighted.language).toBe("typescript");
  expect(highlighted.html).toContain("pierre-light");
  expect(highlighted.html).toContain("pierre-dark-soft");
  expect(highlighted.html).toContain("--shiki-light");
  expect(highlighted.html).toContain("--shiki-dark");
  expect(highlighted.html).toContain("&#x3C;script>");
  expect(highlighted.html).not.toContain('"<script>"');
});

test("file panel renders unavailable and empty workspace states", async () => {
  expect(await renderPanel({ roots, appServerMethods: [] })).toContain("Files unavailable");
  expect(await renderPanel({ roots: [], appServerMethods: ["fs/readDirectory", "fs/readFile"] })).toContain(
    "No workspace",
  );
});

function indexedPath(
  rootId: string,
  relativePath: string,
  kind: FilePanelIndexedPath["kind"] = "file",
): FilePanelIndexedPath {
  return { rootId, relativePath, kind };
}

function readDirectoryResult(entries: FileSystemReadDirectoryResult["entries"]): FileSystemReadDirectoryResult {
  return { entries };
}

function directoryEntry(fileName: string): FileSystemReadDirectoryResult["entries"][number] {
  return { fileName, isDirectory: true, isFile: false };
}

function fileEntry(fileName: string): FileSystemReadDirectoryResult["entries"][number] {
  return { fileName, isDirectory: false, isFile: true };
}

async function renderPanel({
  roots,
  appServerMethods,
}: {
  roots: WorkspaceRoot[];
  appServerMethods: string[];
}): Promise<string> {
  globalThis.window = {
    roderDesktop: {
      request: async () => ({ entries: [] }),
      onNotification: () => () => undefined,
      onStderr: () => () => undefined,
    },
  };
  const { FilePanel } = await import("../src/components/file-panel");
  return renderToStaticMarkup(
    React.createElement(FilePanel, {
      roots,
      selectedRootId: roots[0]?.id ?? "",
      appServerMethods,
    }),
  );
}

import { expect, test } from "vitest";
import {
  decodeFileContent,
  decodeWorkspaceFileContent,
  filePanelDefaultMarkdownViewMode,
  filePanelMarkdownToggleLabel,
  filePanelSupportsMarkdownPreview,
  nextFilePanelMarkdownViewMode,
} from "../src/lib/file-panel";
import { highlightFileContent, languageForFilePath } from "../src/lib/file-syntax-highlight";
import { workspaceFileEntry } from "./file-panel-fixtures";

test("file panel recognizes plain markdown preview files", () => {
  expect(filePanelSupportsMarkdownPreview("README.md")).toBe(true);
  expect(filePanelSupportsMarkdownPreview("docs/guide.markdown")).toBe(true);
  expect(filePanelSupportsMarkdownPreview("docs/CHANGELOG.MD")).toBe(true);
  expect(filePanelSupportsMarkdownPreview("src/page.mdx")).toBe(false);
  expect(filePanelSupportsMarkdownPreview("src/readme.txt")).toBe(false);
});

test("file panel derives markdown preview modes and toggle labels", () => {
  expect(filePanelDefaultMarkdownViewMode("README.md")).toBe("preview");
  expect(filePanelDefaultMarkdownViewMode("src/page.mdx")).toBe("source");
  expect(nextFilePanelMarkdownViewMode("preview")).toBe("source");
  expect(nextFilePanelMarkdownViewMode("source")).toBe("preview");
  expect(filePanelMarkdownToggleLabel("preview")).toBe("Show markdown source");
  expect(filePanelMarkdownToggleLabel("source")).toBe("Show markdown preview");
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

test("file panel decodes bounded workspace file previews", () => {
  const entry = workspaceFileEntry({ path: "README.md", name: "README.md", kind: "file", hasChildren: false });
  expect(
    decodeWorkspaceFileContent(
      {
        entry,
        encoding: "utf8",
        text: "hello",
        offset: 0,
        limit: 1024,
        totalBytes: 5,
        hasMore: false,
        truncated: false,
      },
      { maxBytes: 1024 },
    ),
  ).toEqual({ status: "text", text: "hello", bytes: 5 });
  expect(
    decodeWorkspaceFileContent(
      {
        entry,
        encoding: "binary",
        offset: 0,
        limit: 1024,
        totalBytes: 5,
        hasMore: false,
        truncated: false,
      },
      { maxBytes: 1024 },
    ),
  ).toEqual({ status: "binary", bytes: 5 });
  expect(
    decodeWorkspaceFileContent(
      {
        entry,
        encoding: "utf8",
        text: "hello",
        offset: 0,
        limit: 5,
        totalBytes: 900,
        hasMore: true,
        truncated: true,
      },
      { maxBytes: 1024 },
    ),
  ).toEqual({ status: "text", text: "hello", bytes: 900, truncated: true });
  expect(
    decodeWorkspaceFileContent(
      {
        entry,
        encoding: "utf8",
        text: "hello",
        offset: 0,
        limit: 5,
        totalBytes: 5,
        hasMore: false,
        truncated: false,
      },
      { maxBytes: 2 },
    ),
  ).toEqual({ status: "too-large", bytes: 5 });
  expect(
    decodeWorkspaceFileContent(
      {
        entry,
        encoding: "utf8",
        text: "hello",
        offset: 0,
        limit: 5,
        totalBytes: 2_000,
        hasMore: true,
        truncated: true,
      },
      { maxBytes: 1024 },
    ),
  ).toEqual({ status: "too-large", bytes: 2000 });
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

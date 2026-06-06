import { expect, test } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { roots, workspaceFileMethods } from "./file-panel-fixtures";
import type { WorkspaceRoot } from "../src/types/roder";

test("file panel renders unavailable and empty workspace states", async () => {
  expect(await renderPanel({ roots, appServerMethods: [] })).toContain("Files unavailable");
  expect(await renderPanel({ roots: [], appServerMethods: workspaceFileMethods })).toContain("No workspace");
});

test("file panel renders an initial loading state while indexing workspace files", async () => {
  expect(await renderPanel({ roots, appServerMethods: workspaceFileMethods })).toContain("Loading files");
});

test("file panel renders safe markdown preview content", async () => {
  const { FileMarkdownPreview } = await import("../src/components/file-panel");
  const html = renderToStaticMarkup(
    React.createElement(FileMarkdownPreview, {
      text: [
        "# Title",
        "",
        "[Docs](https://example.com/docs)",
        "[Relative](/docs)",
        "[Mail](mailto:test@example.com)",
        "[File](file:///etc/passwd)",
        "[Script](javascript:alert('bad'))",
        "",
        "- One",
        "- Two",
        "",
        "| Key | Value |",
        "| --- | --- |",
        "| A | B |",
        "",
        "```ts",
        "const value = 1;",
        "```",
        "",
        "![hidden](https://example.com/image.png)",
        "",
        '<script>alert("bad")</script>',
      ].join("\n"),
    }),
  );

  expect(html).toContain("file-markdown-preview");
  expect(html).toContain("Title");
  expect(html).toContain('href="https://example.com/docs"');
  expect(html).toContain('target="_blank"');
  expect(html).toContain('rel="noreferrer noopener"');
  expect(html).toContain("<li");
  expect(html).toContain("<table");
  expect(html).toContain("const value = 1");
  expect(html).not.toContain("<img");
  expect(html).not.toContain("image.png");
  expect(html).not.toContain('href="/docs"');
  expect(html).not.toContain("mailto:test@example.com");
  expect(html).not.toContain("file:///etc/passwd");
  expect(html).not.toContain("javascript:");
  expect(html).not.toContain("<script");
  expect(html).toContain("&lt;script&gt;alert(&quot;bad&quot;)&lt;/script&gt;");
});

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
      workspaceId: "ws_1",
      roots,
      selectedRootId: roots[0]?.id ?? "",
      appServerMethods,
    }),
  );
}

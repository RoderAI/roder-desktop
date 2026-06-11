import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { FilePanelSearchLauncherResult } from "../src/lib/file-panel";
import { roots } from "./file-panel-fixtures";

test("file search command renders the documented command structure", async () => {
  const html = await renderCommand({ state: "idle" });

  expect(html).toContain('role="combobox"');
  expect(html).toContain('role="listbox"');
  expect(html).toContain('data-slot="command"');
  expect(html).toContain('data-slot="command-input"');
  expect(html).toContain('data-slot="command-list"');
  expect(html).toContain("aria-expanded");
  expect(html).toContain("Search files and folders");
  expect(html).toContain("Type to search files and folders.");
});

test("file search command renders file and folder results", async () => {
  const html = await renderCommand({
    state: "ready",
    results: [result("src/index.ts", "file"), result("src/components", "directory")],
  });

  expect(html).toContain('role="group"');
  expect(html).toContain('role="option"');
  expect(html).toContain("index.ts");
  expect(html).toContain("src/index.ts");
  expect(html).toContain("components");
  expect(html).toContain('data-slot="command-item"');
  expect(html).toContain('aria-label="File: index.ts"');
  expect(html).toContain('aria-label="Folder: components"');
});

test("file search command renders unavailable and error states", async () => {
  expect(await renderCommand({ state: "unavailable" })).toContain("Workspace files are unavailable.");
  expect(await renderCommand({ state: "error", message: "Index failed" })).toContain("Index failed");
});

test("file search display status preserves results while the dialog closes", async () => {
  const { fileSearchDisplayStatus } = await import("../src/components/file-search-dialog");
  const status = { state: "ready", results: [result("src/index.ts", "file")] } as const;

  expect(
    fileSearchDisplayStatus({
      filesystemAvailable: true,
      workspaceId: "workspace_a",
      roots,
      status,
    }),
  ).toBe(status);
});

async function renderCommand(status: {
  state: string;
  results?: FilePanelSearchLauncherResult[];
  message?: string;
}): Promise<string> {
  globalThis.window = {
    roderDesktop: {
      request: async () => ({ matches: [] }),
      onNotification: () => () => undefined,
      onStderr: () => () => undefined,
    },
  };
  const { FileSearchCommandContent } = await import("../src/components/file-search-dialog");
  return renderToStaticMarkup(
    React.createElement(FileSearchCommandContent, {
      query: "",
      status: status as React.ComponentProps<typeof FileSearchCommandContent>["status"],
      onQueryChange() {},
      onSelect() {},
    }),
  );
}

function result(relativePath: string, kind: "file" | "directory"): FilePanelSearchLauncherResult {
  const title = relativePath.split("/").at(-1) ?? relativePath;
  return {
    key: `root_a\u0000${relativePath}`,
    title,
    subtitle: `app/${relativePath}`,
    rootLabel: "app",
    indexedPath: { rootId: "root_a", relativePath, kind, hasChildren: kind === "directory" },
  };
}

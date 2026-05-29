import { expect, test } from "vitest";
import { getSidebarExtensions, selectedSidebarExtensionId } from "../src/lib/extension-sidebar";

function extensionRecord(id, contributes) {
  return {
    id,
    manifest: {
      contributes: {
        commands: [],
        tools: [],
        themes: [],
        views: { panels: [] },
        ...contributes,
      },
    },
  };
}

test("filters theme-only extensions out of sidebar contributions", async () => {
  const extensions = [
    extensionRecord("theme-only", {
      themes: [{ id: "aurora-dark", label: "Aurora Dark", scheme: "dark", path: "themes/dark.json" }],
    }),
    extensionRecord("html-panel", {
      views: { panels: [{ id: "event-log.panel", title: "Event Log", html: "assets/panel.html" }] },
    }),
    extensionRecord("command-only", {
      commands: [{ id: "hello.sayHello", title: "Say Hello" }],
    }),
    extensionRecord("tool-only", {
      tools: [{ id: "hello.echo", title: "Echo", description: "Echo text", inputSchema: { type: "object" } }],
    }),
    extensionRecord("metadata-only-panel", {
      views: { panels: [{ id: "missing-html", title: "No HTML" }] },
    }),
  ];

  expect(getSidebarExtensions(extensions).map((extension) => extension.id)).toEqual([
    "html-panel",
    "command-only",
    "tool-only",
  ]);
});

test("selects the requested sidebar extension or falls back to the first available extension", () => {
  const extensions = [
    extensionRecord("theme-only", {
      themes: [{ id: "aurora-dark", label: "Aurora Dark", scheme: "dark", path: "themes/dark.json" }],
    }),
    extensionRecord("first-sidebar", {
      commands: [{ id: "first.command", title: "First" }],
    }),
    extensionRecord("second-sidebar", {
      commands: [{ id: "second.command", title: "Second" }],
    }),
  ];

  expect(selectedSidebarExtensionId(extensions, "second-sidebar")).toBe("second-sidebar");
  expect(selectedSidebarExtensionId(extensions, "theme-only")).toBe("first-sidebar");
  expect(selectedSidebarExtensionId(extensions, null)).toBe("first-sidebar");
  expect(selectedSidebarExtensionId([], "missing")).toBeNull();
});

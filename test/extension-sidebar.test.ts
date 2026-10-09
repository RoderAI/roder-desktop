import { expect, test } from "vitest";
import { getSidebarExtensions, selectedSidebarExtensionId } from "../src/lib/extension-sidebar";

function extensionRecord(id, contributes, { enabled = true } = {}) {
  return {
    id,
    enabled,
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

test("hides disabled extensions from the sidebar even when they contribute panels, commands, or tools", () => {
  const extensions = [
    extensionRecord(
      "event-log",
      { views: { panels: [{ id: "event-log.panel", title: "Event Log", html: "assets/panel.html" }] } },
      { enabled: false },
    ),
    extensionRecord("aurora-theme", { commands: [{ id: "aurora.apply", title: "Apply" }] }, { enabled: false }),
    extensionRecord("hello", { commands: [{ id: "hello.sayHello", title: "Say Hello" }] }),
  ];

  expect(getSidebarExtensions(extensions).map((extension) => extension.id)).toEqual(["hello"]);
  expect(selectedSidebarExtensionId(extensions, "event-log")).toBe("hello");
  expect(selectedSidebarExtensionId(extensions.slice(0, 2), null)).toBeNull();
});

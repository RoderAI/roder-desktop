import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { RightWorkspacePanelShell, type RightWorkspacePanelEntry } from "../src/components/right-workspace-panel-shell";

const entries: RightWorkspacePanelEntry[] = [
  {
    id: "terminal",
    title: "Terminal",
    description: "Command output",
    icon: React.createElement("span", null, "T"),
    shortcutLabel: "Cmd+`",
  },
  {
    id: "browser",
    title: "Browser",
    description: "Local preview",
    icon: React.createElement("span", null, "B"),
  },
  {
    id: "review",
    title: "Review",
    description: "Changed files",
    icon: React.createElement("span", null, "R"),
  },
  {
    id: "files",
    title: "Files",
    description: "Browse workspace",
    icon: React.createElement("span", null, "F"),
  },
];

test("right workspace panel shell renders an empty selection state", () => {
  const html = renderShell({ tabs: [], activePanel: null });

  expect(html).toContain("Workspace panels");
  expect(html).toContain("Terminal");
  expect(html).toContain("Browser");
  expect(html).toContain("Review");
  expect(html).toContain("Files");
  expect(html).toContain("Add workspace panel");
});

test("right workspace panel shell renders opened panel tabs and makes inactive panel content inert", () => {
  const html = renderShell({ tabs: ["terminal", "browser"], activePanel: "browser" });

  expect(html).toContain('role="tablist"');
  expect(html).toContain('aria-selected="true"');
  expect(html).toContain("Close Terminal");
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain("inert=");
  expect(html).toContain("Panel content: terminal");
  expect(html).toContain("Panel content: browser");
});

test("right workspace panel shell header can drag the native window without stealing tab controls", () => {
  const html = renderShell({ tabs: ["files"], activePanel: "files" });

  expect(html).toContain("drag-region");
  expect(html).toContain("no-drag");
  expect(html).toContain('aria-label="Add workspace panel"');
  expect(html).toContain('aria-label="Files"');
});

test("right workspace panel shell does not pre-render unopened choices as tabs", () => {
  const html = renderShell({ tabs: ["browser"], activePanel: "browser" });

  expect(html).not.toContain('aria-label="Terminal"');
  expect(html).toContain('aria-label="Browser"');
  expect(html).not.toContain('aria-label="Review"');
});

test("right workspace panel shell stays mounted but inert when closed", () => {
  const html = renderShell({ open: false, tabs: ["terminal"], activePanel: "terminal" });

  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain("inert=");
  expect(html).not.toContain('data-open="true"');
  expect(html).not.toContain("--right-workspace-panel-width");
});

test("right workspace panel shell can freeze layout width while its parent animates", () => {
  const html = renderShell({
    tabs: ["browser"],
    activePanel: "browser",
    freezeLayout: true,
    layoutWidth: 720,
  });

  expect(html).toContain('data-layout-frozen="true"');
  expect(html).toContain("width:720px");
  expect(html).toContain("min-width:720px");
});

function renderShell({
  open = true,
  tabs,
  activePanel,
  freezeLayout,
  layoutWidth,
}: Pick<
  React.ComponentProps<typeof RightWorkspacePanelShell>,
  "tabs" | "activePanel" | "freezeLayout" | "layoutWidth"
> & {
  open?: boolean;
}): string {
  return renderToStaticMarkup(
    React.createElement(RightWorkspacePanelShell, {
      open,
      tabs,
      activePanel,
      entries,
      freezeLayout,
      layoutWidth,
      onAddPanel: () => {},
      onClosePanel: () => {},
      onSelectPanel: () => {},
      renderPanel: (entry) => React.createElement("div", null, `Panel content: ${entry.id}`),
    }),
  );
}

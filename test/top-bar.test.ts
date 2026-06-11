import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { TopBar } from "../src/components/top-bar";

test("content top bar keeps the workspace panel button at the window edge when the extension sidebar is visible", () => {
  const html = renderTopBar({ extensionSidebarVisible: true });

  expect(html).toContain("right-2");
  expect(html).not.toContain("right-14");
});

test("content top bar moves the workspace panel button to the window edge without the extension sidebar", () => {
  const html = renderTopBar({ extensionSidebarVisible: false });

  expect(html).toContain("right-2");
  expect(html).toContain("z-[100]");
  expect(html).not.toContain("right-14");
});

test("content top bar hides the workspace panel toggle when the panel cannot fit", () => {
  const html = renderTopBar({ extensionSidebarVisible: false, workspacePanelToggleVisible: false });

  expect(html).not.toContain("Show workspace panel");
  expect(html).not.toContain("right-2");
});

test("content top bar keeps the sidebar toggle in the same position when toggled", () => {
  const openHtml = renderTopBar({ extensionSidebarVisible: false, sidebarOpen: true });
  const closedHtml = renderTopBar({ extensionSidebarVisible: false, sidebarOpen: false });

  expect(openHtml).toContain("fixed left-20 top-[11px]");
  expect(closedHtml).toContain("fixed left-20 top-[11px]");
});

function renderTopBar({
  extensionSidebarVisible,
  sidebarOpen = false,
  workspacePanelToggleVisible = true,
}: {
  extensionSidebarVisible: boolean;
  sidebarOpen?: boolean;
  workspacePanelToggleVisible?: boolean;
}): string {
  return renderToStaticMarkup(
    React.createElement(TopBar, {
      threads: [],
      folders: [],
      activeFolderPath: "/Users/pz/project",
      status: { state: "ready", binary: "roder" },
      workspacePanelOpen: false,
      workspacePanelToggleVisible,
      extensionSidebarVisible,
      sidebarOpen,
      placement: "content",
      onNewProject: () => {},
      onNewThread: () => {},
      onOpenSettings: () => {},
      onRestart: () => {},
      onToggleSidebar: () => {},
      onSelectFolder: () => {},
      onSelectThread: () => {},
      onToggleWorkspacePanelShell: () => {},
    }),
  );
}

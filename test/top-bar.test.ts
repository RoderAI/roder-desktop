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
  expect(html).not.toContain("right-14");
});

function renderTopBar({ extensionSidebarVisible }: { extensionSidebarVisible: boolean }): string {
  return renderToStaticMarkup(
    React.createElement(TopBar, {
      threads: [],
      folders: [],
      activeFolderPath: "/Users/pz/project",
      status: { state: "ready", binary: "roder" },
      workspacePanelOpen: false,
      extensionSidebarVisible,
      sidebarOpen: false,
      placement: "content",
      onNewProject: () => {},
      onNewThread: () => {},
      onOpenSettings: () => {},
      onRestart: () => {},
      onToggleSidebar: () => {},
      onSelectFolder: () => {},
      onSelectThread: () => {},
      onCloseWorkspacePanelShell: () => {},
      onOpenWorkspacePanelShell: () => {},
    }),
  );
}

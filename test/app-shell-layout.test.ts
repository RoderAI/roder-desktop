import { expect, test } from "vitest";
import {
  canShowWorkspacePanelForGroupWidth,
  clampSidebarWidth,
  mainPanelMinWidth,
  nativeWindowMinWidth,
  shouldRenderWorkspacePanel,
  sidebarWidthBounds,
} from "../src/lib/app-shell-layout";

test("workspace panel fits only when the group can hold the readable main column and the panel", () => {
  const workspacePanelMinWidth = 360;
  const fittedWidth = mainPanelMinWidth + workspacePanelMinWidth;

  expect(canShowWorkspacePanelForGroupWidth({ groupWidth: fittedWidth, workspacePanelMinWidth })).toBe(true);
  expect(canShowWorkspacePanelForGroupWidth({ groupWidth: fittedWidth - 1, workspacePanelMinWidth })).toBe(false);
});

test("workspace panel fit does not depend on the sidebar (it is outside the group)", () => {
  const workspacePanelMinWidth = 360;
  // The same group width fits the workspace panel regardless of how wide the sidebar is, because the
  // sidebar occupies space outside the group rather than inside it.
  expect(
    canShowWorkspacePanelForGroupWidth({ groupWidth: mainPanelMinWidth + workspacePanelMinWidth, workspacePanelMinWidth }),
  ).toBe(true);
});

test("workspace panel chrome is visible only for non-plugin routes with an open workspace panel", () => {
  expect(shouldRenderWorkspacePanel({ isPluginsRoute: false, workspacePanelOpen: true })).toBe(true);
  expect(shouldRenderWorkspacePanel({ isPluginsRoute: false, workspacePanelOpen: false })).toBe(false);
  expect(shouldRenderWorkspacePanel({ isPluginsRoute: true, workspacePanelOpen: true })).toBe(false);
});

test("sidebar width clamps to its resize bounds", () => {
  expect(clampSidebarWidth(sidebarWidthBounds.min - 50)).toBe(sidebarWidthBounds.min);
  expect(clampSidebarWidth(sidebarWidthBounds.max + 50)).toBe(sidebarWidthBounds.max);
  expect(clampSidebarWidth(300)).toBe(300);
  expect(clampSidebarWidth(Number.NaN)).toBe(sidebarWidthBounds.defaultValue);
});

test("native window minimum width reserves the chrome beside the main column plus the readable main", () => {
  // chromeWidth is everything outside the main column (sidebar + handle + extension rail), measured
  // as window width minus group width. The optional workspace panel is in the group, so it is never
  // included here and yields first.
  expect(nativeWindowMinWidth({ chromeWidth: sidebarWidthBounds.defaultValue })).toBe(
    sidebarWidthBounds.defaultValue + mainPanelMinWidth,
  );
  expect(nativeWindowMinWidth({ chromeWidth: 0 })).toBe(mainPanelMinWidth);
  expect(nativeWindowMinWidth({ chromeWidth: -50 })).toBe(mainPanelMinWidth);
});

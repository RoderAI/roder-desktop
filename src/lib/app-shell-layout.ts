export const mainPanelMinWidth = 320;

export const sidebarWidthBounds = {
  min: 220,
  defaultValue: 274,
  max: 420,
} as const;

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return sidebarWidthBounds.defaultValue;
  }
  return Math.min(sidebarWidthBounds.max, Math.max(sidebarWidthBounds.min, Math.round(width)));
}

export function shouldRenderWorkspacePanel({
  isPluginsRoute,
  workspacePanelOpen,
}: {
  isPluginsRoute: boolean;
  workspacePanelOpen: boolean;
}): boolean {
  return !isPluginsRoute && workspacePanelOpen;
}

/**
 * The workspace panel shares the resizable group with the main column, so it can show only when the
 * group is wide enough for the readable main column plus the workspace panel minimum. The left
 * sidebar lives outside the group (a fixed flex item), so it is intentionally not part of this
 * calculation — the group width already reflects whatever space the sidebar is occupying.
 */
export function canShowWorkspacePanelForGroupWidth({
  groupWidth,
  mainMinWidth = mainPanelMinWidth,
  workspacePanelMinWidth,
}: {
  groupWidth: number;
  mainMinWidth?: number;
  workspacePanelMinWidth: number;
}): boolean {
  return Number.isFinite(groupWidth) && groupWidth >= mainMinWidth + workspacePanelMinWidth;
}

export function workspacePanelMaxOpenWidthForGroup({
  groupWidth,
  mainMinWidth = mainPanelMinWidth,
  workspacePanelMinWidth,
  workspacePanelMaxWidth,
}: {
  groupWidth: number | null;
  mainMinWidth?: number;
  workspacePanelMinWidth: number;
  workspacePanelMaxWidth: number;
}): number {
  if (groupWidth === null || !Number.isFinite(groupWidth)) {
    return workspacePanelMaxWidth;
  }

  const availableWidth = Math.round(groupWidth) - mainMinWidth;
  return Math.min(workspacePanelMaxWidth, Math.max(workspacePanelMinWidth, availableWidth));
}

/**
 * The native window minimum width keeps the readable main column visible alongside whatever
 * horizontal chrome sits outside it (the left sidebar at its current width, its resize handle, and
 * the extension activity rail). The optional right workspace panel lives inside the resizable group
 * and is never reserved, so it yields first when horizontal space is constrained.
 *
 * `chromeWidth` is the measured width of everything to the sides of the main column/group.
 */
export function nativeWindowMinWidth({
  chromeWidth,
  mainMinWidth = mainPanelMinWidth,
}: {
  chromeWidth: number;
  mainMinWidth?: number;
}): number {
  return Math.round(Math.max(0, chromeWidth) + mainMinWidth);
}

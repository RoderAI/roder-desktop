// Mirrors the layout constants in src/lib/app-shell-layout.ts. Kept as plain literals here so the
// Electron main bundle stays free of renderer imports; window-options.test.ts asserts they agree.
export const mainPanelMinWidth = 320;
const sidebarDefaultWidth = 274;
export const mainWindowMinWidth = sidebarDefaultWidth + mainPanelMinWidth;
export const mainWindowMinHeight = 680;

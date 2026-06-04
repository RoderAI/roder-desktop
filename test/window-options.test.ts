import { expect, test } from "vitest";
import { mainWindowMinWidth } from "../electron/main/window-options";
import { mainPanelMinWidth, sidebarWidthBounds } from "../src/lib/app-shell-layout";

test("native window minimum fits the default sidebar and readable transcript", () => {
  expect(mainWindowMinWidth).toBe(sidebarWidthBounds.defaultValue + mainPanelMinWidth);
});

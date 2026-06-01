import { expect, test } from "vitest";
import { parseTerminalThemeJson, terminalThemeForSettings } from "../src/lib/terminal-theme";

test("default terminal theme uses a truecolour palette", () => {
  const theme = terminalThemeForSettings({ presetId: "catppuccin-mocha", customJson: "" });

  expect(theme.background).toBe("#1e1e2e");
  expect(theme.foreground).toBe("#cdd6f4");
  expect(theme.brightBlue).toBe("#89b4fa");
});

test("custom terminal theme JSON accepts xterm theme colours", () => {
  const result = parseTerminalThemeJson(
    JSON.stringify({
      background: "#000000",
      foreground: "#ffffff",
      brightGreen: "#00ff00",
      ignored: "nope",
    }),
  );

  expect(result.error).toBeNull();
  expect(result.theme).toEqual({ background: "#000000", foreground: "#ffffff", brightGreen: "#00ff00" });
});

test("custom terminal theme falls back when JSON is invalid", () => {
  const theme = terminalThemeForSettings({ presetId: "custom", customJson: "{" });

  expect(theme.background).toBe("#1e1e2e");
});

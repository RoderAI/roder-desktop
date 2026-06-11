import { expect, test } from "vitest";
import { themeVariables } from "../src/hooks/use-theme-application";
import { defaultThemeSettings } from "../src/stores/theme-store";

test("light theme runtime border matches the light desktop chrome border", () => {
  const variables = themeVariables(
    defaultThemeSettings.light,
    "light",
    defaultThemeSettings.uiFontSize,
    defaultThemeSettings.codeFontSize,
  );

  expect(variables["--color-border"]).toBe("#eeeeee");
});

test("dark theme keeps stronger runtime borders", () => {
  const variables = themeVariables(
    defaultThemeSettings.dark,
    "dark",
    defaultThemeSettings.uiFontSize,
    defaultThemeSettings.codeFontSize,
  );

  expect(variables["--color-border"]).toBe("#474747");
});

test("runtime popover surfaces follow the active theme", () => {
  const lightVariables = themeVariables(
    defaultThemeSettings.light,
    "light",
    defaultThemeSettings.uiFontSize,
    defaultThemeSettings.codeFontSize,
  );
  const darkVariables = themeVariables(
    defaultThemeSettings.dark,
    "dark",
    defaultThemeSettings.uiFontSize,
    defaultThemeSettings.codeFontSize,
  );

  expect(lightVariables["--color-popover"]).toBe(lightVariables["--color-card"]);
  expect(lightVariables["--color-popover-foreground"]).toBe(lightVariables["--color-foreground"]);
  expect(darkVariables["--color-popover"]).toBe(darkVariables["--color-card"]);
  expect(darkVariables["--color-popover-foreground"]).toBe(darkVariables["--color-foreground"]);
  expect(darkVariables["--color-popover"]).not.toBe("#ffffff");
});

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

test("runtime popover surfaces stay white in both schemes", () => {
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

  expect(lightVariables["--color-popover"]).toBe("#ffffff");
  expect(lightVariables["--color-popover-foreground"]).toBe("#242424");
  expect(darkVariables["--color-popover"]).toBe("#ffffff");
  expect(darkVariables["--color-popover-foreground"]).toBe("#242424");
});

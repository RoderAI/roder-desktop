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

test("compact defaults keep conversation text readable and secondary interface text smaller", () => {
  const variables = themeVariables(
    defaultThemeSettings.light,
    "light",
    defaultThemeSettings.uiFontSize,
    defaultThemeSettings.codeFontSize,
  );

  expect(variables).toMatchObject({
    "--font-size-ui": "13px",
    "--font-size-small": "12px",
    "--font-size-caption": "11px",
    "--font-size-reading": "14px",
    "--font-size-composer": "15px",
    "--font-size-code": "13px",
  });
});

test("custom interface font sizes scale reading, composer, and secondary typography together", () => {
  expect(themeVariables(defaultThemeSettings.light, "light", 17, 15)).toMatchObject({
    "--font-size-ui": "17px",
    "--font-size-small": "16px",
    "--font-size-caption": "15px",
    "--font-size-reading": "18px",
    "--font-size-composer": "19px",
    "--font-size-code": "15px",
  });
});

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { readExtensionTheme } from "../electron/extensions/theme";

function extensionRecord(themePath = "themes/aurora-dark.json") {
  const packageRoot = mkdtempSync(join(tmpdir(), "roder-theme-extension-"));
  mkdirSync(join(packageRoot, "themes"), { recursive: true });
  writeFileSync(
    join(packageRoot, "themes", "aurora-dark.json"),
    JSON.stringify(
      {
        name: "Aurora Dark",
        scheme: "dark",
        colors: {
          accent: "#7dd3fc",
          background: "#111827",
          foreground: "#e5edf7",
          sidebar: "#0b1220",
        },
        translucentSidebar: true,
        contrast: 54,
        uiFont: "Geist, sans-serif",
        codeFont: "Menlo, monospace",
      },
      null,
      2,
    ),
  );
  return {
    id: "roder.aurora-theme-extension",
    source: { type: "dev", path: packageRoot },
    manifest: {
      contributes: {
        themes: [{ id: "aurora-dark", label: "Aurora Dark", scheme: "dark", path: themePath }],
      },
    },
  };
}

test("reads and validates extension theme definitions", async () => {
  const theme = await readExtensionTheme(extensionRecord(), "aurora-dark");

  expect(theme.id).toBe("aurora-dark");
  expect(theme.extensionId).toBe("roder.aurora-theme-extension");
  expect(theme.scheme).toBe("dark");
  expect(theme.colors.background).toBe("#111827");
  expect(theme.uiFont).toBe("Geist, sans-serif");
});

test("rejects extension themes outside the package root", async () => {
  await expect(() => readExtensionTheme(extensionRecord("../escape.json"), "aurora-dark")).rejects.toThrow(
    /outside the extension package/,
  );
});

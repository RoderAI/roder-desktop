import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import ts from "typescript";

async function loadThemeModule() {
  const directory = join(process.cwd(), "node_modules", ".cache");
  mkdirSync(directory, { recursive: true });
  const moduleDirectory = mkdtempSync(join(directory, "roder-extension-theme-"));
  const source = readFileSync(new URL("../electron/extensions/theme.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  });
  const path = join(moduleDirectory, "theme.mjs");
  writeFileSync(path, output.outputText);
  return import(`${path}?t=${Date.now()}`);
}

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
  const { readExtensionTheme } = await loadThemeModule();
  const theme = await readExtensionTheme(extensionRecord(), "aurora-dark");

  assert.equal(theme.id, "aurora-dark");
  assert.equal(theme.extensionId, "roder.aurora-theme-extension");
  assert.equal(theme.scheme, "dark");
  assert.equal(theme.colors.background, "#111827");
  assert.equal(theme.uiFont, "Geist, sans-serif");
});

test("rejects extension themes outside the package root", async () => {
  const { readExtensionTheme } = await loadThemeModule();
  await assert.rejects(() => readExtensionTheme(extensionRecord("../escape.json"), "aurora-dark"), /outside the extension package/);
});

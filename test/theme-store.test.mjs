import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import ts from "typescript";

async function loadThemeStoreModule() {
  const directory = join(process.cwd(), "node_modules", ".cache");
  mkdirSync(directory, { recursive: true });
  const moduleDirectory = mkdtempSync(join(directory, "roder-theme-store-"));
  const source = readFileSync(new URL("../src/stores/theme-store.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  });
  const path = join(moduleDirectory, "theme-store.mjs");
  writeFileSync(path, output.outputText);
  return import(`${path}?t=${Date.now()}`);
}

test("selected extension theme labels survive before presets reload", async () => {
  const { selectedPresetLabel } = await loadThemeStoreModule();
  const palette = {
    presetId: "roder.aurora-theme-extension:aurora-dark",
    presetName: "Aurora Dark",
    accent: "#7dd3fc",
    background: "#111827",
    foreground: "#e5edf7",
    sidebar: "#0b1220",
    translucentSidebar: true,
    contrast: 54,
    uiFont: "Geist, sans-serif",
    codeFont: "Menlo, monospace",
  };

  assert.equal(selectedPresetLabel("dark", palette, []), "Aurora Dark");
});

test("loaded extension theme labels replace stale persisted labels", async () => {
  const { selectedPresetLabel } = await loadThemeStoreModule();
  const palette = {
    presetId: "roder.aurora-theme-extension:aurora-dark",
    presetName: "Old Aurora",
    accent: "#7dd3fc",
    background: "#111827",
    foreground: "#e5edf7",
    sidebar: "#0b1220",
    translucentSidebar: true,
    contrast: 54,
    uiFont: "Geist, sans-serif",
    codeFont: "Menlo, monospace",
  };
  const extensionPresets = [
    {
      id: "roder.aurora-theme-extension:aurora-dark",
      name: "Aurora Dark",
      scheme: "dark",
      palette,
    },
  ];

  assert.equal(selectedPresetLabel("dark", palette, extensionPresets), "Aurora Dark");
});

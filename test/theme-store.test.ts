import { expect, test } from "vitest";
import { selectedPresetLabel } from "../src/stores/theme-store";

test("selected extension theme labels survive before presets reload", async () => {
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

  expect(selectedPresetLabel("dark", palette, [])).toBe("Aurora Dark");
});

test("loaded extension theme labels replace stale persisted labels", async () => {
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

  expect(selectedPresetLabel("dark", palette, extensionPresets)).toBe("Aurora Dark");
});

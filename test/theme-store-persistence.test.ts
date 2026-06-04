import { expect, test, vi } from "vitest";

async function loadThemeStore() {
  vi.resetModules();
  return import("../src/stores/theme-store");
}

function installStorageMock() {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  };
  globalThis.window = { localStorage: globalThis.localStorage };
  return values;
}

test("theme store does not persist route-owned settings navigation", async () => {
  const storage = installStorageMock();
  const { useThemeStore } = await loadThemeStore();

  useThemeStore.getState().setMode("dark");

  const persisted = JSON.parse(storage.get("roder-desktop-theme"));
  expect(persisted.state).not.toHaveProperty("settingsOpen");
  expect(persisted.state).not.toHaveProperty("settingsSection");
  expect(useThemeStore.getState()).not.toHaveProperty("openSettings");
  expect(useThemeStore.getState()).not.toHaveProperty("closeSettings");
  expect(useThemeStore.getState()).not.toHaveProperty("setSettingsSection");
});

test("theme store migrates the old default code font size", async () => {
  const storage = installStorageMock();
  storage.set(
    "roder-desktop-theme",
    JSON.stringify({
      state: { settings: legacyThemeSettings(13) },
      version: 1,
    }),
  );

  const { defaultThemeSettings, useThemeStore } = await loadThemeStore();

  expect(useThemeStore.getState().settings.codeFontSize).toBe(defaultThemeSettings.codeFontSize);
});

test("theme store adds the default terminal theme to older persisted settings", async () => {
  const storage = installStorageMock();
  storage.set(
    "roder-desktop-theme",
    JSON.stringify({
      state: { settings: legacyThemeSettings(14) },
      version: 2,
    }),
  );

  const { defaultThemeSettings, useThemeStore } = await loadThemeStore();

  expect(useThemeStore.getState().settings.terminalTheme).toEqual(defaultThemeSettings.terminalTheme);
});

test("theme store migrates old default ui font size to the smaller desktop default", async () => {
  const storage = installStorageMock();
  storage.set(
    "roder-desktop-theme",
    JSON.stringify({
      state: { settings: legacyThemeSettings(14) },
      version: 3,
    }),
  );

  const { defaultThemeSettings, useThemeStore } = await loadThemeStore();

  expect(useThemeStore.getState().settings.uiFontSize).toBe(defaultThemeSettings.uiFontSize);
  expect(useThemeStore.getState().settings.codeFontSize).toBe(defaultThemeSettings.codeFontSize);
});

test("theme store migrates the previous default code font size", async () => {
  const storage = installStorageMock();
  storage.set(
    "roder-desktop-theme",
    JSON.stringify({
      state: { settings: legacyThemeSettings(14) },
      version: 4,
    }),
  );

  const { defaultThemeSettings, useThemeStore } = await loadThemeStore();

  expect(useThemeStore.getState().settings.codeFontSize).toBe(defaultThemeSettings.codeFontSize);
});

test("theme store preserves custom font sizes during compact density migration", async () => {
  const storage = installStorageMock();
  const settings = {
    ...legacyThemeSettings(15),
    uiFontSize: 17,
  };
  storage.set(
    "roder-desktop-theme",
    JSON.stringify({
      state: { settings },
      version: 3,
    }),
  );

  const { useThemeStore } = await loadThemeStore();

  expect(useThemeStore.getState().settings.uiFontSize).toBe(17);
  expect(useThemeStore.getState().settings.codeFontSize).toBe(15);
});

function legacyThemeSettings(codeFontSize: number) {
  return {
    mode: "system",
    light: legacyPalette("roder-light", "#ffffff", "#242424", "#fbfbfb"),
    dark: legacyPalette("roder-dark", "#141414", "#e0e0e0", "#202020"),
    pointerCursors: false,
    uiFontSize: 18,
    codeFontSize,
  };
}

function legacyPalette(presetId: string, background: string, foreground: string, sidebar: string) {
  return {
    presetId,
    accent: foreground,
    background,
    foreground,
    sidebar,
    translucentSidebar: false,
    contrast: 48,
    uiFont: "Geist, sans-serif",
    codeFont: "Menlo, monospace",
  };
}

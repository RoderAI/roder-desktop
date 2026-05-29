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

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

test("theme store persists the active settings page through reloads", async () => {
  const storage = installStorageMock();
  const { useThemeStore } = await loadThemeStore();

  useThemeStore.getState().openSettings("components");

  const persisted = JSON.parse(storage.get("roder-desktop-theme"));
  expect(persisted.state.settingsOpen).toBe(true);
  expect(persisted.state.settingsSection).toBe("components");
});

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import ts from "typescript";

async function loadThemeStore() {
  const source = readFileSync(new URL("../src/stores/theme-store.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const directory = new URL(".tmp/", import.meta.url);
  mkdirSync(directory, { recursive: true });
  const path = join(directory.pathname, `theme-store-${Date.now()}.mjs`);
  writeFileSync(path, output.outputText);

  const module = await import(`${path}?t=${Date.now()}`);
  rmSync(directory, { recursive: true, force: true });
  return module;
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
  assert.equal(persisted.state.settingsOpen, true);
  assert.equal(persisted.state.settingsSection, "components");
});

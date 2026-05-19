import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const helperSource = readFileSync(new URL("../electron/main/shortcuts.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2023,
  },
}).outputText;

const module = { exports: {} };
new Script(compiled).runInNewContext({ exports: module.exports, module });
const { createApplicationMenuTemplate, isNewThreadShortcutInput } = module.exports;

function input(overrides = {}) {
  return {
    type: "keyDown",
    key: "n",
    code: "KeyN",
    isAutoRepeat: false,
    isComposing: false,
    shift: false,
    control: false,
    alt: false,
    meta: false,
    ...overrides,
  };
}

test("recognizes Command+N as the new thread shortcut on macOS", () => {
  assert.equal(isNewThreadShortcutInput(input({ meta: true }), "darwin"), true);
  assert.equal(isNewThreadShortcutInput(input({ control: true }), "darwin"), false);
});

test("recognizes Control+N as the new thread shortcut off macOS", () => {
  assert.equal(isNewThreadShortcutInput(input({ control: true }), "linux"), true);
  assert.equal(isNewThreadShortcutInput(input({ meta: true }), "linux"), false);
});

test("ignores repeat, composing, modified, and key-up shortcut events", () => {
  assert.equal(isNewThreadShortcutInput(input({ meta: true, isAutoRepeat: true }), "darwin"), false);
  assert.equal(isNewThreadShortcutInput(input({ meta: true, isComposing: true }), "darwin"), false);
  assert.equal(isNewThreadShortcutInput(input({ meta: true, shift: true }), "darwin"), false);
  assert.equal(isNewThreadShortcutInput(input({ meta: true, alt: true }), "darwin"), false);
  assert.equal(isNewThreadShortcutInput(input({ meta: true, type: "keyUp" }), "darwin"), false);
});

test("application menu exposes CommandOrControl+N for new threads", () => {
  const commands = [];
  const template = createApplicationMenuTemplate((command) => commands.push(command), "darwin");
  const fileMenu = template.find((item) => item.label === "File");
  const newThreadItem = fileMenu.submenu.find((item) => item.id === "new-thread");

  assert.equal(newThreadItem.label, "New Agent");
  assert.equal(newThreadItem.accelerator, "CommandOrControl+N");

  newThreadItem.click();

  assert.deepEqual(commands, ["newThread"]);
});

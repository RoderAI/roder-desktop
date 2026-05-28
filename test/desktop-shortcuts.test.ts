import { expect, test } from "vitest";
import {
  createApplicationMenuTemplate,
  isNewProjectShortcutInput,
  isNewThreadShortcutInput,
} from "../electron/main/shortcuts";

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
  expect(isNewThreadShortcutInput(input({ meta: true }), "darwin")).toBe(true);
  expect(isNewThreadShortcutInput(input({ control: true }), "darwin")).toBe(false);
});

test("recognizes Control+N as the new thread shortcut off macOS", () => {
  expect(isNewThreadShortcutInput(input({ control: true }), "linux")).toBe(true);
  expect(isNewThreadShortcutInput(input({ meta: true }), "linux")).toBe(false);
});

test("recognizes Command+O as the new project shortcut on macOS", () => {
  expect(isNewProjectShortcutInput(input({ key: "o", code: "KeyO", meta: true }), "darwin")).toBe(true);
  expect(isNewProjectShortcutInput(input({ key: "o", code: "KeyO", control: true }), "darwin")).toBe(false);
});

test("recognizes Control+O as the new project shortcut off macOS", () => {
  expect(isNewProjectShortcutInput(input({ key: "o", code: "KeyO", control: true }), "linux")).toBe(true);
  expect(isNewProjectShortcutInput(input({ key: "o", code: "KeyO", meta: true }), "linux")).toBe(false);
});

test("ignores repeat, composing, modified, and key-up shortcut events", () => {
  expect(isNewThreadShortcutInput(input({ meta: true, isAutoRepeat: true }), "darwin")).toBe(false);
  expect(isNewThreadShortcutInput(input({ meta: true, isComposing: true }), "darwin")).toBe(false);
  expect(isNewThreadShortcutInput(input({ meta: true, shift: true }), "darwin")).toBe(false);
  expect(isNewThreadShortcutInput(input({ meta: true, alt: true }), "darwin")).toBe(false);
  expect(isNewThreadShortcutInput(input({ meta: true, type: "keyUp" }), "darwin")).toBe(false);
});

test("application menu exposes CommandOrControl+N for new threads", () => {
  const commands = [];
  const template = createApplicationMenuTemplate((command) => commands.push(command), "darwin");
  const fileMenu = template.find((item) => item.label === "File");
  const newThreadItem = fileMenu.submenu.find((item) => item.id === "new-thread");

  expect(newThreadItem.label).toBe("New Agent");
  expect(newThreadItem.accelerator).toBe("CommandOrControl+N");

  newThreadItem.click();

  expect(commands).toEqual(["newThread"]);
});

test("application menu exposes CommandOrControl+O for new projects", () => {
  const commands = [];
  const template = createApplicationMenuTemplate((command) => commands.push(command), "darwin");
  const fileMenu = template.find((item) => item.label === "File");
  const newProjectItem = fileMenu.submenu.find((item) => item.id === "new-project");

  expect(newProjectItem.label).toBe("Add Project...");
  expect(newProjectItem.accelerator).toBe("CommandOrControl+O");

  newProjectItem.click();

  expect(commands).toEqual(["newProject"]);
});

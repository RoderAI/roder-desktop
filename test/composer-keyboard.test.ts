import { expect, test } from "vitest";
import { isComposerSubmitKey, isPlanModeToggleKey } from "../src/lib/composer-keyboard";

test("submits only on non-composing enter without shift", () => {
  expect(isComposerSubmitKey({ key: "Enter", shiftKey: false })).toBe(true);
  expect(isComposerSubmitKey({ key: "Enter", shiftKey: true })).toBe(false);
  expect(isComposerSubmitKey({ key: "a", shiftKey: false })).toBe(false);
  expect(isComposerSubmitKey({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
  expect(isComposerSubmitKey({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: true } })).toBe(false);
});

test("shift tab toggles plan mode", () => {
  expect(isPlanModeToggleKey({ key: "Tab", shiftKey: true })).toBe(true);
  expect(isPlanModeToggleKey({ key: "Tab", shiftKey: false })).toBe(false);
  expect(isPlanModeToggleKey({ key: "Enter", shiftKey: true })).toBe(false);
});

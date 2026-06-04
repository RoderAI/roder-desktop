import { expect, test } from "vitest";
import { terminalShellArgs } from "../electron/terminal/pty-manager";

test("starts common unix shells as login shells so profile PATH is loaded", () => {
  expect(terminalShellArgs("/bin/zsh", "darwin")).toEqual(["-l"]);
  expect(terminalShellArgs("/opt/homebrew/bin/bash", "darwin")).toEqual(["-l"]);
  expect(terminalShellArgs("/usr/local/bin/fish", "darwin")).toEqual(["--login"]);
});

test("does not add unix login flags for Windows shells", () => {
  expect(terminalShellArgs("powershell.exe", "win32")).toEqual([]);
});

test("leaves unknown shells unchanged", () => {
  expect(terminalShellArgs("/usr/local/bin/custom-shell", "darwin")).toEqual([]);
});

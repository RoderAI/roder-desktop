import { expect, test } from "vitest";
import { terminalEnvironment, terminalOverrides, terminalShellArgs } from "../electron/terminal/pty-manager";

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

test("advertises direct truecolour support to shells and tmux", () => {
  const env = terminalEnvironment({ PATH: "/bin" });

  expect(env.PATH).toBe("/bin");
  expect(env.TERM).toBe("xterm-direct");
  expect(env.COLORTERM).toBe("truecolor");
  expect(env.TERM_PROGRAM).toBe("roder-desktop");
  expect(env.TMUX_RGB).toBe("1");
  expect(env.TMUX_TERMINAL_OVERRIDES).toBe("xterm-direct:Tc");
});

test("preserves existing tmux terminal overrides", () => {
  expect(terminalOverrides("alacritty:Tc,screen-256color:RGB")).toBe("alacritty:Tc,screen-256color:RGB,xterm-direct:Tc");
  expect(terminalOverrides("xterm-direct:Tc")).toBe("xterm-direct:Tc");
});

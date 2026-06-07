import { EventEmitter } from "node:events";
import os from "node:os";
import { createRequire } from "node:module";
import type { IPty } from "node-pty";

const require = createRequire(import.meta.url);
const nodePty = require("node-pty") as typeof import("node-pty");
const terminalName = "xterm-direct";

export type TerminalSnapshot = {
  id: string;
  pid: number;
};

type TerminalSession = {
  id: string;
  pty: IPty;
};

export class TerminalManager extends EventEmitter {
  #session: TerminalSession | null = null;

  start(options: { cwd?: string; cols?: number; rows?: number } = {}): TerminalSnapshot {
    if (this.#session) {
      return { id: this.#session.id, pid: this.#session.pty.pid };
    }

    const shell = process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "zsh");
    const term = nodePty.spawn(shell, terminalShellArgs(shell, process.platform), {
      name: terminalName,
      cols: options.cols ?? 96,
      rows: options.rows ?? 28,
      cwd: options.cwd || process.cwd(),
      env: terminalEnvironment(),
    });
    const id = "primary";
    this.#session = { id, pty: term };

    term.onData((data) => {
      this.emit("data", { id, data });
    });
    term.onExit(({ exitCode, signal }) => {
      this.emit("exit", { id, exitCode, signal });
      this.#session = null;
    });

    if (process.platform !== "win32" && os.platform() === "darwin") {
      term.write("clear\r");
    }

    return { id, pid: term.pid };
  }

  write(data: string): void {
    this.#session?.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    if (!this.#session || cols <= 0 || rows <= 0) {
      return;
    }
    this.#session.pty.resize(cols, rows);
  }

  stop(): void {
    if (!this.#session) {
      return;
    }
    this.#session.pty.kill();
    this.#session = null;
  }
}

export function terminalEnvironment(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    TERM: terminalName,
    TERM_PROGRAM: "roder-desktop",
    COLORTERM: "truecolor",
    TMUX_RGB: "1",
    TMUX_TERMINAL_OVERRIDES: terminalOverrides(baseEnv.TMUX_TERMINAL_OVERRIDES),
  };
}

export function terminalOverrides(existing?: string): string {
  const truecolorOverride = `${terminalName}:Tc`;
  if (!existing?.trim()) {
    return truecolorOverride;
  }
  return existing.split(",").includes(truecolorOverride) ? existing : `${existing},${truecolorOverride}`;
}

export function terminalShellArgs(shell: string, platform: NodeJS.Platform = process.platform): string[] {
  if (platform === "win32") {
    return [];
  }
  const shellName = shell.split(/[\\/]/).pop() ?? shell;
  if (shellName === "bash" || shellName === "zsh") {
    return ["-l"];
  }
  if (shellName === "fish") {
    return ["--login"];
  }
  return [];
}

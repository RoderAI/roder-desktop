import { EventEmitter } from "node:events";
import os from "node:os";
import { createRequire } from "node:module";
import type { IPty } from "node-pty";

const require = createRequire(__filename);
const nodePty = require("node-pty") as typeof import("node-pty");
const terminalName = "xterm-direct";
const defaultSessionId = "primary";
const maxActiveSessions = 6;

export type TerminalSnapshot = {
  id: string;
  pid: number;
  remote?: boolean;
};

export type TerminalStartOptions = {
  id?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  remoteWorkspaceId?: string;
  forceRestart?: boolean;
};

export type RemoteTerminalHandle = EventEmitter & {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
};

export type RemoteTerminalStarter = (options: {
  id: string;
  remoteWorkspaceId: string;
  cols: number;
  rows: number;
}) => Promise<RemoteTerminalHandle>;

type ManagedSession = {
  id: string;
  pid: number;
  remote: boolean;
  lastUsedAt: number;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
};

export class TerminalManager extends EventEmitter {
  #sessions = new Map<string, ManagedSession>();
  #activeId = defaultSessionId;
  #remoteStarter?: RemoteTerminalStarter;

  constructor(options: { startRemoteTerminal?: RemoteTerminalStarter } = {}) {
    super();
    this.#remoteStarter = options.startRemoteTerminal;
  }

  async start(options: TerminalStartOptions = {}): Promise<TerminalSnapshot> {
    const id = options.id?.trim() || defaultSessionId;
    const cols = options.cols ?? 96;
    const rows = options.rows ?? 28;
    this.#activeId = id;

    const existing = this.#sessions.get(id);
    if (existing && !options.forceRestart) {
      existing.lastUsedAt = Date.now();
      existing.resize(cols, rows);
      return { id: existing.id, pid: existing.pid, remote: existing.remote };
    }
    if (existing && options.forceRestart) {
      this.#sessions.delete(id);
      existing.kill();
    }

    this.#evictOverflow();

    if (options.remoteWorkspaceId) {
      if (!this.#remoteStarter) {
        throw new Error("Remote terminals are not configured.");
      }
      const handle = await this.#remoteStarter({
        id,
        remoteWorkspaceId: options.remoteWorkspaceId,
        cols,
        rows,
      });
      const session: ManagedSession = {
        id,
        pid: 0,
        remote: true,
        lastUsedAt: Date.now(),
        write: (data) => handle.write(data),
        resize: (nextCols, nextRows) => handle.resize(nextCols, nextRows),
        kill: () => handle.kill(),
      };
      this.#sessions.set(id, session);
      handle.on("data", (data: string) => {
        if (this.#sessions.get(id) === session) {
          this.emit("data", { id, data });
        }
      });
      handle.on("exit", ({ exitCode, signal }: { exitCode: number; signal?: number }) => {
        if (this.#sessions.get(id) === session) {
          this.#sessions.delete(id);
          this.emit("exit", { id, exitCode, signal });
        }
      });
      return { id, pid: 0, remote: true };
    }

    const shell = process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "zsh");
    const term: IPty = nodePty.spawn(shell, terminalShellArgs(shell, process.platform), {
      name: terminalName,
      cols,
      rows,
      cwd: options.cwd || process.cwd(),
      env: terminalEnvironment(),
    });
    const session: ManagedSession = {
      id,
      pid: term.pid,
      remote: false,
      lastUsedAt: Date.now(),
      write: (data) => term.write(data),
      resize: (nextCols, nextRows) => {
        if (nextCols > 0 && nextRows > 0) {
          term.resize(nextCols, nextRows);
        }
      },
      kill: () => term.kill(),
    };
    this.#sessions.set(id, session);

    term.onData((data) => {
      if (this.#sessions.get(id) === session) {
        this.emit("data", { id, data });
      }
    });
    term.onExit(({ exitCode, signal }) => {
      if (this.#sessions.get(id) === session) {
        this.#sessions.delete(id);
        this.emit("exit", { id, exitCode, signal });
      }
    });

    if (process.platform !== "win32" && os.platform() === "darwin") {
      term.write("clear\r");
    }

    return { id, pid: term.pid, remote: false };
  }

  write(data: string, id?: string): void {
    const session = this.#sessionFor(id);
    if (!session) return;
    session.lastUsedAt = Date.now();
    session.write(data);
  }

  resize(cols: number, rows: number, id?: string): void {
    const session = this.#sessionFor(id);
    if (!session || cols <= 0 || rows <= 0) {
      return;
    }
    session.lastUsedAt = Date.now();
    session.resize(cols, rows);
  }

  stop(id?: string): void {
    if (id) {
      const session = this.#sessions.get(id);
      if (!session) return;
      this.#sessions.delete(id);
      session.kill();
      return;
    }
    for (const session of this.#sessions.values()) {
      session.kill();
    }
    this.#sessions.clear();
  }

  #sessionFor(id?: string): ManagedSession | undefined {
    return this.#sessions.get(id?.trim() || this.#activeId);
  }

  #evictOverflow(): void {
    while (this.#sessions.size >= maxActiveSessions) {
      let oldest: ManagedSession | null = null;
      for (const candidate of this.#sessions.values()) {
        if (!oldest || candidate.lastUsedAt < oldest.lastUsedAt) {
          oldest = candidate;
        }
      }
      if (!oldest) break;
      this.#sessions.delete(oldest.id);
      oldest.kill();
    }
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

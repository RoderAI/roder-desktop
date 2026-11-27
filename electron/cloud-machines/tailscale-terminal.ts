import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import type { IPty } from "node-pty";
import { terminalEnvironment } from "../terminal/pty-manager";
import { buildTailscaleSshArgs, shellQuotePosixSsh, type SshConnectionTarget } from "./tailscale-ssh";

const require = createRequire(__filename);
const nodePty = require("node-pty") as typeof import("node-pty");

export type TailscaleTerminalOptions = {
  peer: SshConnectionTarget;
  workingDir: string;
  cols: number;
  rows: number;
  sshBinary?: string;
};

export class TailscaleSshTerminalSession extends EventEmitter {
  private readonly pty: IPty;
  private closed = false;

  constructor(options: TailscaleTerminalOptions) {
    super();
    const remoteCommand = `cd ${shellQuotePosixSsh(options.workingDir)} 2>/dev/null || true; exec "\${SHELL:-/bin/sh}" -l`;
    const args = buildTailscaleSshArgs(options.peer, {
      interactiveTty: true,
      remoteCommand,
    });
    this.pty = nodePty.spawn(options.sshBinary ?? "ssh", args, {
      name: "xterm-256color",
      cols: Math.max(10, Math.round(options.cols)),
      rows: Math.max(4, Math.round(options.rows)),
      env: {
        ...terminalEnvironment(),
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      },
    });
    this.pty.onData((data) => {
      if (!this.closed) {
        this.emit("data", data);
      }
    });
    this.pty.onExit(({ exitCode, signal }) => {
      if (!this.closed) {
        this.closed = true;
        this.emit("exit", { exitCode, signal });
      }
    });
  }

  write(data: string): void {
    if (this.closed) return;
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.closed || cols <= 0 || rows <= 0) return;
    this.pty.resize(Math.round(cols), Math.round(rows));
  }

  kill(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.pty.kill();
    } catch {
      // ignore
    }
  }
}

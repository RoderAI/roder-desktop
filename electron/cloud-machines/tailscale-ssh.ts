import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SshMachineTargetConfig } from "./ssh-config";
import type { TailscalePeerConfig } from "./tailscale";

export type SshConnectionTarget = Pick<
  SshMachineTargetConfig,
  "host" | "sshUser" | "sshPort" | "identityFile" | "proxyJump"
> &
  Partial<Pick<TailscalePeerConfig, "tailscaleIp" | "dnsName" | "remoteRoderPort">>;

export type TailscaleSshExecResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
};

export type TailscaleSshRunnerOptions = {
  sshBinary?: string;
  controlDir?: string;
  enableControlMaster?: boolean;
};

export type ActiveSshPortForward = {
  localPort: number;
  remotePort: number;
  close: () => void;
};

export function shellQuotePosixSsh(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

export function buildTailscaleSshDestination(peer: Pick<SshConnectionTarget, "host" | "sshUser">): string {
  return peer.sshUser ? `${peer.sshUser}@${peer.host}` : peer.host;
}

export function buildTailscaleSshArgs(
  peer: SshConnectionTarget,
  options: {
    controlPath?: string;
    disableControlMaster?: boolean;
    interactiveTty?: boolean;
    connectTimeoutSeconds?: number;
    localForward?: { localPort: number; remoteHost?: string; remotePort: number };
    noRemoteCommand?: boolean;
    remoteCommand?: string;
  } = {},
): string[] {
  const args: string[] = [];
  if (options.interactiveTty) {
    args.push("-tt");
  } else {
    args.push("-T", "-o", "BatchMode=yes");
  }
  if (options.noRemoteCommand) {
    args.push("-N");
  }
  args.push(
    "-o",
    `ConnectTimeout=${options.connectTimeoutSeconds ?? 10}`,
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
    "-o",
    "StrictHostKeyChecking=accept-new",
  );
  if (options.localForward) {
    args.push(
      "-o",
      "ExitOnForwardFailure=yes",
      "-L",
      `127.0.0.1:${options.localForward.localPort}:${options.localForward.remoteHost ?? "127.0.0.1"}:${options.localForward.remotePort}`,
    );
  }
  if (options.disableControlMaster) {
    args.push("-o", "ControlMaster=no", "-o", "ControlPath=none");
  } else if (options.controlPath) {
    args.push("-o", "ControlMaster=auto", "-o", "ControlPersist=120", "-o", `ControlPath=${options.controlPath}`);
  }
  if (peer.identityFile) {
    args.push("-i", peer.identityFile, "-o", "IdentitiesOnly=yes");
  }
  if (peer.proxyJump) {
    args.push("-J", peer.proxyJump);
  }
  if (peer.sshPort && peer.sshPort !== 22) {
    args.push("-p", String(peer.sshPort));
  }
  args.push("--", buildTailscaleSshDestination(peer));
  if (options.remoteCommand !== undefined) {
    args.push(options.remoteCommand);
  }
  return args;
}

async function allocateFreeLoopbackPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => {
        if (!port) reject(new Error("Could not allocate a free loopback port."));
        else resolve(port);
      });
    });
  });
}

async function waitForLoopbackTcp(port: number, timeoutMs = 10_000): Promise<boolean> {
  const { connect } = await import("node:net");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = connect({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

const MAX_SOCKET_PATH = 104;

export class TailscaleSshClient {
  private readonly sshBinary: string;
  private readonly controlDir: string;
  private readonly enableControlMaster: boolean;
  private readonly activeProcesses = new Map<string, ChildProcessWithoutNullStreams>();
  private readonly cancelledCommands = new Set<string>();
  private readonly portForwards = new Map<string, ActiveSshPortForward>();
  private readonly extraControlDirs = new Set<string>();

  constructor(options: TailscaleSshRunnerOptions = {}) {
    this.sshBinary = options.sshBinary ?? "ssh";
    // Keep Unix socket path compact (< 104 bytes on macOS even under /var/folders/.../T).
    this.controlDir = options.controlDir ?? join(tmpdir(), `rts-${process.pid}`);
    this.enableControlMaster = options.enableControlMaster ?? process.platform !== "win32";
  }

  controlPathFor(peer: SshConnectionTarget): string | undefined {
    if (!this.enableControlMaster) return undefined;
    const hash = createHash("sha256")
      .update(`${peer.sshUser ?? ""}@${peer.host}:${peer.sshPort}:${peer.identityFile ?? ""}:${peer.proxyJump ?? ""}`)
      .digest("hex")
      .slice(0, 12);
    // Unix socket paths are capped at 104 bytes on macOS; fall back to a short /tmp dir when needed.
    let dir = this.controlDir;
    if (join(dir, `c-${hash}`).length >= MAX_SOCKET_PATH && process.platform !== "win32") {
      dir = join("/tmp", `rts-${process.getuid?.() ?? 0}-${process.pid}`);
    }
    const socketPath = join(dir, `c-${hash}`);
    if (socketPath.length >= MAX_SOCKET_PATH) return undefined;
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch {
      return undefined;
    }
    if (dir !== this.controlDir) this.extraControlDirs.add(dir);
    return socketPath;
  }

  async openLocalForward(
    peer: SshConnectionTarget,
    remotePort: number,
    options: { remoteHost?: string; timeoutMs?: number } = {},
  ): Promise<ActiveSshPortForward> {
    const key = `${peer.sshUser ?? ""}@${peer.host}:${peer.sshPort}:${peer.identityFile ?? ""}:${peer.proxyJump ?? ""}->${options.remoteHost ?? "127.0.0.1"}:${remotePort}`;
    const existing = this.portForwards.get(key);
    if (existing) {
      const alive = await waitForLoopbackTcp(existing.localPort, 400);
      if (alive) return existing;
      existing.close();
      this.portForwards.delete(key);
    }

    const localPort = await allocateFreeLoopbackPort();
    const args = buildTailscaleSshArgs(peer, {
      disableControlMaster: true,
      interactiveTty: false,
      noRemoteCommand: true,
      localForward: { localPort, remoteHost: options.remoteHost ?? "127.0.0.1", remotePort },
    });

    const child = spawn(this.sshBinary, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let exited = false;
    let exitCode: number | null = null;
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += chunk.toString("utf8");
    });
    child.once("close", (code) => {
      exited = true;
      exitCode = code;
      if (this.portForwards.get(key)?.localPort === localPort) {
        this.portForwards.delete(key);
      }
    });

    const timeoutMs = options.timeoutMs ?? 12_000;
    const deadline = Date.now() + timeoutMs;
    let ready = false;
    while (Date.now() < deadline && !exited) {
      if (await waitForLoopbackTcp(localPort, 250)) {
        ready = true;
        break;
      }
    }

    if (!ready || exited) {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
      throw new Error(
        stderr.trim() ||
          `Could not open SSH tunnel to ${peer.host}:${remotePort}${exitCode !== null ? ` (exit ${exitCode})` : ""}.`,
      );
    }

    const handle: ActiveSshPortForward = {
      localPort,
      remotePort,
      close: () => {
        if (this.portForwards.get(key) === handle) {
          this.portForwards.delete(key);
        }
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
      },
    };
    this.portForwards.set(key, handle);
    return handle;
  }

  async execCommand(
    peer: SshConnectionTarget,
    remoteCommand: string,
    options: {
      stdin?: Buffer | string;
      timeoutMs?: number;
      commandId?: string;
      maxBytes?: number;
    } = {},
  ): Promise<TailscaleSshExecResult> {
    const args = buildTailscaleSshArgs(peer, {
      controlPath: this.controlPathFor(peer),
      interactiveTty: false,
      remoteCommand,
    });
    const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
    const timeoutMs = options.timeoutMs ?? 60_000;

    return new Promise<TailscaleSshExecResult>((resolve, reject) => {
      const child = spawn(this.sshBinary, args, {
        stdio: ["pipe", "pipe", "pipe"],
      });
      if (options.commandId) {
        this.activeProcesses.set(options.commandId, child);
      }

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutLen = 0;
      let stderrLen = 0;
      let timedOut = false;
      let settled = false;

      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true;
              child.kill("SIGTERM");
              setTimeout(() => child.kill("SIGKILL"), 2_000).unref?.();
            }, timeoutMs)
          : null;
      timer?.unref?.();

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (options.commandId) {
          this.activeProcesses.delete(options.commandId);
        }
      };

      child.stdout.on("data", (chunk: Buffer) => {
        if (stdoutLen < maxBytes) {
          const remaining = maxBytes - stdoutLen;
          stdoutChunks.push(chunk.length > remaining ? chunk.subarray(0, remaining) : chunk);
          stdoutLen += chunk.length;
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (stderrLen < maxBytes) {
          const remaining = maxBytes - stderrLen;
          stderrChunks.push(chunk.length > remaining ? chunk.subarray(0, remaining) : chunk);
          stderrLen += chunk.length;
        }
      });

      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        cleanup();
        const cancelled = Boolean(options.commandId && this.cancelledCommands.delete(options.commandId));
        resolve({
          exitCode: code,
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          timedOut,
          cancelled,
        });
      });

      if (options.stdin !== undefined) {
        child.stdin.end(options.stdin);
      } else {
        child.stdin.end();
      }
    });
  }

  async execCommandBinary(
    peer: SshConnectionTarget,
    remoteCommand: string,
    options: { stdin?: Buffer; timeoutMs?: number; maxBytes?: number } = {},
  ): Promise<{ exitCode: number | null; stdout: Buffer; stderr: string }> {
    const args = buildTailscaleSshArgs(peer, {
      controlPath: this.controlPathFor(peer),
      interactiveTty: false,
      remoteCommand,
    });
    const maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
    const timeoutMs = options.timeoutMs ?? 60_000;

    return new Promise((resolve, reject) => {
      const child = spawn(this.sshBinary, args, {
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutLen = 0;
      let settled = false;

      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              child.kill("SIGTERM");
            }, timeoutMs)
          : null;
      timer?.unref?.();

      child.stdout.on("data", (chunk: Buffer) => {
        if (stdoutLen < maxBytes) {
          const remaining = maxBytes - stdoutLen;
          stdoutChunks.push(chunk.length > remaining ? chunk.subarray(0, remaining) : chunk);
          stdoutLen += chunk.length;
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve({
          exitCode: code,
          stdout: Buffer.concat(stdoutChunks),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
        });
      });

      if (options.stdin !== undefined) {
        child.stdin.end(options.stdin);
      } else {
        child.stdin.end();
      }
    });
  }

  async readFile(peer: SshConnectionTarget, absPath: string): Promise<Buffer> {
    const result = await this.execCommandBinary(peer, `cat -- ${shellQuotePosixSsh(absPath)}`, {
      timeoutMs: 30_000,
    });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `Could not read remote file "${absPath}".`);
    }
    return result.stdout;
  }

  async writeFile(peer: SshConnectionTarget, absPath: string, contents: Buffer): Promise<void> {
    const script = `mkdir -p -- "$(dirname -- ${shellQuotePosixSsh(absPath)})" && cat > ${shellQuotePosixSsh(absPath)}`;
    const result = await this.execCommandBinary(peer, `sh -c ${shellQuotePosixSsh(script)}`, {
      stdin: contents,
      timeoutMs: 30_000,
    });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `Could not write remote file "${absPath}".`);
    }
  }

  cancelCommand(commandId: string): boolean {
    const child = this.activeProcesses.get(commandId);
    if (!child) return false;
    this.cancelledCommands.add(commandId);
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 2_000).unref?.();
    return true;
  }

  closeAll(): void {
    for (const forward of this.portForwards.values()) {
      forward.close();
    }
    this.portForwards.clear();
    for (const child of this.activeProcesses.values()) {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
    this.activeProcesses.clear();
    this.cancelledCommands.clear();
    try {
      rmSync(this.controlDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    for (const dir of this.extraControlDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    this.extraControlDirs.clear();
  }
}

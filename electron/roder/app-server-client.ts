import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { app } from "electron";

export type RoderStatus = {
  state: "starting" | "ready" | "stopped" | "error";
  binary: string;
  cwd?: string;
  message?: string;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

type JsonRpcMessage = {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type SpawnTarget = {
  command: string;
  args: string[];
  cwd?: string;
  label: string;
};

type DesktopNotification = {
  method: string;
  params: unknown;
};

const thisDir = dirname(fileURLToPath(import.meta.url));

export class RoderAppServerClient extends EventEmitter {
  #child: ChildProcessWithoutNullStreams | null = null;
  #buffer = "";
  #nextId = 1;
  #pending = new Map<number | string, PendingRequest>();
  #startPromise: Promise<RoderStatus> | null = null;
  #status: RoderStatus = {
    state: "stopped",
    binary: "unresolved",
  };

  status(): RoderStatus {
    return this.#status;
  }

  async start(): Promise<RoderStatus> {
    if (this.#child && this.#status.state === "ready") {
      return this.#status;
    }
    if (this.#startPromise) {
      return this.#startPromise;
    }

    this.#startPromise = this.#startProcess();
    try {
      return await this.#startPromise;
    } finally {
      this.#startPromise = null;
    }
  }

  async #startProcess(): Promise<RoderStatus> {
    const target = this.#resolveSpawnTarget();
    this.#setStatus({ state: "starting", binary: target.label, cwd: target.cwd });

    this.#child = spawn(target.command, target.args, {
      cwd: target.cwd,
      env: {
        ...process.env,
        RODER_DESKTOP: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.#child.stdout.setEncoding("utf8");
    this.#child.stderr.setEncoding("utf8");
    this.#child.stdout.on("data", (chunk: string) => this.#handleStdout(chunk));
    this.#child.stderr.on("data", (chunk: string) => {
      this.emit("stderr", chunk);
      if (this.#status.state !== "ready") {
        this.#setStatus({
          ...this.#status,
          message: chunk.trim().slice(0, 240),
        });
      }
    });
    this.#child.once("exit", (code, signal) => {
      const message = signal ? `roder exited with signal ${signal}` : `roder exited with code ${code ?? 0}`;
      this.#rejectAll(new Error(message));
      this.#child = null;
      this.#setStatus({ state: "stopped", binary: target.label, cwd: target.cwd, message });
    });
    this.#child.once("error", (error) => {
      this.#rejectAll(error);
      this.#child = null;
      this.#setStatus({ state: "error", binary: target.label, cwd: target.cwd, message: error.message });
    });

    await this.#rawRequest("initialize", {
      clientInfo: {
        name: "roder-desktop",
        title: "Roder Desktop",
        version: app.getVersion(),
      },
      capabilities: {
        experimentalApi: true,
      },
    });

    this.#setStatus({ state: "ready", binary: target.label, cwd: target.cwd });
    return this.#status;
  }

  async stop(): Promise<void> {
    if (!this.#child) {
      return;
    }
    const child = this.#child;
    this.#child = null;
    child.kill();
    this.#rejectAll(new Error("roder app-server stopped"));
    this.#setStatus({ state: "stopped", binary: this.#status.binary, cwd: this.#status.cwd });
  }

  async restart(): Promise<RoderStatus> {
    await this.stop();
    return this.start();
  }

  async request(method: string, params: unknown = {}): Promise<unknown> {
    return this.#rawRequest(method, params);
  }

  async #rawRequest(method: string, params: unknown = {}): Promise<unknown> {
    if (!this.#child && method !== "initialize") {
      await this.start();
    }
    if (!this.#child) {
      throw new Error("roder app-server is not running");
    }

    const id = this.#nextId++;
    const message = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#child?.stdin.write(`${message}\n`, (error) => {
        if (!error) {
          return;
        }
        this.#pending.delete(id);
        reject(error);
      });
    });
  }

  #handleStdout(chunk: string): void {
    this.#buffer += chunk;
    for (;;) {
      const newline = this.#buffer.indexOf("\n");
      if (newline === -1) {
        return;
      }
      const line = this.#buffer.slice(0, newline).trim();
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line) {
        this.#handleLine(line);
      }
    }
  }

  #handleLine(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch (error) {
      this.emit("stderr", `Invalid roder app-server JSON: ${(error as Error).message}`);
      return;
    }

    if (message.id !== undefined) {
      const pending = this.#pending.get(message.id);
      if (!pending) {
        return;
      }
      this.#pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      for (const notification of desktopNotificationsFromMessage(message.method, message.params)) {
        this.emit("notification", notification);
      }
    }
  }

  #resolveSpawnTarget(): SpawnTarget {
    const binaryName = process.platform === "win32" ? "roder.exe" : "roder";
    const packaged = join(process.resourcesPath, "bin", binaryName);
    if (app.isPackaged && existsSync(packaged)) {
      return {
        command: packaged,
        args: ["app-server", "--listen", "stdio://"],
        cwd: process.cwd(),
        label: packaged,
      };
    }

    const bundled = resolve(thisDir, "..", "..", "resources", "bin", binaryName);
    if (existsSync(bundled)) {
      return {
        command: bundled,
        args: ["app-server", "--listen", "stdio://"],
        cwd: process.cwd(),
        label: bundled,
      };
    }

    throw new Error(`Could not find embedded roder binary at ${app.isPackaged ? packaged : bundled}. Run pnpm bundle:roder before launching the desktop app.`);
  }

  #setStatus(status: RoderStatus): void {
    this.#status = status;
    this.emit("status", status);
  }

  #rejectAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

function desktopNotificationsFromMessage(method: string, params: unknown): DesktopNotification[] {
  if (method === "event") {
    return [];
  }
  return [{ method, params: params ?? {} }];
}

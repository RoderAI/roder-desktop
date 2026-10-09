import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from "node:child_process";
import { app } from "electron";

export type RoderStatus = {
  state: "starting" | "ready" | "stopped" | "error";
  binary: string;
  appServerMethods?: string[];
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
const schemaProbeTimeoutMs = 5_000;

// Deadlines for short-latency engine methods. Methods not listed here have no
// deadline, because some (for example thread/compact) legitimately run for minutes.
const requestTimeoutsMs = new Map<string, number>([
  ["initialize", 30_000],
  ["thread/start", 60_000],
  ["turn/start", 60_000],
  ["model/list", 60_000],
  ["providers/list", 60_000],
  ["model/select", 60_000],
  ["thread/list", 60_000],
  ["thread/read", 60_000],
  ["skills/list", 60_000],
  ["settings/get", 60_000],
]);

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
    const appServerMethods = readAppServerMethods(target);
    this.#setStatus({ state: "starting", binary: target.label, appServerMethods, cwd: target.cwd });

    // Each listener below belongs to one spawned engine. Once that engine is no
    // longer the current child (after stop or restart), its events must not touch
    // shared state, or a late exit would clobber the replacement engine.
    const child = spawn(target.command, target.args, {
      cwd: target.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child = child;
    this.#buffer = "";

    child.stdin.on("error", (error) => this.#handleStdinError(child, error));
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (this.#child === child) {
        this.#handleStdout(chunk);
      }
    });
    child.stdout.on("error", (error) => this.#reportStreamError(child, "stdout", error));
    child.stderr.on("data", (chunk: string) => {
      if (this.#child !== child) {
        return;
      }
      this.emit("stderr", chunk);
      if (this.#status.state !== "ready") {
        this.#setStatus({
          ...this.#status,
          message: chunk.trim().slice(0, 240),
        });
      }
    });
    child.stderr.on("error", (error) => this.#reportStreamError(child, "stderr", error));
    child.once("exit", (code, signal) => {
      if (this.#child !== child) {
        return;
      }
      const message = signal ? `roder exited with signal ${signal}` : `roder exited with code ${code ?? 0}`;
      this.#child = null;
      this.#rejectAll(new Error(message));
      this.#setStatus({ state: "stopped", binary: target.label, appServerMethods, cwd: target.cwd, message });
    });
    child.on("error", (error) => {
      if (this.#child !== child) {
        return;
      }
      this.#child = null;
      this.#rejectAll(error);
      this.#setStatus({
        state: "error",
        binary: target.label,
        appServerMethods,
        cwd: target.cwd,
        message: error.message,
      });
    });

    try {
      await this.#sendRequest(child, "initialize", {
        clientInfo: {
          name: "roder-desktop",
          title: "Roder Desktop",
          version: app.getVersion(),
        },
        capabilities: {
          experimentalApi: true,
        },
      });
    } catch (error) {
      // The handshake failed, so nothing owns this engine. Kill it, and touch shared
      // state only if it is still the current child: a stop or a newer start may
      // already have replaced it and set its own status.
      child.kill();
      if (this.#child === child) {
        this.#child = null;
        const reason = error instanceof Error ? error : new Error(String(error));
        this.#rejectAll(reason);
        this.#setStatus({
          state: "error",
          binary: target.label,
          appServerMethods,
          cwd: target.cwd,
          message: reason.message,
        });
      }
      throw error;
    }

    this.#setStatus({ state: "ready", binary: target.label, appServerMethods, cwd: target.cwd });
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
    this.#setStatus({
      state: "stopped",
      binary: this.#status.binary,
      appServerMethods: this.#status.appServerMethods,
      cwd: this.#status.cwd,
    });
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
    const child = this.#child;
    if (!child) {
      throw new Error("roder app-server is not running");
    }
    return this.#sendRequest(child, method, params);
  }

  #sendRequest(child: ChildProcessWithoutNullStreams, method: string, params: unknown): Promise<unknown> {
    const id = this.#nextId++;
    const message = JSON.stringify({ id, method, params });
    const timeoutMs = requestTimeoutsMs.get(method);
    return new Promise((resolve, reject) => {
      // The timer is cleared by whichever path settles the request, so a late reply
      // after a timeout finds no pending entry and is ignored.
      const timer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              this.#pending.delete(id);
              reject(new Error(`roder app-server ${method} timed out after ${timeoutMs}ms`));
            }, timeoutMs);
      this.#pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.stdin.write(`${message}\n`, (error) => {
        if (!error) {
          return;
        }
        const pending = this.#pending.get(id);
        this.#pending.delete(id);
        pending?.reject(error);
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

    throw new Error(
      `Could not find embedded roder binary at ${app.isPackaged ? packaged : bundled}. Run pnpm bundle:roder before launching the desktop app.`,
    );
  }

  #handleStdinError(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.#child !== child) {
      return;
    }
    this.emit("stderr", `roder stdin error: ${error.message}\n`);
    // With stdin broken, no pending request can reach the engine, so fail them all
    // instead of leaving them to wait for an exit that may never come.
    this.#rejectAll(error);
  }

  #reportStreamError(child: ChildProcessWithoutNullStreams, stream: "stdout" | "stderr", error: Error): void {
    if (this.#child !== child) {
      return;
    }
    this.emit("stderr", `roder ${stream} error: ${error.message}\n`);
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

function readAppServerMethods(target: SpawnTarget): string[] {
  const result = spawnSync(target.command, ["app-server", "schema", "--format", "manifest"], {
    cwd: target.cwd,
    encoding: "utf8",
    env: process.env,
    timeout: schemaProbeTimeoutMs,
  });
  if (result.error || result.status !== 0 || !result.stdout) {
    return [];
  }

  try {
    const manifest = JSON.parse(result.stdout) as {
      methods?: Array<{ method?: unknown }>;
    };
    return (manifest.methods ?? [])
      .map((method) => method.method)
      .filter((method): method is string => typeof method === "string");
  } catch {
    return [];
  }
}

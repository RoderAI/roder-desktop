import { fork, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { JsonObject, JsonValue } from "@roderai/extension-api";
import type { ExtensionCatalog, ExtensionCatalogRecord } from "./catalog";
import { extensionHostRunnerSource } from "./extension-host-runner";

export type ExtensionHostOptions = {
  userDataPath: string;
  appName: string;
  appVersion: string;
  catalog: ExtensionCatalog;
  runnerPath?: string;
};

export type ExtensionCommandResult = {
  extensionId: string;
  commandId: string;
  result: unknown;
};

export type ExtensionToolResult = {
  extensionId: string;
  toolId: string;
  result: JsonValue;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type HostProcess = {
  extensionId: string;
  child: ChildProcess;
  pending: Map<string, PendingRequest>;
  activated: boolean;
  stopping: boolean;
};

type RunnerMessage = {
  type?: string;
  id?: string;
  result?: unknown;
  error?: string;
  message?: string;
  level?: string;
};

export class ExtensionHost {
  readonly #userDataPath: string;
  readonly #appName: string;
  readonly #appVersion: string;
  readonly #catalog: ExtensionCatalog;
  readonly #runnerPath?: string;
  readonly #processes = new Map<string, HostProcess>();
  #nextRequestId = 1;

  constructor(options: ExtensionHostOptions) {
    this.#userDataPath = options.userDataPath;
    this.#appName = options.appName;
    this.#appVersion = options.appVersion;
    this.#catalog = options.catalog;
    this.#runnerPath = options.runnerPath;
  }

  async activateExtension(extensionId: string): Promise<void> {
    const record = await this.#requireEnabledRecord(extensionId);
    const hostProcess = await this.#processFor(record);
    if (hostProcess.activated) {
      return;
    }
    const context = this.#activationContext(record);
    await this.#send(hostProcess, {
      type: "activate",
      entryPath: resolve(record.source.path, record.manifest.main),
      context,
    });
    hostProcess.activated = true;
    await this.#catalog.markActive(record.id);
  }

  async executeCommand(commandId: string, args: unknown[] = []): Promise<ExtensionCommandResult> {
    const record = await this.#recordForCommand(commandId);
    await this.activateExtension(record.id);
    const result = await this.#send(this.#requireProcess(record.id), {
      type: "executeCommand",
      commandId,
      args,
    });
    return {
      extensionId: record.id,
      commandId,
      result,
    };
  }

  async executeTool(toolId: string, input: JsonObject = {}): Promise<ExtensionToolResult> {
    const record = await this.#recordForTool(toolId);
    await this.activateExtension(record.id);
    const result = await this.#send(this.#requireProcess(record.id), {
      type: "executeTool",
      toolId,
      input,
      toolCallId: randomUUID(),
    });
    return {
      extensionId: record.id,
      toolId,
      result: (result ?? null) as JsonValue,
    };
  }

  async reloadExtension(extensionId: string): Promise<void> {
    await this.deactivateExtension(extensionId);
    await this.#catalog.reload(extensionId);
  }

  async deactivateExtension(extensionId: string): Promise<void> {
    const hostProcess = this.#processes.get(extensionId);
    if (!hostProcess) {
      return;
    }
    try {
      await this.#send(hostProcess, { type: "deactivate" });
    } finally {
      hostProcess.stopping = true;
      hostProcess.child.kill();
      this.#processes.delete(extensionId);
      await this.#catalog.appendLog(extensionId, "Stopped extension host process");
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.#processes.keys()].map((extensionId) => this.deactivateExtension(extensionId)));
  }

  async #processFor(record: ExtensionCatalogRecord): Promise<HostProcess> {
    const existing = this.#processes.get(record.id);
    if (existing) {
      return existing;
    }
    const runnerPath = await this.#ensureRunner();
    const child = fork(runnerPath, [], {
      cwd: record.source.path,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
      },
      execArgv: [],
      silent: true,
    });
    const hostProcess: HostProcess = {
      extensionId: record.id,
      child,
      pending: new Map(),
      activated: false,
      stopping: false,
    };
    child.on("message", (message) => void this.#handleMessage(hostProcess, message as RunnerMessage));
    child.once("exit", (code, signal) => {
      this.#processes.delete(record.id);
      const message = signal ? `Extension host exited with signal ${signal}` : `Extension host exited with code ${code ?? 0}`;
      for (const pending of hostProcess.pending.values()) {
        pending.reject(new Error(message));
      }
      hostProcess.pending.clear();
      if (!hostProcess.stopping) {
        void this.#catalog.markFailed(record.id, new Error(message));
      }
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      void this.#catalog.appendLog(record.id, chunk.toString("utf8").trim());
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      void this.#catalog.appendLog(record.id, chunk.toString("utf8").trim());
    });
    this.#processes.set(record.id, hostProcess);
    return hostProcess;
  }

  async #handleMessage(hostProcess: HostProcess, message: RunnerMessage): Promise<void> {
    if (message.type === "response" && message.id) {
      const pending = hostProcess.pending.get(message.id);
      if (!pending) {
        return;
      }
      hostProcess.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.type === "log" && message.message) {
      await this.#catalog.appendLog(hostProcess.extensionId, `${message.level ?? "info"}: ${message.message}`);
    }
  }

  async #send(hostProcess: HostProcess, payload: Record<string, unknown>): Promise<unknown> {
    const id = String(this.#nextRequestId++);
    return new Promise((resolve, reject) => {
      hostProcess.pending.set(id, { resolve, reject });
      hostProcess.child.send({ ...payload, id }, (error) => {
        if (error) {
          hostProcess.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  async #ensureRunner(): Promise<string> {
    if (this.#runnerPath) {
      return this.#runnerPath;
    }
    const runnerPath = join(this.#userDataPath, "extensions", "host-runner.mjs");
    await mkdir(join(this.#userDataPath, "extensions"), { recursive: true });
    await writeFile(runnerPath, extensionHostRunnerSource, "utf8");
    return runnerPath;
  }

  async #requireEnabledRecord(extensionId: string): Promise<ExtensionCatalogRecord> {
    const record = await this.#catalog.get(extensionId);
    if (!record) {
      throw new Error(`Extension ${extensionId} is not installed`);
    }
    if (!record.enabled) {
      throw new Error(`Extension ${extensionId} is disabled`);
    }
    return record;
  }

  async #recordForCommand(commandId: string): Promise<ExtensionCatalogRecord> {
    const snapshot = await this.#catalog.list();
    const record = snapshot.extensions.find((extension) =>
      extension.enabled && extension.manifest.contributes.commands.some((command) => command.id === commandId),
    );
    if (!record) {
      throw new Error(`No enabled extension contributes command ${commandId}`);
    }
    return record;
  }

  async #recordForTool(toolId: string): Promise<ExtensionCatalogRecord> {
    const snapshot = await this.#catalog.list();
    const record = snapshot.extensions.find((extension) =>
      extension.enabled && extension.manifest.contributes.tools.some((tool) => tool.id === toolId),
    );
    if (!record) {
      throw new Error(`No enabled extension contributes tool ${toolId}`);
    }
    return record;
  }

  #requireProcess(extensionId: string): HostProcess {
    const hostProcess = this.#processes.get(extensionId);
    if (!hostProcess) {
      throw new Error(`Extension ${extensionId} is not active`);
    }
    return hostProcess;
  }

  #activationContext(record: ExtensionCatalogRecord): Record<string, unknown> {
    const globalStoragePath = join(this.#userDataPath, "extensions", "storage", "global", record.id);
    const workspaceStoragePath = join(this.#userDataPath, "extensions", "storage", "workspace", record.id, "default");
    return {
      extensionId: record.id,
      extensionPath: record.source.path,
      globalStoragePath,
      workspaceStoragePath,
      preferences: record.preferences,
      env: {
        appName: this.#appName,
        appVersion: this.#appVersion,
        extensionId: record.id,
        extensionPath: record.source.path,
        globalStoragePath,
        workspaceStoragePath,
      },
      workspace: {
        folders: [],
      },
      thread: {},
    };
  }
}

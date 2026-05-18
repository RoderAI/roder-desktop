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

type JsonRecord = Record<string, unknown>;

type DesktopNotification = {
  method: string;
  params: unknown;
};

type VariantRecord = {
  name: string;
  value: JsonRecord;
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

    await this.#rawRequest("system/initialize", {
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
    switch (method) {
      case "thread/list":
      case "thread/read":
      case "thread/start":
      case "turn/start":
      case "turn/steer":
      case "turn/interrupt":
      case "model/list":
        return this.#requestDesktopProtocol(method, params);
      default:
        return this.#rawRequest(method, params);
    }
  }

  async #rawRequest(method: string, params: unknown = {}): Promise<unknown> {
    if (!this.#child && method !== "system/initialize") {
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

  async #requestDesktopProtocol(method: string, params: unknown): Promise<unknown> {
    const input = asRecord(params);
    switch (method) {
      case "thread/list": {
        const result = asRecord(await this.#rawRequest("sessions/list", {}));
        return {
          data: asArray(result.sessions).map((session) => sessionMetadataToThread(session, this.#status.cwd)),
        };
      }
      case "thread/read": {
        const threadId = firstString(input.threadId, input.thread_id);
        const result = asRecord(await this.#rawRequest("sessions/load", { thread_id: threadId }));
        return {
          thread: snapshotToThread(result.snapshot, threadId, this.#status.cwd),
        };
      }
      case "thread/start": {
        const result = asRecord(await this.#rawRequest("sessions/create", {
          title: null,
          workspace: optionalString(input.cwd),
          provider: optionalString(input.modelProvider),
          model: optionalString(input.model),
        }));
        const threadId = firstString(result.thread_id);
        return {
          thread: sessionMetadataToThread({
            thread_id: threadId,
            title: null,
            workspace: optionalString(input.cwd),
            provider: optionalString(result.provider) ?? optionalString(input.modelProvider),
            model: optionalString(result.model) ?? optionalString(input.model),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            message_count: 0,
          }, this.#status.cwd),
          model: optionalString(result.model) ?? optionalString(input.model),
          modelProvider: optionalString(result.provider) ?? optionalString(input.modelProvider),
          cwd: optionalString(input.cwd) ?? this.#status.cwd,
        };
      }
      case "turn/start":
        return this.#rawRequest("turns/start", desktopTurnParams(input));
      case "turn/steer":
        return this.#rawRequest("turns/steer", desktopSteerParams(input));
      case "turn/interrupt":
        return this.#rawRequest("turns/interrupt", {
          thread_id: firstString(input.threadId, input.thread_id),
          turn_id: firstString(input.turnId, input.turn_id),
        });
      case "model/list": {
        const result = asRecord(await this.#rawRequest("providers/list", {}));
        return { models: providersListToModels(result) };
      }
      default:
        return this.#rawRequest(method, params);
    }
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

function desktopTurnParams(params: JsonRecord): JsonRecord {
  return {
    thread_id: firstString(params.threadId, params.thread_id),
    message: desktopMessageText(params),
    images: [],
    provider_override: optionalString(params.modelProvider),
    model_override: optionalString(params.model),
  };
}

function desktopSteerParams(params: JsonRecord): JsonRecord {
  return {
    thread_id: firstString(params.threadId, params.thread_id),
    turn_id: firstString(params.expectedTurnId, params.turnId, params.turn_id),
    message: desktopMessageText(params),
    images: [],
  };
}

function desktopMessageText(params: JsonRecord): string {
  const input = asArray(params.input);
  if (input.length === 0) {
    return firstString(params.prompt, params.message);
  }

  const text: string[] = [];
  const paths: string[] = [];
  for (const itemValue of input) {
    const item = asRecord(itemValue);
    if (item.type === "text") {
      const itemText = optionalString(item.text);
      if (itemText) {
        text.push(itemText);
      }
    }
    if (item.type === "local_file") {
      const path = optionalString(item.path);
      if (path) {
        paths.push(path);
      }
    }
  }

  if (paths.length > 0) {
    text.push(`Attached files:\n${paths.map((path) => `- ${path}`).join("\n")}`);
  }
  return text.join("\n\n");
}

function providersListToModels(result: JsonRecord): JsonRecord[] {
  const activeProvider = optionalString(result.active_provider);
  const activeModel = optionalString(result.active_model);
  const activeReasoning = optionalString(result.active_reasoning) ?? "medium";
  const models: JsonRecord[] = [];

  for (const providerValue of asArray(result.providers)) {
    const provider = asRecord(providerValue);
    const providerId = firstString(provider.id);
    for (const modelValue of asArray(provider.models)) {
      const model = asRecord(modelValue);
      const modelId = firstString(model.id);
      if (!modelId) {
        continue;
      }
      const reasoningEfforts = asArray(model.supported_reasoning)
        .map((effort) => optionalString(asRecord(effort).effort))
        .filter((effort): effort is string => Boolean(effort));
      models.push({
        id: modelId,
        name: firstString(model.name, modelId),
        description: optionalString(model.description) ?? optionalString(provider.description),
        modelProvider: providerId,
        defaultReasoningEffort: optionalString(model.default_reasoning) ?? activeReasoning,
        reasoningEfforts,
        isDefault: providerId === activeProvider && modelId === activeModel,
      });
    }
  }

  return models;
}

function sessionMetadataToThread(value: unknown, fallbackCwd?: string, turns?: JsonRecord[]): JsonRecord {
  const metadata = asRecord(value);
  const id = firstString(metadata.thread_id, metadata.id);
  const createdAt = timestampMs(metadata.created_at);
  const updatedAt = timestampMs(metadata.updated_at, createdAt);
  const title = optionalString(metadata.title);
  return {
    id,
    sessionId: id,
    preview: title ?? "",
    modelProvider: firstString(metadata.provider, "roder"),
    createdAt,
    updatedAt,
    status: { type: "idle" },
    cwd: firstString(metadata.workspace, fallbackCwd, process.cwd()),
    name: title,
    turns,
  };
}

function snapshotToThread(value: unknown, fallbackThreadId: string, fallbackCwd?: string): JsonRecord | undefined {
  const snapshot = asRecord(value);
  if (Object.keys(snapshot).length === 0) {
    return undefined;
  }

  const metadata = {
    thread_id: fallbackThreadId,
    ...asRecord(snapshot.metadata),
  };
  const turns = asArray(snapshot.turns)
    .map((turn) => turnRecordToDesktopTurn(turn))
    .filter((turn): turn is JsonRecord => Boolean(turn));
  return sessionMetadataToThread(metadata, fallbackCwd, turns);
}

function turnRecordToDesktopTurn(value: unknown): JsonRecord | undefined {
  const turn = asRecord(value);
  const id = firstString(turn.turn_id, turn.id);
  if (!id) {
    return undefined;
  }
  const startedAt = timestampMs(turn.created_at);
  const completedAt = optionalTimestampMs(turn.completed_at);
  return {
    id,
    items: asArray(turn.items)
      .map((item, index) => turnItemToDesktopItem(item, id, index))
      .filter((item): item is JsonRecord => Boolean(item)),
    itemsView: "list",
    status: completedAt ? "completed" : "inProgress",
    startedAt,
    completedAt,
    durationMs: completedAt ? Math.max(0, completedAt - startedAt) : null,
  };
}

function turnItemToDesktopItem(value: unknown, turnId: string, index: number): JsonRecord | undefined {
  const variant = variantRecord(value);
  if (!variant) {
    return undefined;
  }

  const id = `${turnId}:${variant.name}:${index}`;
  switch (variant.name) {
    case "UserMessage":
      return {
        id,
        type: "userMessage",
        text: firstString(variant.value.text),
        payload: variant.value,
        raw: value,
      };
    case "AssistantMessage":
      return {
        id,
        type: "agentMessage",
        text: firstString(variant.value.text),
        phase: optionalString(variant.value.phase),
        payload: variant.value,
        raw: value,
      };
    case "ReasoningSummary":
      return {
        id,
        type: "agentMessage",
        text: firstString(variant.value.text),
        phase: "reasoning",
        payload: variant.value,
        raw: value,
      };
    case "ToolCall":
      return {
        id,
        type: "toolCall",
        toolName: firstString(variant.value.name, "tool"),
        toolCallId: firstString(variant.value.id, id),
        payload: { arguments: variant.value.arguments, name: variant.value.name },
        raw: value,
      };
    case "ToolResult":
      return {
        id,
        type: "toolMessage",
        text: firstString(variant.value.result),
        status: variant.value.is_error ? "failed" : "completed",
        toolName: optionalString(variant.value.name),
        toolCallId: firstString(variant.value.id, id),
        payload: { output: variant.value.result, error: variant.value.is_error ? variant.value.result : undefined },
        raw: value,
      };
    case "FileChange":
      return {
        id,
        type: "tool.completed",
        toolName: "file_change",
        payload: variant.value,
        raw: value,
      };
    case "ContextCompaction":
      return {
        id,
        type: "compaction",
        text: firstString(variant.value.summary),
        payload: variant.value,
        raw: value,
      };
    case "Error":
      return {
        id,
        type: "error",
        text: firstString(variant.value.message),
        payload: variant.value,
        raw: value,
      };
    default:
      return {
        id,
        type: variant.name,
        payload: variant.value,
        raw: value,
      };
  }
}

function desktopNotificationsFromMessage(method: string, params: unknown): DesktopNotification[] {
  if (method === "event") {
    return [];
  }
  return [{ method, params: params ?? {} }];
}

function variantRecord(value: unknown): VariantRecord | null {
  const record = asRecord(value);
  const entries = Object.entries(record);
  if (entries.length !== 1) {
    return null;
  }
  const [name, payload] = entries[0] ?? [];
  if (!name) {
    return null;
  }
  return { name, value: asRecord(payload) };
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null ? value as JsonRecord : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function firstString(...values: unknown[]): string {
  return values.map(optionalString).find(Boolean) ?? "";
}

function timestampMs(value: unknown, fallback = Date.now()): number {
  return optionalTimestampMs(value) ?? fallback;
}

function optionalTimestampMs(value: unknown): number | null {
  const text = optionalString(value);
  if (!text) {
    return null;
  }
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? timestamp : null;
}

import { spawn } from "node:child_process";
import { constants as fsConstants, accessSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import type { RoderModel, RoderThread } from "../../src/types/roder";
import { isClaudeCliSignedIn, locateClaudeCli } from "../onboarding/claude-cli";
import {
  prepareExternalBackendCatalog,
  type AgentBackendId,
  type ExternalAgentBackendId,
  type ExternalBackendModelRecord,
} from "./desktop-backend";
import { DESKTOP_POLICY_MODE } from "./desktop-turn-policy";

export type BackendConnectionState = "connected" | "disconnected" | "missing-runtime" | "connecting" | "error";

export type AgentBackendStatus = {
  id: AgentBackendId;
  name: string;
  description: string;
  state: BackendConnectionState;
  runtimeInstalled: boolean;
  runtimePath: string | null;
  connected: boolean;
  modelCount: number;
  models: RoderModel[];
  error?: string | null;
};

export type AgentBackendsSnapshot = {
  activeBackend: AgentBackendId;
  backends: Record<AgentBackendId, AgentBackendStatus>;
};

export type AntigravityStatus = Omit<AgentBackendStatus, "id" | "name" | "description" | "models">;
export type AntigravitySetupMode = "login" | "install";

export type ExternalBackendClient = {
  start: () => Promise<unknown>;
  request: (method: string, params?: unknown) => Promise<unknown>;
  stop: () => Promise<void>;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
  off?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => unknown;
};

type SavedExternalThread = {
  id: string;
  backend: ExternalAgentBackendId;
  workspaceId: string | null;
  rootId: string | null;
  cwd: string;
  preview: string;
  model: string;
  createdAt: number;
  updatedAt: number;
};

type PersistedBackendsState = {
  activeBackend?: AgentBackendId;
  threads?: SavedExternalThread[];
};

type WireProviderModel = {
  id: string;
  name: string;
  description?: string | null;
  default_reasoning?: string | null;
  supported_reasoning?: Array<{ effort: string; description?: string | null }> | null;
  isDefault?: boolean;
};

type WireProvider = {
  id: string;
  name: string;
  description?: string | null;
  auth_type?: string;
  auth_label?: string | null;
  authenticated?: boolean;
  auth_detail?: string | null;
  recommended?: boolean;
  sort_order?: number;
  models?: WireProviderModel[];
  [key: string]: unknown;
};

type WireProvidersList = {
  providers?: WireProvider[];
  [key: string]: unknown;
};

export type FindRuntimeOptions = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
  arch?: string;
};

export type AgentBackendsManagerOptions = {
  createClient: (backend: ExternalAgentBackendId) => ExternalBackendClient;
  findRuntime?: (backend: ExternalAgentBackendId) => string | null;
  checkClaudeAuth?: (path: string) => Promise<boolean>;
  runLogoutCommand?: (backend: ExternalAgentBackendId) => Promise<void>;
  storagePath?: string;
  onNotification?: (payload: { method: string; params: unknown }) => void;
  onChanged?: (snapshot: AgentBackendsSnapshot) => void;
  onStderr?: (backend: ExternalAgentBackendId, message: string) => void;
};

const EXTERNAL_BACKENDS: readonly ExternalAgentBackendId[] = ["codex", "antigravity", "claude-code"];
const LOGOUT_TIMEOUT_MS = 45_000;

const BACKEND_META: Record<AgentBackendId, { name: string; description: string }> = {
  roder: {
    name: "Roder",
    description: "Native Roder runtime with all your configured model providers.",
  },
  codex: {
    name: "Codex",
    description: "OpenAI Codex agent backend via the Codex CLI app-server.",
  },
  antigravity: {
    name: "Antigravity",
    description: "Google Antigravity agent backend via the official agy CLI.",
  },
  "claude-code": {
    name: "Claude Code",
    description: "Interactive Claude Code CLI with its native tools, workflows, and subagents.",
  },
};

export function antigravityTargetsForPlatform(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string[] {
  const osName =
    platform === "darwin" ? "darwin" : platform === "linux" ? "linux" : platform === "win32" ? "windows" : null;
  const cpuName = arch === "x64" ? "amd64" : arch === "arm64" ? "arm64" : null;
  if (!osName || !cpuName) {
    return [];
  }
  if (osName === "linux") {
    return [`${osName}_${cpuName}`, `${osName}_${cpuName}_musl`];
  }
  return [`${osName}_${cpuName}`];
}

function isRunnableFile(filePath: string, platform: NodeJS.Platform): boolean {
  try {
    const stat = statSync(filePath);
    if (!stat.isFile() || stat.size === 0) {
      return false;
    }
    if (platform === "win32") {
      return true;
    }
    accessSync(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function commonUserBinDirs(homeDir: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === "win32") {
    const appData = env.APPDATA?.trim();
    const localAppData = env.LOCALAPPDATA?.trim();
    return [
      ...(appData ? [join(appData, "npm")] : []),
      ...(localAppData ? [join(localAppData, "Programs", "antigravity"), join(localAppData, "Programs", "codex")] : []),
      join(homeDir, ".local", "bin"),
    ];
  }
  return [
    join(homeDir, ".local", "bin"),
    join(homeDir, ".local", "share", "mise", "shims"),
    join(homeDir, ".local", "share", "mise", "command-wrappers", "bin"),
    join(homeDir, ".npm-global", "bin"),
    join(homeDir, ".volta", "bin"),
    join(homeDir, ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
}

function searchExecutableInPath(names: string[], options: FindRuntimeOptions): string | null {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const platform = options.platform ?? process.platform;

  const rawPath = env.PATH || env.Path || "";
  const pathDirs = rawPath
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const seen = new Set(pathDirs);
  const dirs = [...pathDirs];
  for (const dir of commonUserBinDirs(homeDir, platform, env)) {
    if (!seen.has(dir)) {
      seen.add(dir);
      dirs.push(dir);
    }
  }
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (isRunnableFile(candidate, platform)) {
        return candidate;
      }
    }
  }
  return null;
}

function findManagedAntigravityRuntime(rootDir: string, platform: NodeJS.Platform, arch: string): string | null {
  const executable = platform === "win32" ? "agy.exe" : "antigravity";
  for (const target of antigravityTargetsForPlatform(platform, arch)) {
    const targetRoot = join(rootDir, "tools", "antigravity", target);
    const activePath = join(targetRoot, "active.json");
    try {
      const raw = readFileSync(activePath, "utf8");
      if (raw.length > 4096) {
        continue;
      }
      const parsed = JSON.parse(raw) as { release?: unknown };
      const release = typeof parsed?.release === "string" ? parsed.release : "";
      if (!release || release.startsWith(".") || !/^[A-Za-z0-9.-]+$/u.test(release)) {
        continue;
      }
      const candidate = join(targetRoot, "versions", release, executable);
      if (isRunnableFile(candidate, platform)) {
        return candidate;
      }
    } catch {
      // Missing or unreadable managed target — continue searching fallbacks.
    }
  }
  return null;
}

export function findAntigravityRuntime(options: FindRuntimeOptions = {}): string | null {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;

  const roderRoot = env.RODER_CONFIG_DIR?.trim() || env.RODER_DATA_DIR?.trim() || join(homeDir, ".roder");
  const managed = findManagedAntigravityRuntime(roderRoot, platform, arch);
  if (managed) {
    return managed;
  }

  const names = platform === "win32" ? ["agy.exe", "agy.cmd", "agy.bat", "agy"] : ["agy"];
  return searchExecutableInPath(names, options);
}

export function findCodexRuntime(options: FindRuntimeOptions = {}): string | null {
  const platform = options.platform ?? process.platform;
  const names = platform === "win32" ? ["codex.exe", "codex.cmd", "codex.bat", "codex"] : ["codex"];
  return searchExecutableInPath(names, options);
}

export function findExternalBackendRuntime(
  backend: ExternalAgentBackendId,
  options: FindRuntimeOptions = {},
): string | null {
  if (backend === "claude-code") {
    const env = options.env ?? process.env;
    const platform = options.platform ?? process.platform;
    const override = env.RODER_CLAUDE_CODE_CLI_PATH?.trim();
    if (override) return isRunnableFile(override, platform) ? override : null;
    return locateClaudeCli({ env, platform, homeDir: options.homeDir ?? homedir() })?.path ?? null;
  }
  return backend === "codex" ? findCodexRuntime(options) : findAntigravityRuntime(options);
}

/** Prepends a discovered CLI directory onto PATH so packaged Finder/Dock launches can spawn it. */
export function runtimePathExtraEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  runtimePath: string | null,
): Record<string, string> {
  if (!runtimePath) {
    return {};
  }
  const dir = dirname(runtimePath);
  const currentPath = baseEnv.PATH || baseEnv.Path || "";
  const entries = currentPath
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.includes(dir)) {
    return {};
  }
  return { PATH: currentPath ? `${dir}${delimiter}${currentPath}` : dir };
}

export function resolveAntigravitySetupCommand(options: {
  binaryPath: string;
  runtimePath: string | null;
  mode?: AntigravitySetupMode;
}): { executable: string; args: string[]; mode: AntigravitySetupMode } {
  const effectiveMode: AntigravitySetupMode = options.mode === "install" || !options.runtimePath ? "install" : "login";
  return {
    executable: options.binaryPath,
    args: effectiveMode === "install" ? ["--backend", "antigravity"] : ["auth", "login", "antigravity"],
    mode: effectiveMode,
  };
}

export function resolveCodexSetupCommand(options: { runtimePath: string | null }): {
  executable: string;
  args: string[];
} {
  if (!options.runtimePath) {
    throw new Error(
      "Codex CLI (`codex`) was not found on this machine. Install it first (e.g. `npm i -g @openai/codex`), then click Check connection.",
    );
  }
  return {
    executable: options.runtimePath,
    args: ["login"],
  };
}

export function runExternalBackendLogoutCli(
  backend: ExternalAgentBackendId,
  options: { roderBinaryPath: string; env?: NodeJS.ProcessEnv },
): Promise<void> {
  const env = options.env ?? process.env;
  const runtimePath = findExternalBackendRuntime(backend, { env });
  const command =
    backend === "antigravity"
      ? { executable: options.roderBinaryPath, args: ["auth", "logout", "antigravity"] }
      : runtimePath && { executable: runtimePath, args: backend === "claude-code" ? ["auth", "logout"] : ["logout"] };
  if (!command) {
    return Promise.resolve();
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command.executable, command.args, {
      cwd: process.cwd(),
      env: { ...env, ...runtimePathExtraEnv(env, runtimePath), RODER_DESKTOP: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
      rejectPromise(new Error(`${BACKEND_META[backend].name} sign-out timed out.`));
    }, LOGOUT_TIMEOUT_MS);

    child.once("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(
          new Error(stderr.trim() || `${BACKEND_META[backend].name} sign-out exited with code ${code ?? "unknown"}.`),
        );
      }
    });
  });
}

type SidecarSlot = {
  client: ExternalBackendClient | null;
  cleanup: (() => void) | null;
  state: BackendConnectionState;
  models: ExternalBackendModelRecord[];
  lastError: string | null;
  connectPromise: Promise<AgentBackendStatus> | null;
};

function createEmptySlot(): SidecarSlot {
  return {
    client: null,
    cleanup: null,
    state: "disconnected",
    models: [],
    lastError: null,
    connectPromise: null,
  };
}

export class AgentBackendsManager {
  readonly #createClient: (backend: ExternalAgentBackendId) => ExternalBackendClient;
  readonly #findRuntime: (backend: ExternalAgentBackendId) => string | null;
  readonly #checkClaudeAuth: (path: string) => Promise<boolean>;
  readonly #runLogoutCommand?: (backend: ExternalAgentBackendId) => Promise<void>;
  readonly #storagePath?: string;
  readonly #onNotification?: (payload: { method: string; params: unknown }) => void;
  readonly #onChanged?: (snapshot: AgentBackendsSnapshot) => void;
  readonly #onStderr?: (backend: ExternalAgentBackendId, message: string) => void;

  #activeBackend: AgentBackendId = "roder";
  #slots: Record<ExternalAgentBackendId, SidecarSlot> = {
    codex: createEmptySlot(),
    antigravity: createEmptySlot(),
    "claude-code": createEmptySlot(),
  };
  #threads = new Map<string, SavedExternalThread>();
  #approvalRoutes = new Map<string, ExternalAgentBackendId>();
  #userInputRoutes = new Map<string, ExternalAgentBackendId>();
  #turnIdleWaiters = new Map<string, Set<() => void>>();
  #steeringThreads = new Set<string>();
  #hydrated = false;

  constructor(options: AgentBackendsManagerOptions) {
    this.#createClient = options.createClient;
    this.#findRuntime = options.findRuntime ?? ((backend) => findExternalBackendRuntime(backend));
    this.#checkClaudeAuth = options.checkClaudeAuth ?? isClaudeCliSignedIn;
    this.#runLogoutCommand = options.runLogoutCommand;
    this.#storagePath = options.storagePath;
    this.#onNotification = options.onNotification;
    this.#onChanged = options.onChanged;
    this.#onStderr = options.onStderr;
  }

  async hydrate(): Promise<void> {
    if (this.#hydrated) {
      return;
    }
    this.#hydrated = true;
    if (!this.#storagePath) {
      return;
    }
    try {
      const raw = await readFile(this.#storagePath, "utf8");
      const parsed = JSON.parse(raw) as PersistedBackendsState | SavedExternalThread[];
      if (Array.isArray(parsed)) {
        // Backwards compatibility with early array-only antigravity thread storage.
        for (const entry of parsed) {
          this.#ingestSavedThread(entry, "antigravity");
        }
        return;
      }
      if (isRecord(parsed)) {
        this.#activeBackend = parseExternalBackend(parsed.activeBackend) ?? "roder";
        if (Array.isArray(parsed.threads)) {
          for (const entry of parsed.threads) {
            this.#ingestSavedThread(entry);
          }
        }
      }
    } catch {
      // Missing or invalid state starts cleanly on native Roder backend.
    }
  }

  getActiveBackend(): AgentBackendId {
    return this.#activeBackend;
  }

  getBackendStatus(backend: AgentBackendId): AgentBackendStatus {
    if (backend === "roder") {
      return {
        id: "roder",
        name: BACKEND_META.roder.name,
        description: BACKEND_META.roder.description,
        state: "connected",
        runtimeInstalled: true,
        runtimePath: null,
        connected: true,
        modelCount: 0,
        models: [],
        error: null,
      };
    }
    const slot = this.#slots[backend];
    const runtimePath = this.#findRuntime(backend);
    const runtimeInstalled = Boolean(runtimePath);
    const connected = Boolean(slot.client) && slot.state === "connected" && slot.models.length > 0;
    const state: BackendConnectionState = connected
      ? "connected"
      : slot.state === "connecting"
        ? "connecting"
        : !runtimeInstalled
          ? "missing-runtime"
          : slot.state === "error"
            ? "error"
            : "disconnected";
    return {
      id: backend,
      name: BACKEND_META[backend].name,
      description: BACKEND_META[backend].description,
      state,
      runtimeInstalled,
      runtimePath,
      connected,
      modelCount: connected ? slot.models.length : 0,
      models: connected ? this.#domainModels(backend) : [],
      error: slot.lastError,
    };
  }

  getAntigravityStatus(): AntigravityStatus {
    const status = this.getBackendStatus("antigravity");
    return {
      state: status.state,
      runtimeInstalled: status.runtimeInstalled,
      runtimePath: status.runtimePath,
      connected: status.connected,
      modelCount: status.modelCount,
      error: status.error,
    };
  }

  getSnapshot(): AgentBackendsSnapshot {
    return {
      activeBackend: this.#activeBackend,
      backends: {
        roder: this.getBackendStatus("roder"),
        codex: this.getBackendStatus("codex"),
        antigravity: this.getBackendStatus("antigravity"),
        "claude-code": this.getBackendStatus("claude-code"),
      },
    };
  }

  probeInBackground(): void {
    for (const backend of EXTERNAL_BACKENDS) {
      const slot = this.#slots[backend];
      if (this.getBackendStatus(backend).connected || slot.connectPromise) {
        continue;
      }
      if (!this.#findRuntime(backend)) {
        if (this.#activeBackend === backend) {
          this.#activeBackend = "roder";
          void this.#persist();
          this.#emitChanged();
        }
        continue;
      }
      void this.connectBackend(backend, { notifyOnChange: true, silentFailure: true })
        .then((status) => {
          if (!status.connected && this.#activeBackend === backend) {
            this.#activeBackend = "roder";
            void this.#persist();
            this.#emitChanged();
          }
        })
        .catch(() => undefined);
    }
  }

  async selectBackend(backend: AgentBackendId): Promise<AgentBackendsSnapshot> {
    await this.hydrate();
    if (backend === "roder") {
      if (this.#activeBackend !== "roder") {
        this.#activeBackend = "roder";
        await this.#persist();
        this.#emitChanged();
      }
      return this.getSnapshot();
    }
    const status = await this.connectBackend(backend, { notifyOnChange: false });
    if (!status.connected) {
      throw new Error(
        status.runtimeInstalled
          ? `${BACKEND_META[backend].name} is not signed in yet. Complete setup in Settings > Providers.`
          : `${BACKEND_META[backend].name} CLI is not installed on this machine. Set it up in Settings > Providers.`,
      );
    }
    this.#activeBackend = backend;
    await this.#persist();
    this.#emitChanged();
    return this.getSnapshot();
  }

  async connectBackend(
    backend: ExternalAgentBackendId,
    options: { forceRefresh?: boolean; notifyOnChange?: boolean; silentFailure?: boolean } = {},
  ): Promise<AgentBackendStatus> {
    const slot = this.#slots[backend];
    if (slot.connectPromise) {
      return slot.connectPromise;
    }
    const run = this.#connectBackendInternal(backend, options);
    slot.connectPromise = run;
    try {
      return await run;
    } finally {
      if (slot.connectPromise === run) {
        slot.connectPromise = null;
      }
    }
  }

  async #connectBackendInternal(
    backend: ExternalAgentBackendId,
    options: { forceRefresh?: boolean; notifyOnChange?: boolean; silentFailure?: boolean },
  ): Promise<AgentBackendStatus> {
    await this.hydrate();
    const slot = this.#slots[backend];
    const wasConnected = this.getBackendStatus(backend).connected;
    const previousState = slot.state;
    const previousSignature = slot.models.map((model) => model.id).join(",");
    const runtimePath = this.#findRuntime(backend);

    if (!runtimePath) {
      await this.#detachClient(backend, true);
      slot.models = [];
      slot.state = "missing-runtime";
      slot.lastError = null;
      if ((wasConnected || previousState !== slot.state) && options.notifyOnChange) {
        this.#emitChanged();
      }
      return this.getBackendStatus(backend);
    }

    if (slot.client && slot.state === "connected" && !options.forceRefresh) {
      return this.getBackendStatus(backend);
    }

    if (backend === "claude-code" && !(await this.#checkClaudeAuth(runtimePath))) {
      await this.#detachClient(backend, true);
      slot.models = [];
      slot.state = "disconnected";
      slot.lastError = "Run claude auth login in a terminal, then check the connection.";
      if ((wasConnected || previousState !== slot.state) && options.notifyOnChange) this.#emitChanged();
      return this.getBackendStatus(backend);
    }

    if (slot.client && options.forceRefresh) {
      try {
        const result = (await slot.client.request("model/list", {})) as {
          models?: ExternalBackendModelRecord[];
        };
        const models = (result?.models ?? []).filter((model) => Boolean(model?.id) && model.modelProvider === backend);
        if (models.length > 0) {
          slot.models = models;
          slot.state = "connected";
          slot.lastError = null;
          if (
            options.notifyOnChange &&
            (!wasConnected || previousSignature !== models.map((model) => model.id).join(","))
          ) {
            this.#emitChanged();
          }
          return this.getBackendStatus(backend);
        }
      } catch {
        await this.#detachClient(backend, true);
      }
    }

    slot.state = "connecting";
    slot.lastError = null;
    const candidate = this.#createClient(backend);
    try {
      const { client, models } = await prepareExternalBackendCatalog(candidate, backend);
      await this.#detachClient(backend, true);
      this.#attachClient(backend, client);
      slot.models = models;
      slot.state = "connected";
      slot.lastError = null;
      if (
        options.notifyOnChange &&
        (!wasConnected || previousSignature !== models.map((model) => model.id).join(","))
      ) {
        this.#emitChanged();
      }
      return this.getBackendStatus(backend);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      slot.models = [];
      slot.state = options.silentFailure ? "disconnected" : "error";
      slot.lastError = options.silentFailure ? null : message;
      if ((wasConnected || previousState !== slot.state) && options.notifyOnChange) {
        this.#emitChanged();
      }
      if (!options.silentFailure) {
        throw error;
      }
      return this.getBackendStatus(backend);
    }
  }

  async logoutBackend(backend: ExternalAgentBackendId): Promise<AgentBackendsSnapshot> {
    await this.hydrate();
    await this.stopBackend(backend);
    if (this.#runLogoutCommand) {
      await this.#runLogoutCommand(backend);
    }
    const slot = this.#slots[backend];
    slot.models = [];
    slot.state = "disconnected";
    slot.lastError = null;
    if (this.#activeBackend === backend) {
      this.#activeBackend = "roder";
      await this.#persist();
    }
    this.#emitChanged();
    return this.getSnapshot();
  }

  async stopBackend(backend: ExternalAgentBackendId): Promise<void> {
    await this.#detachClient(backend, true);
    for (const [id, owner] of this.#approvalRoutes) {
      if (owner === backend) {
        this.#approvalRoutes.delete(id);
      }
    }
    for (const [id, owner] of this.#userInputRoutes) {
      if (owner === backend) {
        this.#userInputRoutes.delete(id);
      }
    }
    const slot = this.#slots[backend];
    if (slot.state === "connected" || slot.state === "connecting") {
      slot.state = "disconnected";
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all(EXTERNAL_BACKENDS.map((backend) => this.stopBackend(backend)));
  }

  backendForThread(threadId: string | null | undefined): ExternalAgentBackendId | null {
    if (!threadId) {
      return null;
    }
    return this.#threads.get(threadId)?.backend ?? null;
  }

  backendForApproval(approvalId: string | null | undefined): ExternalAgentBackendId | null {
    return approvalId ? (this.#approvalRoutes.get(approvalId) ?? null) : null;
  }

  backendForUserInput(requestId: string | null | undefined): ExternalAgentBackendId | null {
    return requestId ? (this.#userInputRoutes.get(requestId) ?? null) : null;
  }

  /** Determines whether a provider/thread-creation RPC should route to an external agent backend. */
  externalBackendForRequest(method: string, params: unknown): ExternalAgentBackendId | null {
    if (isRecord(params)) {
      const explicit = parseExternalBackend(params.agentBackend);
      if (explicit) {
        return explicit;
      }
      if (params.agentBackend === "roder") {
        return null;
      }
      if (method === "providers/select" && normalizeId(params.provider) === "antigravity") {
        return "antigravity";
      }
      if (
        method === "model/select" &&
        isRecord(params.selection) &&
        normalizeId(params.selection.provider) === "antigravity"
      ) {
        return "antigravity";
      }
      if (
        method === "thread/start" &&
        (normalizeId(params.modelProvider) === "antigravity" ||
          normalizeId(params.model_provider) === "antigravity" ||
          (isRecord(params.selection) && normalizeId(params.selection.provider) === "antigravity"))
      ) {
        return "antigravity";
      }
    }
    if (method === "thread/start" && this.#activeBackend !== "roder") {
      return this.#activeBackend;
    }
    return null;
  }

  mergeProvidersList<T extends WireProvidersList>(base: T): T {
    const existing = Array.isArray(base?.providers) ? base.providers : [];
    if (existing.some((provider) => normalizeId(provider?.id) === "antigravity")) {
      return base;
    }
    const status = this.getBackendStatus("antigravity");
    const descriptor: WireProvider = {
      id: "antigravity",
      name: "Antigravity",
      description: "Google Antigravity models through your Google subscription.",
      auth_type: "oauth",
      auth_label: "Google sign-in",
      authenticated: status.connected,
      auth_detail: status.connected
        ? "Signed in via Antigravity CLI"
        : status.runtimeInstalled
          ? "Google subscription"
          : "Antigravity CLI setup required",
      recommended: true,
      sort_order: 2,
      models: status.connected ? this.#wireModels("antigravity") : [],
    };
    const insertAt = findProviderInsertIndex(existing);
    const providers = [...existing.slice(0, insertAt), descriptor, ...existing.slice(insertAt)];
    return { ...base, providers };
  }

  mergeModelsList<T extends { models?: RoderModel[] }>(base: T): T {
    const existing = Array.isArray(base?.models) ? base.models : [];
    if (!this.getBackendStatus("antigravity").connected) {
      return base;
    }
    const seen = new Set(existing.map((model) => `${normalizeId(model.modelProvider)}:${model.id}`));
    const extra: RoderModel[] = [];
    for (const model of this.#domainModels("antigravity")) {
      const key = `antigravity:${model.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      extra.push(model);
    }
    return { ...base, models: [...existing, ...extra] };
  }

  mergeThreadList<T extends { data?: RoderThread[] }>(base: T, params?: unknown): T {
    if (isRecord(params) && typeof params.cursor === "string" && params.cursor.trim()) {
      return base;
    }
    const existing = Array.isArray(base?.data) ? base.data : [];
    const byId = new Map<string, RoderThread>();
    for (const thread of existing) {
      byId.set(thread.id, thread.agentBackend ? thread : { ...thread, agentBackend: "roder" });
    }
    for (const saved of this.#threads.values()) {
      if (byId.has(saved.id)) {
        continue;
      }
      byId.set(saved.id, savedThreadToRoderThread(saved));
    }
    const merged = [...byId.values()].sort((left, right) => right.updatedAt - left.updatedAt);
    const limit = isRecord(params) && typeof params.limit === "number" && params.limit > 0 ? params.limit : null;
    return { ...base, data: limit ? merged.slice(0, limit) : merged };
  }

  async handleRequest(backend: ExternalAgentBackendId, method: string, params: unknown): Promise<unknown> {
    await this.hydrate();

    if (method === "thread/goal/get") {
      return { goal: null };
    }
    if (method === "turn/subagentTraces/list") {
      return { traces: [] };
    }
    if (method === "hunk/list") {
      return { hunks: [] };
    }
    if (method === "workspace/changes/list") {
      return { changes: [] };
    }

    const client = await this.#requireConnectedClient(backend);

    if (method === "model/select" || method === "providers/select") {
      const cleaned = stripAgentBackendField(params);
      return client.request(method, cleaned);
    }

    if (method === "thread/start") {
      const input = isRecord(params) ? params : {};
      if (
        input.desktopCloudMachineId !== undefined ||
        input.cloudMachineId !== undefined ||
        input.runner !== undefined
      ) {
        const label = BACKEND_META[backend].name;
        throw new Error(
          `${label} runs locally via the ${label} CLI and is not supported on remote cloud machines yet. Switch to Local to use ${label}.`,
        );
      }
      const startParams: Record<string, unknown> = {
        ...(typeof input.model === "string" && input.model ? { model: input.model } : {}),
        ...(typeof input.cwd === "string" && input.cwd ? { cwd: input.cwd } : {}),
        ...(typeof input.workspaceId === "string" && input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(typeof input.rootId === "string" && input.rootId ? { rootId: input.rootId } : {}),
      };
      const result = (await client.request("thread/start", startParams)) as {
        thread?: RoderThread;
        [key: string]: unknown;
      };
      if (result?.thread?.id) {
        const now = Math.floor(Date.now() / 1000);
        const enriched = this.#enrichThread(backend, result.thread, {
          workspaceId: typeof input.workspaceId === "string" ? input.workspaceId : null,
          rootId: typeof input.rootId === "string" ? input.rootId : null,
          cwd: typeof input.cwd === "string" ? input.cwd : "",
          preview: typeof input.initialPrompt === "string" ? input.initialPrompt : "",
          model: typeof input.model === "string" ? input.model : "",
          createdAt: now,
          updatedAt: now,
        });
        await this.#rememberThread(backend, enriched);
        return { ...result, thread: enriched };
      }
      return result;
    }

    if (backend === "claude-code" && (method === "thread/history/read" || method === "thread/resume")) {
      const page = (await client.request(method, stripAgentBackendField(params))) as {
        thread?: RoderThread | null;
        [key: string]: unknown;
      };
      const thread = page.thread ? this.#enrichThread(backend, page.thread) : page.thread;
      if (thread) await this.#rememberThread(backend, thread);
      return { ...page, thread };
    }

    if (method === "thread/read" || method === "thread/history/read") {
      const threadId = threadIdFromParams(params);
      if (!threadId) {
        throw new Error("A thread ID is required");
      }
      const result = (await client.request(
        "thread/read",
        backend === "claude-code" ? stripAgentBackendField(params) : { threadId },
      )) as {
        thread?: RoderThread | null;
        [key: string]: unknown;
      };
      const thread = result?.thread ? this.#enrichThread(backend, result.thread) : null;
      if (thread) {
        await this.#rememberThread(backend, thread);
      }
      if (method === "thread/history/read") {
        return {
          thread,
          before: null,
          hasMore: false,
        };
      }
      return { ...result, thread };
    }

    if (method === "turn/start") {
      const input = isRecord(params) ? params : {};
      const threadId = threadIdFromParams(input);
      const turnParams: Record<string, unknown> = {
        threadId,
        ...(typeof input.prompt === "string" ? { prompt: input.prompt } : {}),
        ...(Array.isArray(input.input) ? { input: input.input } : {}),
        ...(backend === "claude-code"
          ? {}
          : {
              ...(typeof input.model === "string" && input.model ? { model: input.model } : {}),
              ...(typeof input.reasoning === "string" && input.reasoning ? { reasoning: input.reasoning } : {}),
              policyMode: DESKTOP_POLICY_MODE,
            }),
      };
      if (threadId) {
        const existing = this.#threads.get(threadId);
        const preview = extractPromptPreview(input);
        if (existing) {
          existing.updatedAt = Math.floor(Date.now() / 1000);
          if (!existing.preview && preview) {
            existing.preview = preview;
          }
          if (typeof turnParams.model === "string" && turnParams.model) {
            existing.model = turnParams.model;
          }
          await this.#persist();
        }
      }
      try {
        return await client.request("turn/start", turnParams);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (backend === "antigravity" && threadId && /already has an active turn/iu.test(message)) {
          return this.#interruptAndStartTurn(client, threadId, turnParams);
        }
        throw error;
      }
    }

    if (method === "turn/steer") {
      const cleanParams = stripAgentBackendField(params);
      try {
        return await client.request("turn/steer", cleanParams);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const threadId = threadIdFromParams(cleanParams);
        if (backend === "antigravity" && threadId && /already has an active turn/iu.test(message)) {
          const expectedTurnId =
            typeof cleanParams.expectedTurnId === "string" && cleanParams.expectedTurnId
              ? cleanParams.expectedTurnId
              : undefined;
          const startParams: Record<string, unknown> = {
            threadId,
            ...(typeof cleanParams.prompt === "string" ? { prompt: cleanParams.prompt } : {}),
            ...(Array.isArray(cleanParams.input) ? { input: cleanParams.input } : {}),
          };
          const started = (await this.#interruptAndStartTurn(client, threadId, startParams, expectedTurnId)) as {
            turnId?: string;
            turn_id?: string;
          };
          const nextTurnId =
            typeof started?.turnId === "string"
              ? started.turnId
              : typeof started?.turn_id === "string"
                ? started.turn_id
                : (expectedTurnId ?? "");
          return { turnId: nextTurnId };
        }
        throw error;
      }
    }

    if (method === "turn/interrupt") {
      return client.request(method, stripAgentBackendField(params));
    }

    if (method === "thread/archive") {
      const threadId = threadIdFromParams(params);
      if (!threadId) {
        throw new Error("A thread ID is required");
      }
      try {
        await client.request("thread/archive", { threadId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/unknown backend thread|not found|does not support loading sessions/iu.test(message)) {
          throw error;
        }
      }
      this.#threads.delete(threadId);
      await this.#persist();
      return { threadId, archived: true };
    }

    if (method === "thread/set_mode") {
      const input = isRecord(params) ? params : {};
      const mode = typeof input.mode === "string" ? input.mode : "accept_all";
      try {
        return await client.request("thread/set_mode", stripAgentBackendField(params));
      } catch {
        return { mode };
      }
    }

    if (method === "thread/resolve_approval") {
      const input = isRecord(params) ? params : {};
      const approvalId = typeof input.approvalId === "string" ? input.approvalId : "";
      try {
        return await client.request("thread/resolve_approval", stripAgentBackendField(params));
      } finally {
        if (approvalId) {
          this.#approvalRoutes.delete(approvalId);
        }
      }
    }

    if (method === "thread/resolve_user_input") {
      const input = isRecord(params) ? params : {};
      const requestId = typeof input.requestId === "string" ? input.requestId : "";
      try {
        return await client.request("thread/resolve_user_input", stripAgentBackendField(params));
      } finally {
        if (requestId) {
          this.#userInputRoutes.delete(requestId);
        }
      }
    }

    return client.request(method, stripAgentBackendField(params));
  }

  async #requireConnectedClient(backend: ExternalAgentBackendId): Promise<ExternalBackendClient> {
    const slot = this.#slots[backend];
    if (!slot.client || slot.state !== "connected") {
      await this.connectBackend(backend, { notifyOnChange: true });
    }
    if (!slot.client) {
      const label = BACKEND_META[backend].name;
      throw new Error(`${label} is not connected. Set up ${label} in Settings > Providers first.`);
    }
    return slot.client;
  }

  #domainModels(backend: ExternalAgentBackendId): RoderModel[] {
    return this.#slots[backend].models.map((model) => ({
      id: model.id,
      name: model.name || model.id,
      description: model.description,
      modelProvider: backend,
      defaultReasoningEffort: model.defaultReasoningEffort || undefined,
      reasoningEfforts: model.reasoningEfforts,
      isDefault: Boolean(model.isDefault),
    }));
  }

  #wireModels(backend: ExternalAgentBackendId): WireProviderModel[] {
    return this.#slots[backend].models.map((model) => ({
      id: model.id,
      name: model.name || model.id,
      description: model.description ?? null,
      default_reasoning: model.defaultReasoningEffort || null,
      supported_reasoning: (model.reasoningEfforts ?? [])
        .filter((effort) => effort.length > 0)
        .map((effort) => ({ effort, description: "" })),
      isDefault: Boolean(model.isDefault),
    }));
  }

  #enrichThread(
    backend: ExternalAgentBackendId,
    thread: RoderThread,
    fallback?: Partial<SavedExternalThread>,
  ): RoderThread {
    const saved = this.#threads.get(thread.id);
    const now = Math.floor(Date.now() / 1000);
    return {
      ...thread,
      agentBackend: backend,
      modelProvider: backend,
      model: thread.model || saved?.model || fallback?.model || "",
      preview: thread.preview || saved?.preview || fallback?.preview || "",
      cwd: thread.cwd || saved?.cwd || fallback?.cwd || "",
      workspaceId: thread.workspaceId || saved?.workspaceId || fallback?.workspaceId || null,
      rootId: thread.rootId || saved?.rootId || fallback?.rootId || null,
      createdAt: thread.createdAt || saved?.createdAt || fallback?.createdAt || now,
      updatedAt: thread.updatedAt || saved?.updatedAt || fallback?.updatedAt || now,
    };
  }

  async #rememberThread(backend: ExternalAgentBackendId, thread: RoderThread): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const previous = this.#threads.get(thread.id);
    this.#threads.set(thread.id, {
      id: thread.id,
      backend,
      workspaceId: thread.workspaceId || previous?.workspaceId || null,
      rootId: thread.rootId || previous?.rootId || null,
      cwd: thread.cwd || previous?.cwd || "",
      preview: thread.preview || previous?.preview || "",
      model: thread.model || previous?.model || "",
      createdAt: thread.createdAt || previous?.createdAt || now,
      updatedAt: Math.max(thread.updatedAt || 0, previous?.updatedAt || 0, now),
    });
    await this.#persist();
  }

  #ingestSavedThread(entry: unknown, defaultBackend?: ExternalAgentBackendId): void {
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id) {
      return;
    }
    const backend = parseExternalBackend(entry.backend) ?? defaultBackend;
    if (!backend) {
      return;
    }
    this.#threads.set(entry.id, {
      id: entry.id,
      backend,
      workspaceId: typeof entry.workspaceId === "string" && entry.workspaceId ? entry.workspaceId : null,
      rootId: typeof entry.rootId === "string" && entry.rootId ? entry.rootId : null,
      cwd: typeof entry.cwd === "string" ? entry.cwd : "",
      preview: typeof entry.preview === "string" ? entry.preview : "",
      model: typeof entry.model === "string" ? entry.model : "",
      createdAt: typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt) ? entry.createdAt : 0,
      updatedAt: typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0,
    });
  }

  async #persist(): Promise<void> {
    if (!this.#storagePath) {
      return;
    }
    try {
      await mkdir(dirname(this.#storagePath), { recursive: true });
      const payload: PersistedBackendsState = {
        activeBackend: this.#activeBackend,
        threads: [...this.#threads.values()].sort((left, right) => right.updatedAt - left.updatedAt),
      };
      await writeFile(this.#storagePath, JSON.stringify(payload, null, 2), "utf8");
    } catch {
      // Non-fatal metadata persistence failure.
    }
  }

  #emitChanged(): void {
    this.#onChanged?.(this.getSnapshot());
  }

  #attachClient(backend: ExternalAgentBackendId, client: ExternalBackendClient): void {
    const slot = this.#slots[backend];
    const onNotification = (raw: unknown) => {
      if (!isRecord(raw) || typeof raw.method !== "string") {
        return;
      }
      const payload = { method: raw.method, params: raw.params };
      const suppressForward = this.#observeNotification(backend, payload);
      if (!suppressForward) {
        this.#onNotification?.(payload);
      }
    };
    const onStatus = (raw: unknown) => {
      if (slot.client !== client || !isRecord(raw)) {
        return;
      }
      if (raw.state === "stopped" || raw.state === "error") {
        slot.client = null;
        slot.cleanup?.();
        slot.cleanup = null;
        slot.state = raw.state === "error" ? "error" : "disconnected";
        slot.lastError = typeof raw.message === "string" ? raw.message : null;
        for (const [threadId, entry] of this.#threads) {
          if (entry.backend === backend) {
            this.#notifyTurnIdle(threadId);
          }
        }
        this.#emitChanged();
      }
    };
    const onStderr = (raw: unknown) => {
      if (typeof raw === "string") {
        this.#onStderr?.(backend, raw);
      }
    };
    client.on("notification", onNotification);
    client.on("status", onStatus);
    client.on("stderr", onStderr);
    slot.client = client;
    slot.cleanup = () => {
      const detach = client.off?.bind(client) ?? client.removeListener?.bind(client);
      if (detach) {
        detach("notification", onNotification);
        detach("status", onStatus);
        detach("stderr", onStderr);
      }
    };
  }

  async #detachClient(backend: ExternalAgentBackendId, stopClient: boolean): Promise<void> {
    const slot = this.#slots[backend];
    const existing = slot.client;
    const cleanup = slot.cleanup;
    slot.client = null;
    slot.cleanup = null;
    cleanup?.();
    if (existing && stopClient) {
      await existing.stop().catch(() => undefined);
    }
  }

  async #interruptAndStartTurn(
    client: ExternalBackendClient,
    threadId: string,
    startParams: Record<string, unknown>,
    expectedTurnId?: string,
  ): Promise<unknown> {
    this.#steeringThreads.add(threadId);
    try {
      const idlePromise = this.#waitForTurnIdle(threadId, 12_000);
      await client.request("turn/interrupt", {
        threadId,
        ...(expectedTurnId ? { turnId: expectedTurnId } : {}),
      });
      await idlePromise;

      let lastError: unknown;
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          return await client.request("turn/start", startParams);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/already has an active turn/iu.test(message)) {
            throw error;
          }
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new Error("Antigravity did not finish cancelling the active turn.");
    } finally {
      this.#steeringThreads.delete(threadId);
    }
  }

  #waitForTurnIdle(threadId: string, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const set = this.#turnIdleWaiters.get(threadId);
        set?.delete(done);
        if (set && set.size === 0) {
          this.#turnIdleWaiters.delete(threadId);
        }
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      let set = this.#turnIdleWaiters.get(threadId);
      if (!set) {
        set = new Set();
        this.#turnIdleWaiters.set(threadId, set);
      }
      set.add(done);
    });
  }

  #notifyTurnIdle(threadId: string): void {
    const waiters = this.#turnIdleWaiters.get(threadId);
    if (!waiters || waiters.size === 0) {
      return;
    }
    this.#turnIdleWaiters.delete(threadId);
    for (const resolve of waiters) {
      resolve();
    }
  }

  #observeNotification(backend: ExternalAgentBackendId, payload: { method: string; params: unknown }): boolean {
    if (!isRecord(payload.params)) {
      return false;
    }
    const { method, params } = payload;
    if (
      (method === "thread/approvalRequested" || method === "thread/approval_requested") &&
      typeof params.approvalId === "string" &&
      params.approvalId
    ) {
      this.#approvalRoutes.set(params.approvalId, backend);
    } else if (
      (method === "thread/approvalResolved" || method === "thread/approval_resolved") &&
      typeof params.approvalId === "string"
    ) {
      this.#approvalRoutes.delete(params.approvalId);
    } else if (
      (method === "thread/userInputRequested" || method === "thread/user_input_requested") &&
      typeof params.requestId === "string" &&
      params.requestId
    ) {
      this.#userInputRoutes.set(params.requestId, backend);
    } else if (
      (method === "thread/userInputResolved" || method === "thread/user_input_resolved") &&
      typeof params.requestId === "string"
    ) {
      this.#userInputRoutes.delete(params.requestId);
    }

    const threadId = threadIdFromParams(params);
    if (threadId && method === "turn/completed") {
      this.#notifyTurnIdle(threadId);
    } else if (
      threadId &&
      method === "thread/status/changed" &&
      isRecord(params.status) &&
      params.status.type !== "running"
    ) {
      this.#notifyTurnIdle(threadId);
      if (this.#steeringThreads.has(threadId)) {
        return true;
      }
    }

    if (threadId && this.#threads.has(threadId) && (method === "turn/started" || method === "turn/completed")) {
      const saved = this.#threads.get(threadId);
      if (saved) {
        saved.updatedAt = Math.floor(Date.now() / 1000);
        void this.#persist();
      }
    }
    return false;
  }
}

function parseExternalBackend(value: unknown): ExternalAgentBackendId | null {
  if (value === "codex" || value === "antigravity" || value === "claude-code") {
    return value;
  }
  return null;
}

function stripAgentBackendField(params: unknown): Record<string, unknown> {
  if (!isRecord(params)) {
    return {};
  }
  const { agentBackend: _ignored, ...rest } = params;
  return rest;
}

function findProviderInsertIndex(providers: WireProvider[]): number {
  const preferredOrder = new Set(["claude-code", "codex"]);
  let lastPreferred = -1;
  for (let index = 0; index < providers.length; index += 1) {
    if (preferredOrder.has(normalizeId(providers[index]?.id))) {
      lastPreferred = index;
    }
  }
  return lastPreferred >= 0 ? lastPreferred + 1 : 0;
}

function savedThreadToRoderThread(saved: SavedExternalThread): RoderThread {
  return {
    id: saved.id,
    preview: saved.preview,
    agentBackend: saved.backend,
    modelProvider: saved.backend,
    model: saved.model,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
    status: {
      type: "idle",
      activeTurnId: null,
      activeFlags: [],
    },
    workspaceId: saved.workspaceId,
    rootId: saved.rootId,
    cwd: saved.cwd,
  };
}

function extractPromptPreview(params: Record<string, unknown>): string {
  if (typeof params.prompt === "string" && params.prompt.trim()) {
    return params.prompt.trim().slice(0, 140);
  }
  if (Array.isArray(params.input)) {
    const texts = params.input
      .filter((item): item is { type?: string; text?: string } => isRecord(item) && typeof item.text === "string")
      .map((item) => item.text?.trim() ?? "")
      .filter(Boolean);
    if (texts.length > 0) {
      return texts.join(" ").slice(0, 140);
    }
  }
  return "";
}

function threadIdFromParams(params: unknown): string | null {
  if (!isRecord(params)) {
    return null;
  }
  const value = params.threadId ?? params.thread_id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

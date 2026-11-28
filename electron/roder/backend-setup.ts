import { spawn, type ChildProcess } from "node:child_process";
import type { ExternalAgentBackendId } from "./desktop-backend";
import {
  cleanAntigravityEnv,
  installAntigravityRuntime,
  type AntigravityInstallProgress,
} from "./antigravity-installer";
import { findExternalBackendRuntime, runtimePathExtraEnv } from "./agent-backends";

export type BackendSetupPhase =
  | "idle"
  | "checking"
  | "downloading"
  | "extracting"
  | "verifying"
  | "awaiting-browser"
  | "awaiting-code"
  | "submitting-code"
  | "connecting"
  | "completed"
  | "error";

export type BackendSetupState = {
  backend: ExternalAgentBackendId | null;
  phase: BackendSetupPhase;
  message: string;
  authUrl?: string | null;
  downloadBytes?: number;
  downloadTotal?: number | null;
  error?: string | null;
};

export type BackendSetupControllerOptions = {
  resolveRoderBinary: () => string;
  findRuntime?: (backend: ExternalAgentBackendId) => string | null;
  installAntigravity?: (options: {
    signal?: AbortSignal;
    onProgress?: (progress: AntigravityInstallProgress) => void;
  }) => Promise<{ path: string; version: string }>;
  openExternal: (url: string) => Promise<void>;
  connectAndActivate: (backend: ExternalAgentBackendId) => Promise<{ connected: boolean; modelCount: number }>;
  probeExistingConnection: (backend: ExternalAgentBackendId) => Promise<{ connected: boolean; modelCount: number }>;
  spawnProcess?: typeof spawn;
  onStateChanged?: (state: BackendSetupState) => void;
  env?: NodeJS.ProcessEnv;
};

const IDLE_STATE: BackendSetupState = {
  backend: null,
  phase: "idle",
  message: "",
  authUrl: null,
  error: null,
};

const OAUTH_URL_PATTERN = /https:\/\/[^\s"'<>]+/gu;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

export function extractAuthUrl(text: string): string | null {
  const matches = text.match(OAUTH_URL_PATTERN);
  if (!matches) {
    return null;
  }
  for (const candidate of matches) {
    const cleaned = candidate.replace(/[.,);]+$/u, "");
    try {
      const parsed = new URL(cleaned);
      if (parsed.protocol === "https:") {
        return parsed.toString();
      }
    } catch {
      // Ignore malformed fragments.
    }
  }
  return null;
}

export class BackendSetupController {
  readonly #resolveRoderBinary: () => string;
  readonly #findRuntime: (backend: ExternalAgentBackendId) => string | null;
  readonly #installAntigravity: (options: {
    signal?: AbortSignal;
    onProgress?: (progress: AntigravityInstallProgress) => void;
  }) => Promise<{ path: string; version: string }>;
  readonly #openExternal: (url: string) => Promise<void>;
  readonly #connectAndActivate: (
    backend: ExternalAgentBackendId,
  ) => Promise<{ connected: boolean; modelCount: number }>;
  readonly #probeExistingConnection: (
    backend: ExternalAgentBackendId,
  ) => Promise<{ connected: boolean; modelCount: number }>;
  readonly #spawn: typeof spawn;
  readonly #onStateChanged?: (state: BackendSetupState) => void;
  readonly #env: NodeJS.ProcessEnv;

  #state: BackendSetupState = IDLE_STATE;
  #abortController: AbortController | null = null;
  #loginChild: ChildProcess | null = null;
  #loginTimer: ReturnType<typeof setTimeout> | null = null;
  #generation = 0;

  constructor(options: BackendSetupControllerOptions) {
    this.#resolveRoderBinary = options.resolveRoderBinary;
    this.#findRuntime = options.findRuntime ?? ((backend) => findExternalBackendRuntime(backend));
    this.#installAntigravity =
      options.installAntigravity ??
      ((installOptions) =>
        installAntigravityRuntime({
          env: options.env ?? process.env,
          signal: installOptions.signal,
          onProgress: installOptions.onProgress,
        }));
    this.#openExternal = options.openExternal;
    this.#connectAndActivate = options.connectAndActivate;
    this.#probeExistingConnection = options.probeExistingConnection;
    this.#spawn = options.spawnProcess ?? spawn;
    this.#onStateChanged = options.onStateChanged;
    this.#env = options.env ?? process.env;
  }

  getState(): BackendSetupState {
    return this.#state;
  }

  async start(backend: ExternalAgentBackendId, options: { forceInstall?: boolean } = {}): Promise<BackendSetupState> {
    this.#cancelInternal(false);
    const generation = ++this.#generation;
    const abortController = new AbortController();
    this.#abortController = abortController;

    if (backend === "codex") {
      const runtimePath = this.#findRuntime("codex");
      if (!runtimePath) {
        const error =
          "Codex CLI (`codex`) was not found on this machine. Install it with `npm i -g @openai/codex`, then check again.";
        this.#setState({
          backend: "codex",
          phase: "error",
          message: error,
          authUrl: null,
          error,
        });
        return this.#state;
      }
      this.#setState({
        backend: "codex",
        phase: "checking",
        message: "Checking existing Codex CLI sign-in...",
        authUrl: null,
        error: null,
      });
      void this.#startCodex(generation, runtimePath).catch((err: unknown) => {
        if (this.#generation !== generation) return;
        const message = err instanceof Error ? err.message : String(err);
        this.#setState({
          backend: "codex",
          phase: "error",
          message,
          authUrl: null,
          error: message,
        });
      });
      return this.#state;
    }

    this.#setState({
      backend: "antigravity",
      phase: "checking",
      message: options.forceInstall ? "Preparing Antigravity CLI installation..." : "Checking Antigravity CLI...",
      authUrl: null,
      error: null,
    });
    void this.#startAntigravity(generation, abortController.signal, Boolean(options.forceInstall)).catch(
      (err: unknown) => {
        if (this.#generation !== generation) return;
        const message = err instanceof Error ? err.message : String(err);
        this.#setState({
          backend: "antigravity",
          phase: "error",
          message,
          authUrl: null,
          error: message,
        });
      },
    );
    return this.#state;
  }

  async submitCode(code: string): Promise<BackendSetupState> {
    const trimmed = code.trim();
    if (!trimmed) {
      throw new Error("Paste the Google authorization code or callback URL first.");
    }
    if (!this.#loginChild || !this.#loginChild.stdin || this.#state.backend !== "antigravity") {
      throw new Error("No Antigravity sign-in is waiting for a code. Start Google sign-in again.");
    }
    this.#setState({
      ...this.#state,
      phase: "submitting-code",
      message: "Completing Google sign-in...",
      error: null,
    });
    this.#loginChild.stdin.write(`${trimmed}\n`);
    return this.#state;
  }

  cancel(): BackendSetupState {
    this.#cancelInternal(true);
    return this.#state;
  }

  stop(): void {
    this.#cancelInternal(false);
  }

  async #startAntigravity(generation: number, signal: AbortSignal, forceInstall: boolean): Promise<BackendSetupState> {
    let runtimePath = this.#findRuntime("antigravity");

    if (!runtimePath || forceInstall) {
      this.#setState({
        backend: "antigravity",
        phase: "checking",
        message: "Preparing Antigravity CLI installation...",
        authUrl: null,
        error: null,
      });
      try {
        const installed = await this.#installAntigravity({
          signal,
          onProgress: (progress) => {
            if (this.#generation !== generation) return;
            if (progress.phase === "downloading") {
              this.#setState({
                backend: "antigravity",
                phase: "downloading",
                message: progress.message,
                downloadBytes: progress.bytes,
                downloadTotal: progress.total,
                authUrl: null,
                error: null,
              });
            } else if (progress.phase === "extracting" || progress.phase === "verifying") {
              this.#setState({
                backend: "antigravity",
                phase: progress.phase,
                message: progress.message,
                authUrl: null,
                error: null,
              });
            } else if (progress.phase === "manifest") {
              this.#setState({
                backend: "antigravity",
                phase: "checking",
                message: progress.message,
                authUrl: null,
                error: null,
              });
            }
          },
        });
        if (this.#generation !== generation) return this.#state;
        runtimePath = installed.path;
      } catch (error) {
        if (this.#generation !== generation) return this.#state;
        const message = signal.aborted
          ? "Antigravity installation was cancelled."
          : error instanceof Error
            ? error.message
            : String(error);
        this.#setState({
          backend: "antigravity",
          phase: signal.aborted ? "idle" : "error",
          message: signal.aborted ? "" : message,
          authUrl: null,
          error: signal.aborted ? null : message,
        });
        return this.#state;
      }
    }

    // Check if this machine already has a valid Antigravity Google session before launching OAuth.
    this.#setState({
      backend: "antigravity",
      phase: "checking",
      message: "Checking existing Antigravity sign-in...",
      authUrl: null,
      error: null,
    });
    try {
      const existing = await this.#probeExistingConnection("antigravity");
      if (this.#generation !== generation) return this.#state;
      if (existing.connected) {
        await this.#connectAndActivate("antigravity");
        if (this.#generation !== generation) return this.#state;
        this.#setState({
          backend: "antigravity",
          phase: "completed",
          message: `Antigravity ready (${existing.modelCount} ${existing.modelCount === 1 ? "model" : "models"}).`,
          authUrl: null,
          error: null,
        });
        return this.#state;
      }
    } catch {
      // Not signed in yet — proceed directly to native Google OAuth sign-in.
    }

    if (this.#generation !== generation) return this.#state;

    const roderBinary = this.#resolveRoderBinary();
    const env: NodeJS.ProcessEnv = {
      ...cleanAntigravityEnv(this.#env),
      ...runtimePathExtraEnv(this.#env, runtimePath),
      BROWSER: "false",
      RODER_DESKTOP: "1",
    };

    this.#setState({
      backend: "antigravity",
      phase: "checking",
      message: "Starting Google sign-in...",
      authUrl: null,
      error: null,
    });

    const child = this.#spawn(roderBinary, ["auth", "login", "antigravity"], {
      cwd: process.cwd(),
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#loginChild = child;
    this.#armLoginTimeout(generation, "antigravity");

    let combinedOutput = "";
    let openedUrl = false;

    const onOutput = (chunk: Buffer | string) => {
      if (this.#generation !== generation) return;
      combinedOutput += chunk.toString();
      if (!openedUrl) {
        const url = extractAuthUrl(combinedOutput);
        if (url) {
          openedUrl = true;
          this.#setState({
            backend: "antigravity",
            phase: "awaiting-code",
            message:
              "Finish signing in with Google in your browser, then paste the authorization code or callback URL below.",
            authUrl: url,
            error: null,
          });
          void this.#openExternal(url).catch(() => undefined);
        }
      }
    };

    child.stdout?.on("data", onOutput);
    child.stderr?.on("data", onOutput);

    child.once("error", (error) => {
      if (this.#generation !== generation) return;
      this.#clearLoginProcess();
      this.#setState({
        backend: "antigravity",
        phase: "error",
        message: error.message,
        authUrl: null,
        error: error.message,
      });
    });

    child.once("exit", (code) => {
      if (this.#generation !== generation) return;
      this.#clearLoginProcess();
      if (code === 0) {
        void this.#finishConnection(generation, "antigravity");
        return;
      }
      const cleanMessage = summarizeLoginError(
        combinedOutput,
        "Antigravity Google sign-in did not complete. Try again.",
      );
      this.#setState({
        backend: "antigravity",
        phase: "error",
        message: cleanMessage,
        authUrl: this.#state.authUrl ?? null,
        error: cleanMessage,
      });
    });

    return this.#state;
  }

  async #startCodex(generation: number, runtimePath: string): Promise<BackendSetupState> {
    try {
      const existing = await this.#probeExistingConnection("codex");
      if (this.#generation !== generation) return this.#state;
      if (existing.connected) {
        await this.#connectAndActivate("codex");
        if (this.#generation !== generation) return this.#state;
        this.#setState({
          backend: "codex",
          phase: "completed",
          message: `Codex ready (${existing.modelCount} ${existing.modelCount === 1 ? "model" : "models"}).`,
          authUrl: null,
          error: null,
        });
        return this.#state;
      }
    } catch {
      // Not signed in yet — proceed to browser login.
    }

    if (this.#generation !== generation) return this.#state;

    const env: NodeJS.ProcessEnv = {
      ...this.#env,
      ...runtimePathExtraEnv(this.#env, runtimePath),
      RODER_DESKTOP: "1",
    };

    const child = this.#spawn(runtimePath, ["login"], {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.#loginChild = child;
    this.#armLoginTimeout(generation, "codex");

    this.#setState({
      backend: "codex",
      phase: "awaiting-browser",
      message: "Finish signing in with ChatGPT in your browser. This card updates automatically when you're done.",
      authUrl: null,
      error: null,
    });

    let combinedOutput = "";
    const onOutput = (chunk: Buffer | string) => {
      if (this.#generation !== generation) return;
      combinedOutput += chunk.toString();
      if (!this.#state.authUrl) {
        const url = extractAuthUrl(combinedOutput);
        if (url) {
          this.#setState({
            ...this.#state,
            authUrl: url,
          });
        }
      }
    };

    child.stdout?.on("data", onOutput);
    child.stderr?.on("data", onOutput);

    child.once("error", (error) => {
      if (this.#generation !== generation) return;
      this.#clearLoginProcess();
      this.#setState({
        backend: "codex",
        phase: "error",
        message: error.message,
        authUrl: null,
        error: error.message,
      });
    });

    child.once("exit", (code) => {
      if (this.#generation !== generation) return;
      this.#clearLoginProcess();
      if (code === 0) {
        void this.#finishConnection(generation, "codex");
        return;
      }
      const cleanMessage = summarizeLoginError(combinedOutput, "Codex sign-in did not complete. Try again.");
      this.#setState({
        backend: "codex",
        phase: "error",
        message: cleanMessage,
        authUrl: this.#state.authUrl ?? null,
        error: cleanMessage,
      });
    });

    return this.#state;
  }

  async #finishConnection(generation: number, backend: ExternalAgentBackendId): Promise<void> {
    const label = backend === "codex" ? "Codex" : "Antigravity";
    this.#setState({
      backend,
      phase: "connecting",
      message: `Loading ${label} models...`,
      authUrl: null,
      error: null,
    });
    try {
      const result = await this.#connectAndActivate(backend);
      if (this.#generation !== generation) return;
      if (!result.connected) {
        throw new Error(`${label} sign-in completed, but no models were returned. Try checking connection again.`);
      }
      this.#setState({
        backend,
        phase: "completed",
        message: `${label} connected (${result.modelCount} ${result.modelCount === 1 ? "model" : "models"}).`,
        authUrl: null,
        error: null,
      });
    } catch (error) {
      if (this.#generation !== generation) return;
      const message = error instanceof Error ? error.message : String(error);
      this.#setState({
        backend,
        phase: "error",
        message,
        authUrl: null,
        error: message,
      });
    }
  }

  #armLoginTimeout(generation: number, backend: ExternalAgentBackendId): void {
    if (this.#loginTimer) {
      clearTimeout(this.#loginTimer);
    }
    this.#loginTimer = setTimeout(() => {
      if (this.#generation !== generation) return;
      this.#clearLoginProcess();
      const label = backend === "codex" ? "Codex" : "Antigravity";
      const message = `${label} sign-in timed out. Try again.`;
      this.#setState({
        backend,
        phase: "error",
        message,
        authUrl: null,
        error: message,
      });
    }, LOGIN_TIMEOUT_MS);
  }

  #clearLoginProcess(): void {
    if (this.#loginTimer) {
      clearTimeout(this.#loginTimer);
      this.#loginTimer = null;
    }
    const child = this.#loginChild;
    this.#loginChild = null;
    if (child && child.exitCode === null) {
      child.kill();
    }
  }

  #cancelInternal(notify: boolean): void {
    this.#generation += 1;
    this.#abortController?.abort();
    this.#abortController = null;
    this.#clearLoginProcess();
    this.#state = IDLE_STATE;
    if (notify) {
      this.#onStateChanged?.(this.#state);
    }
  }

  #setState(next: BackendSetupState): void {
    this.#state = next;
    this.#onStateChanged?.(next);
  }
}

function summarizeLoginError(output: string, fallback: string): string {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("http://") && !line.startsWith("https://"));
  const errorLine = [...lines].reverse().find((line) => /error|fail|invalid|denied|cancel|expired/iu.test(line));
  return errorLine ? errorLine.slice(0, 240) : fallback;
}

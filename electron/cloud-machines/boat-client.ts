import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BOAT_API_BASE, type BoatOAuthUserProfile } from "./boat-oauth";

export type BoatSandboxSize = "small" | "default" | "large" | "xlarge";

export type BoatSandboxSummary = {
  id: string;
  name: string;
  state: string;
  url: string | null;
  ip: string | null;
  desktopAvailable: boolean;
  desktopUrl: string | null;
  snapshotAvailable: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  archiveAfter: string | null;
};

export type BoatCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  processId?: string;
  commandId?: string;
};

export type BoatFileEntry = {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  mode: string;
  modifiedAt: string | null;
};

export type BoatHostedPort = {
  port: number;
  url: string;
  isProtected: boolean;
  access: string;
  localhost: boolean;
};

export type BoatSshKeyResult = {
  machineIp: string;
  sshHost: string;
  sshPort: number;
  sshEndpoint: string | null;
  sshUser: string;
};

export type BoatMachineTargetConfig = {
  sandboxId: string;
  sandboxName?: string;
  tailscaleTunnel?: boolean;
};

export type BoatClientOptions = {
  apiBase?: string;
  fetchImpl?: typeof fetch;
  getAccessToken: (options?: { forceRefresh?: boolean }) => Promise<string | null>;
  sshKeyDir?: string;
};

const SANDBOX_CACHE_TTL_MS = 30_000;
const READY_POLL_INTERVAL_MS = 1_000;
const READY_TIMEOUT_MS = 90_000;
const SANDBOX_ID_PATTERN = /^bx_[a-z0-9]{4,32}$/iu;

type CachedBoatSandbox = {
  sandbox: BoatSandboxSummary;
  expiresAt: number;
};

export function boatSandboxIdFromConfig(config: Record<string, unknown> | undefined): string {
  if (!config) return "";
  const candidate = config.sandbox_id ?? config.sandboxId ?? config.boat_sandbox_id ?? config.id;
  return typeof candidate === "string" ? candidate.trim() : "";
}

export function boatSandboxNameFromConfig(config: Record<string, unknown> | undefined): string {
  if (!config) return "";
  const candidate = config.sandbox_name ?? config.sandboxName ?? config.machine_name ?? config.name;
  return typeof candidate === "string" ? candidate.trim() : "";
}

export function parseBoatMachineConfig(config: Record<string, unknown>): BoatMachineTargetConfig {
  const sandboxId = boatSandboxIdFromConfig(config);
  if (!sandboxId || !SANDBOX_ID_PATTERN.test(sandboxId)) {
    throw new Error('Boat sandbox configuration requires a valid sandbox_id (e.g. "bx_23456789").');
  }
  const sandboxName = boatSandboxNameFromConfig(config) || undefined;
  const tailscaleTunnel = typeof config.tailscale_tunnel === "boolean" ? config.tailscale_tunnel : undefined;
  return {
    sandboxId,
    ...(sandboxName ? { sandboxName } : {}),
    ...(tailscaleTunnel !== undefined ? { tailscaleTunnel } : {}),
  };
}

export function isBoatSandboxReadyState(state: string): boolean {
  const normalized = state.trim().toLowerCase();
  return normalized === "idle" || normalized === "running" || normalized === "active" || normalized === "ready";
}

export function isBoatSandboxStartingState(state: string): boolean {
  const normalized = state.trim().toLowerCase();
  return (
    normalized === "cloning" ||
    normalized === "provisioning" ||
    normalized === "starting" ||
    normalized === "booting" ||
    normalized === "resuming" ||
    normalized === "creating" ||
    normalized === "pending" ||
    normalized === "queued" ||
    normalized === "restoring" ||
    normalized === "waking" ||
    normalized === "hydrating" ||
    normalized === "initializing" ||
    normalized === "preparing"
  );
}

export function isBoatSandboxStoppedState(state: string): boolean {
  const normalized = state.trim().toLowerCase();
  return (
    normalized === "stopped" || normalized === "archived" || normalized === "stopping" || normalized === "archiving"
  );
}

export class BoatClient {
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;
  private readonly getAccessToken: (options?: { forceRefresh?: boolean }) => Promise<string | null>;
  private readonly sshKeyDir: string | undefined;
  private readonly sandboxCache = new Map<string, CachedBoatSandbox>();
  private sshKeyPairPromise: Promise<{ privateKeyPath: string; publicKey: string }> | null = null;

  constructor(options: BoatClientOptions) {
    this.apiBase = (options.apiBase ?? BOAT_API_BASE).replace(/\/+$/u, "");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.getAccessToken = options.getAccessToken;
    this.sshKeyDir = options.sshKeyDir;
  }

  clearCache(): void {
    this.sandboxCache.clear();
  }

  async getMe(): Promise<BoatOAuthUserProfile> {
    const response = await this.authedFetch("/me", { method: "GET" });
    if (!response.ok) {
      throw new Error(await formatBoatApiError("Could not read Boat user profile", response));
    }
    const body = (await response.json()) as { user?: Record<string, unknown> };
    const user = body?.user && typeof body.user === "object" ? body.user : {};
    return {
      id: typeof user.id === "string" && user.id.trim() ? user.id.trim() : null,
      login: typeof user.login === "string" && user.login.trim() ? user.login.trim() : null,
      displayName: typeof user.displayName === "string" && user.displayName.trim() ? user.displayName.trim() : null,
      email: typeof user.email === "string" && user.email.trim() ? user.email.trim() : null,
    };
  }

  async listSandboxes(): Promise<BoatSandboxSummary[]> {
    const response = await this.authedFetch("/sandboxes?limit=100", { method: "GET" });
    if (!response.ok) {
      throw new Error(await formatBoatApiError("Could not list Boat sandboxes", response));
    }
    const body = (await response.json()) as { sandboxes?: unknown };
    if (!Array.isArray(body?.sandboxes)) return [];
    const sandboxes = body.sandboxes
      .map((entry) => parseBoatSandboxSummary(entry))
      .filter((entry): entry is BoatSandboxSummary => entry !== null)
      .toSorted(
        (left, right) =>
          (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") || left.name.localeCompare(right.name),
      );
    const now = Date.now();
    for (const sandbox of sandboxes) {
      this.sandboxCache.set(sandbox.id, { sandbox, expiresAt: now + SANDBOX_CACHE_TTL_MS });
    }
    return sandboxes;
  }

  async getSandbox(sandboxId: string, options: { bypassCache?: boolean } = {}): Promise<BoatSandboxSummary> {
    if (!options.bypassCache) {
      const cached = this.sandboxCache.get(sandboxId);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.sandbox;
      }
    }
    const response = await this.authedFetch(`/sandboxes/${encodeURIComponent(sandboxId)}`, { method: "GET" });
    if (!response.ok) {
      throw new Error(await formatBoatApiError(`Could not reach Boat sandbox "${sandboxId}"`, response));
    }
    const body = (await response.json()) as { sandbox?: unknown };
    const parsed = parseBoatSandboxSummary(body?.sandbox ?? body);
    if (!parsed) {
      throw new Error(`Boat sandbox "${sandboxId}" returned an unexpected payload.`);
    }
    this.sandboxCache.set(parsed.id, { sandbox: parsed, expiresAt: Date.now() + SANDBOX_CACHE_TTL_MS });
    return parsed;
  }

  async createSandbox(
    input: {
      name?: string;
      type?: BoatSandboxSize;
      environment?: string;
      workingDir?: string;
    } = {},
  ): Promise<BoatSandboxSummary> {
    const size: BoatSandboxSize =
      input.type === "small" || input.type === "large" || input.type === "xlarge" ? input.type : "default";
    const payload: Record<string, unknown> = {
      type: size,
      ...(input.environment?.trim() ? { environment: input.environment.trim() } : {}),
    };
    const response = await this.authedFetch("/sandboxes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await formatBoatApiError("Could not create Boat sandbox", response));
    }
    const body = (await response.json()) as { sandbox?: unknown };
    let sandbox = parseBoatSandboxSummary(body?.sandbox ?? body);
    if (!sandbox) {
      throw new Error("Boat did not return metadata for the new sandbox.");
    }

    if (input.name?.trim()) {
      const renamed = await this.updateSandbox(sandbox.id, { name: input.name.trim() }).catch(() => null);
      if (renamed) {
        sandbox = renamed;
      }
    }

    sandbox = await this.waitUntilReady(sandbox.id, sandbox);

    const targetDir = input.workingDir?.trim();
    if (targetDir && targetDir.startsWith("/") && targetDir !== "/home/user") {
      await this.execCommand(sandbox.id, {
        command: `mkdir -p ${shellQuotePosixBoat(targetDir)}`,
        timeoutSeconds: 30,
      }).catch(() => undefined);
    }

    return sandbox;
  }

  async updateSandbox(sandboxId: string, patch: { name?: string }): Promise<BoatSandboxSummary> {
    const response = await this.authedFetch(`/sandboxes/${encodeURIComponent(sandboxId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      throw new Error(await formatBoatApiError(`Could not update Boat sandbox "${sandboxId}"`, response));
    }
    const body = (await response.json()) as { sandbox?: unknown };
    const parsed = parseBoatSandboxSummary(body?.sandbox ?? body);
    if (!parsed) {
      throw new Error(`Boat sandbox "${sandboxId}" update returned an unexpected payload.`);
    }
    this.sandboxCache.set(parsed.id, { sandbox: parsed, expiresAt: Date.now() + SANDBOX_CACHE_TTL_MS });
    return parsed;
  }

  async resumeSandbox(sandboxId: string): Promise<BoatSandboxSummary> {
    const response = await this.authedFetch(`/sandboxes/${encodeURIComponent(sandboxId)}/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      throw new Error(await formatBoatApiError(`Could not resume Boat sandbox "${sandboxId}"`, response));
    }
    const body = (await response.json()) as { sandbox?: unknown };
    const initial = parseBoatSandboxSummary(body?.sandbox);
    return this.waitUntilReady(sandboxId, initial ?? undefined);
  }

  async stopSandbox(sandboxId: string): Promise<void> {
    const response = await this.authedFetch(`/sandboxes/${encodeURIComponent(sandboxId)}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      throw new Error(await formatBoatApiError(`Could not stop Boat sandbox "${sandboxId}"`, response));
    }
    this.sandboxCache.delete(sandboxId);
  }

  async ensureRunning(sandboxId: string): Promise<BoatSandboxSummary> {
    const current = await this.getSandbox(sandboxId, { bypassCache: true });
    if (isBoatSandboxReadyState(current.state)) {
      return current;
    }
    if (isBoatSandboxStartingState(current.state)) {
      return this.waitUntilReady(sandboxId, current);
    }
    if (isBoatSandboxStoppedState(current.state)) {
      const normalized = current.state.trim().toLowerCase();
      if (normalized === "stopping" || normalized === "archiving") {
        const deadline = Date.now() + 30_000;
        let latest = current;
        while (
          (latest.state.trim().toLowerCase() === "stopping" || latest.state.trim().toLowerCase() === "archiving") &&
          Date.now() < deadline
        ) {
          await delay(READY_POLL_INTERVAL_MS);
          latest = await this.getSandbox(sandboxId, { bypassCache: true });
          if (isBoatSandboxReadyState(latest.state)) {
            return latest;
          }
        }
      }
      return this.resumeSandbox(sandboxId);
    }
    throw new Error(`Boat sandbox "${sandboxId}" is in state "${current.state}" and cannot run commands right now.`);
  }

  async execCommand(
    sandboxId: string,
    input: {
      command: string;
      cwd?: string;
      timeoutSeconds?: number;
      detached?: boolean;
    },
  ): Promise<BoatCommandResult> {
    const timeoutSeconds = Math.max(1, Math.min(600, Math.round(input.timeoutSeconds ?? 60)));
    const payload: Record<string, unknown> = {
      command: input.command,
      timeoutSeconds,
      ...(input.detached ? { detached: true } : {}),
    };
    if (input.cwd && !input.cwd.startsWith("/")) {
      payload.cwd = input.cwd;
    }
    const response = await this.authedFetch(`/sandboxes/${encodeURIComponent(sandboxId)}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await formatBoatApiError("Boat command execution failed", response));
    }
    const body = (await response.json()) as Record<string, unknown>;
    if (input.detached) {
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        processId: typeof body.processId === "string" ? body.processId : undefined,
      };
    }
    return {
      exitCode: typeof body.exitCode === "number" ? body.exitCode : body.success === false ? 1 : 0,
      stdout: typeof body.stdout === "string" ? body.stdout : "",
      stderr: typeof body.stderr === "string" ? body.stderr : "",
      timedOut: Boolean(body.timedOut),
      commandId: typeof body.commandId === "string" ? body.commandId : undefined,
    };
  }

  async cancelCommand(sandboxId: string, processId: string): Promise<boolean> {
    const response = await this.authedFetch(
      `/sandboxes/${encodeURIComponent(sandboxId)}/commands/${encodeURIComponent(processId)}`,
      { method: "DELETE" },
    );
    return response.ok;
  }

  async readFile(sandboxId: string, absPath: string): Promise<Buffer> {
    if (isBoatDirectFilePath(absPath)) {
      const response = await this.authedFetch(
        `/sandboxes/${encodeURIComponent(sandboxId)}/files?path=${encodeURIComponent(absPath)}&encoding=base64`,
        { method: "GET" },
      );
      if (response.ok) {
        const body = (await response.json()) as { content?: unknown; encoding?: unknown };
        if (typeof body.content === "string") {
          return body.encoding === "base64" ? Buffer.from(body.content, "base64") : Buffer.from(body.content, "utf8");
        }
      }
      if (response.status === 404) {
        throw new Error(`Remote file "${absPath}" not found.`);
      }
    }
    const proc = await this.execCommand(sandboxId, {
      command: `base64 -- ${shellQuotePosixBoat(absPath)} | tr -d '\\r\\n'`,
      timeoutSeconds: 30,
    });
    if (proc.exitCode !== 0) {
      throw new Error(proc.stderr.trim() || `Could not read remote file "${absPath}".`);
    }
    return Buffer.from(proc.stdout.trim(), "base64");
  }

  async writeFile(sandboxId: string, absPath: string, bytes: Buffer): Promise<void> {
    if (isBoatDirectFilePath(absPath) && bytes.length <= 4 * 1024 * 1024) {
      const response = await this.authedFetch(`/sandboxes/${encodeURIComponent(sandboxId)}/files`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: absPath,
          content: bytes.toString("base64"),
          encoding: "base64",
        }),
      });
      if (response.ok) {
        return;
      }
      throw new Error(await formatBoatApiError(`Could not write remote file "${absPath}"`, response));
    }
    const b64 = bytes.toString("base64");
    const proc = await this.execCommand(sandboxId, {
      command: `mkdir -p -- $(dirname ${shellQuotePosixBoat(absPath)}) && printf %s ${shellQuotePosixBoat(b64)} | base64 -d > ${shellQuotePosixBoat(absPath)}`,
      timeoutSeconds: 60,
    });
    if (proc.exitCode !== 0) {
      throw new Error(proc.stderr.trim() || `Could not write remote file "${absPath}".`);
    }
  }

  async listDirectory(sandboxId: string, absPath: string): Promise<BoatFileEntry[]> {
    const response = await this.authedFetch(
      `/sandboxes/${encodeURIComponent(sandboxId)}/files/list?path=${encodeURIComponent(absPath)}`,
      { method: "GET" },
    );
    if (!response.ok) {
      throw new Error(await formatBoatApiError(`Could not list remote directory "${absPath}"`, response));
    }
    const body = (await response.json()) as { files?: unknown };
    if (!Array.isArray(body?.files)) return [];
    return body.files.flatMap((entry): BoatFileEntry[] => {
      if (!entry || typeof entry !== "object") return [];
      const rec = entry as Record<string, unknown>;
      const name = typeof rec.name === "string" ? rec.name : "";
      if (!name) return [];
      return [
        {
          name,
          path: typeof rec.path === "string" && rec.path ? rec.path : `${absPath.replace(/\/+$/u, "")}/${name}`,
          isDir: Boolean(rec.isDir),
          isSymlink: Boolean(rec.isSymlink),
          size: typeof rec.size === "number" ? rec.size : 0,
          mode: typeof rec.mode === "string" ? rec.mode : "",
          modifiedAt: typeof rec.modifiedAt === "string" ? rec.modifiedAt : null,
        },
      ];
    });
  }

  async hostPort(
    sandboxId: string,
    port: number,
    options: { public?: boolean; localhost?: boolean; title?: string } = {},
  ): Promise<BoatHostedPort> {
    const requestHost = async (localhost: boolean) =>
      this.authedFetch(`/sandboxes/${encodeURIComponent(sandboxId)}/host`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          port,
          public: options.public ?? true,
          localhost,
          ...(options.title ? { title: options.title } : {}),
        }),
      });

    let requestedLocalhost = options.localhost ?? true;
    let response = await requestHost(requestedLocalhost);
    if (!response.ok && requestedLocalhost && response.status >= 500) {
      const errorText = await formatBoatApiError(
        `Could not expose port ${port} on Boat sandbox "${sandboxId}"`,
        response,
      );
      if (/relay.*localhost|0\.0\.0\.0/iu.test(errorText)) {
        requestedLocalhost = false;
        response = await requestHost(false);
      } else {
        throw new Error(errorText);
      }
    }
    if (!response.ok) {
      throw new Error(
        await formatBoatApiError(`Could not expose port ${port} on Boat sandbox "${sandboxId}"`, response),
      );
    }
    const body = (await response.json()) as Record<string, unknown>;
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) {
      throw new Error(`Boat did not return a hosted URL for port ${port}.`);
    }
    return {
      port: typeof body.port === "number" ? body.port : port,
      url,
      isProtected: Boolean(body.isProtected),
      access: typeof body.access === "string" ? body.access : options.public === false ? "private" : "public",
      localhost: Boolean(body.localhost ?? requestedLocalhost),
    };
  }

  async configureSshKey(sandboxId: string, publicKey: string): Promise<BoatSshKeyResult> {
    const response = await this.authedFetch(`/sandboxes/${encodeURIComponent(sandboxId)}/sshkey`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: publicKey.trim() }),
    });
    if (!response.ok) {
      throw new Error(await formatBoatApiError(`Could not authorize SSH key on Boat sandbox "${sandboxId}"`, response));
    }
    const body = (await response.json()) as Record<string, unknown>;
    const machineIp = typeof body.machineIp === "string" ? body.machineIp.trim() : "";
    const sshEndpoint =
      typeof body.sshEndpoint === "string" && body.sshEndpoint.trim() ? body.sshEndpoint.trim() : null;
    const parsedEndpoint = sshEndpoint ? parseBoatSshEndpoint(sshEndpoint) : null;
    const sshHost = parsedEndpoint?.host || machineIp;
    const sshPort = parsedEndpoint?.port ?? 22;
    if (!sshHost) {
      throw new Error(`Boat did not return an SSH host address for sandbox "${sandboxId}".`);
    }
    return {
      machineIp: machineIp || sshHost,
      sshHost,
      sshPort,
      sshEndpoint,
      sshUser: typeof body.sshUser === "string" && body.sshUser.trim() ? body.sshUser.trim() : "user",
    };
  }

  async ensureDesktopSshKeypair(): Promise<{ privateKeyPath: string; publicKey: string }> {
    if (!this.sshKeyDir) {
      throw new Error("Boat SSH key storage directory is not configured.");
    }
    if (this.sshKeyPairPromise) {
      return this.sshKeyPairPromise;
    }
    const dir = this.sshKeyDir;
    this.sshKeyPairPromise = (async () => {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const privateKeyPath = join(dir, "boat_ed25519");
      const publicKeyPath = `${privateKeyPath}.pub`;
      const hasBoth = await Promise.all([
        stat(privateKeyPath)
          .then((info) => info.isFile() && info.size > 0)
          .catch(() => false),
        stat(publicKeyPath)
          .then((info) => info.isFile() && info.size > 0)
          .catch(() => false),
      ]);
      if (!hasBoth[0] || !hasBoth[1]) {
        await mkdir(dirname(privateKeyPath), { recursive: true, mode: 0o700 });
        await runSshKeygen(privateKeyPath);
        await chmod(privateKeyPath, 0o600).catch(() => undefined);
      }
      const publicKey = (await readFile(publicKeyPath, "utf8")).trim();
      if (!publicKey) {
        throw new Error("Generated Boat SSH public key was empty.");
      }
      return { privateKeyPath, publicKey };
    })().catch((error) => {
      this.sshKeyPairPromise = null;
      throw error;
    });
    return this.sshKeyPairPromise;
  }

  private async waitUntilReady(sandboxId: string, initial?: BoatSandboxSummary): Promise<BoatSandboxSummary> {
    let sandbox = initial ?? (await this.getSandbox(sandboxId, { bypassCache: true }));
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (!isBoatSandboxReadyState(sandbox.state) && Date.now() < deadline) {
      if (!isBoatSandboxStartingState(sandbox.state)) {
        break;
      }
      await delay(READY_POLL_INTERVAL_MS);
      sandbox = await this.getSandbox(sandboxId, { bypassCache: true });
    }
    if (!isBoatSandboxReadyState(sandbox.state)) {
      throw new Error(`Boat sandbox "${sandboxId}" did not become ready (current state: ${sandbox.state}).`);
    }
    return sandbox;
  }

  private async authedFetch(path: string, init: RequestInit): Promise<Response> {
    const token = await this.getAccessToken({ forceRefresh: false });
    if (!token) {
      throw new Error("Sign in with Boat in Settings > Cloud Machines first.");
    }
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${token}`,
    };
    const response = await this.fetchImpl(`${this.apiBase}${path}`, { ...init, headers });
    if (response.status === 401) {
      const refreshedToken = await this.getAccessToken({ forceRefresh: true }).catch(() => null);
      if (refreshedToken && refreshedToken !== token) {
        return this.fetchImpl(`${this.apiBase}${path}`, {
          ...init,
          headers: { ...headers, Authorization: `Bearer ${refreshedToken}` },
        });
      }
    }
    return response;
  }
}

function parseBoatSshEndpoint(endpoint: string): { host: string; port: number } | null {
  const trimmed = endpoint.trim();
  if (!trimmed) return null;
  const bracketed = /^\[([^\]]+)\]:(\d+)$/u.exec(trimmed);
  if (bracketed) {
    const port = Number.parseInt(bracketed[2], 10);
    return port >= 1 && port <= 65535 ? { host: bracketed[1], port } : null;
  }
  const lastColon = trimmed.lastIndexOf(":");
  if (lastColon > 0 && trimmed.indexOf(":") === lastColon) {
    const host = trimmed.slice(0, lastColon).trim();
    const port = Number.parseInt(trimmed.slice(lastColon + 1), 10);
    if (host && port >= 1 && port <= 65535) {
      return { host, port };
    }
  }
  return { host: trimmed, port: 22 };
}

function isBoatDirectFilePath(absPath: string): boolean {
  return (
    absPath === "/home/user" || absPath.startsWith("/home/user/") || absPath === "/tmp" || absPath.startsWith("/tmp/")
  );
}

function parseBoatSandboxSummary(raw: unknown): BoatSandboxSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) return null;
  return {
    id,
    name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : id,
    state: typeof record.state === "string" && record.state.trim() ? record.state.trim() : "unknown",
    url: typeof record.url === "string" && record.url.trim() ? record.url.trim() : null,
    ip: typeof record.ip === "string" && record.ip.trim() ? record.ip.trim() : null,
    desktopAvailable: Boolean(record.desktopAvailable),
    desktopUrl: typeof record.desktopUrl === "string" && record.desktopUrl.trim() ? record.desktopUrl.trim() : null,
    snapshotAvailable: Boolean(record.snapshotAvailable),
    createdAt: typeof record.createdAt === "string" ? record.createdAt : null,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
    archiveAfter: typeof record.archiveAfter === "string" ? record.archiveAfter : null,
  };
}

async function formatBoatApiError(prefix: string, response: Response): Promise<string> {
  const detail = await response
    .text()
    .then((text) => {
      try {
        const parsed = JSON.parse(text) as { message?: unknown; error?: unknown };
        if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message.trim();
        if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim();
        if (parsed.error && typeof parsed.error === "object") {
          const nested = parsed.error as { message?: unknown; code?: unknown };
          if (typeof nested.message === "string" && nested.message.trim()) return nested.message.trim();
          if (typeof nested.code === "string" && nested.code.trim()) return nested.code.trim();
        }
      } catch {
        // plain text
      }
      return text.trim().slice(0, 200);
    })
    .catch(() => "");
  return detail ? `${prefix} (${response.status}): ${detail}` : `${prefix} (${response.status}).`;
}

function shellQuotePosixBoat(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

function runSshKeygen(privateKeyPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    execFile(
      "ssh-keygen",
      ["-t", "ed25519", "-N", "", "-C", "roder-desktop-boat", "-f", privateKeyPath],
      { timeout: 15_000 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message || "Could not generate SSH key for Boat terminal."));
          return;
        }
        resolve();
      },
    );
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

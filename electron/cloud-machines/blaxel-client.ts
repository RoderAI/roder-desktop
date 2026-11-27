import type { BlaxelAuth } from "./credentials";

const DEFAULT_CONTROL_PLANE_BASE = "https://api.blaxel.ai/v0";
const SANDBOX_CACHE_TTL_MS = 60_000;

export type BlaxelWorkspaceInfo = {
  id: string;
  name: string;
  region?: string | null;
};

export type BlaxelSandboxSummary = {
  name: string;
  displayName: string;
  workspace: string;
  url: string | null;
  status: string;
  region: string | null;
  image: string | null;
  memory: number | null;
  updatedAt: string | null;
};

export type BlaxelDirectoryListing = {
  path: string;
  name: string;
  files: Array<{
    path: string;
    name: string;
    size: number;
    lastModified?: string;
    permissions?: string;
  }>;
  subdirectories: Array<{
    path: string;
    name: string;
  }>;
};

export type BlaxelProcessResult = {
  pid?: string;
  name?: string;
  status?: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  logs: string;
};

export type BlaxelClientOptions = {
  controlPlaneBase?: string;
  fetchImpl?: typeof fetch;
};

type CachedSandbox = {
  sandbox: BlaxelSandboxSummary;
  expiresAt: number;
};

/**
 * Encodes a POSIX absolute path for Blaxel's `/filesystem/{path}` endpoint while preserving the
 * leading `/` so Blaxel resolves from `/` instead of relocating under `/blaxel`.
 */
export function encodeBlaxelPath(absPath: string): string {
  const normalized = absPath.startsWith("/") ? absPath : `/${absPath}`;
  const trimmed = normalized.length > 1 ? normalized.replace(/\/+$/u, "") : normalized;
  if (trimmed === "/") {
    return "/";
  }
  return `/${trimmed
    .slice(1)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

export class BlaxelClient {
  private readonly controlPlaneBase: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sandboxCache = new Map<string, CachedSandbox>();

  constructor(options: BlaxelClientOptions = {}) {
    this.controlPlaneBase = (options.controlPlaneBase ?? DEFAULT_CONTROL_PLANE_BASE).replace(/\/+$/u, "");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  clearCache(): void {
    this.sandboxCache.clear();
  }

  async listWorkspaces(apiKey: string): Promise<BlaxelWorkspaceInfo[]> {
    const response = await this.fetchImpl(`${this.controlPlaneBase}/workspaces`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(await formatHttpError("Blaxel workspaces lookup failed", response));
    }
    const body = (await response.json()) as unknown;
    if (!Array.isArray(body)) return [];
    return body.flatMap((item): BlaxelWorkspaceInfo[] => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : "";
      if (!name) return [];
      return [
        {
          id: typeof record.id === "string" ? record.id : name,
          name,
          region: typeof record.region === "string" ? record.region : null,
        },
      ];
    });
  }

  async listSandboxes(auth: BlaxelAuth): Promise<BlaxelSandboxSummary[]> {
    const response = await this.fetchImpl(`${this.controlPlaneBase}/sandboxes`, {
      method: "GET",
      headers: controlPlaneHeaders(auth),
    });
    if (!response.ok) {
      throw new Error(await formatHttpError("Could not list Blaxel sandboxes", response));
    }
    const body = (await response.json()) as unknown;
    if (!Array.isArray(body)) return [];
    const sandboxes = body
      .map((entry) => parseSandboxSummary(entry, auth.workspace))
      .filter((entry): entry is BlaxelSandboxSummary => entry !== null)
      .toSorted(
        (left, right) =>
          (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") || left.name.localeCompare(right.name),
      );
    const now = Date.now();
    for (const sandbox of sandboxes) {
      if (sandbox.url) {
        this.sandboxCache.set(cacheKey(auth.workspace, sandbox.name), {
          sandbox,
          expiresAt: now + SANDBOX_CACHE_TTL_MS,
        });
      }
    }
    return sandboxes;
  }

  async getSandbox(
    auth: BlaxelAuth,
    name: string,
    options: { bypassCache?: boolean } = {},
  ): Promise<BlaxelSandboxSummary> {
    const key = cacheKey(auth.workspace, name);
    if (!options.bypassCache) {
      const cached = this.sandboxCache.get(key);
      if (cached && cached.expiresAt > Date.now() && cached.sandbox.url) {
        return cached.sandbox;
      }
    }
    const response = await this.fetchImpl(`${this.controlPlaneBase}/sandboxes/${encodeURIComponent(name)}`, {
      method: "GET",
      headers: controlPlaneHeaders(auth),
    });
    if (!response.ok) {
      throw new Error(await formatHttpError(`Could not reach Blaxel sandbox "${name}"`, response));
    }
    const parsed = parseSandboxSummary(await response.json(), auth.workspace);
    if (!parsed) {
      throw new Error(`Blaxel sandbox "${name}" returned an unexpected payload.`);
    }
    if (parsed.url) {
      this.sandboxCache.set(key, { sandbox: parsed, expiresAt: Date.now() + SANDBOX_CACHE_TTL_MS });
    }
    return parsed;
  }

  async createSandbox(
    auth: BlaxelAuth,
    input: {
      name: string;
      image?: string;
      memory?: number;
      region?: string;
      workingDir?: string;
    },
  ): Promise<BlaxelSandboxSummary> {
    const cleanName = input.name.trim();
    if (!cleanName || !/^[a-z0-9][a-z0-9-]{0,62}$/u.test(cleanName)) {
      throw new Error("Sandbox name must be lowercase letters, numbers, and hyphens (e.g. roder-dev).");
    }
    const spec: Record<string, unknown> = {
      runtime: {
        image: input.image?.trim() || "blaxel/py-app:latest",
        memory: input.memory && Number.isFinite(input.memory) ? Math.round(input.memory) : 4096,
      },
    };
    if (input.region?.trim()) {
      spec.region = input.region.trim();
    }
    const response = await this.fetchImpl(`${this.controlPlaneBase}/sandboxes?createIfNotExist=true`, {
      method: "POST",
      headers: {
        ...controlPlaneHeaders(auth),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        metadata: { name: cleanName },
        spec,
      }),
    });
    if (!response.ok) {
      throw new Error(await formatHttpError(`Could not create Blaxel sandbox "${cleanName}"`, response));
    }
    let sandbox = parseSandboxSummary(await response.json(), auth.workspace);
    if (!sandbox) {
      throw new Error(`Blaxel did not return metadata for sandbox "${cleanName}".`);
    }

    // Wait briefly until deployed and endpoint URL is assigned.
    const deadline = Date.now() + 45_000;
    while ((!sandbox.url || sandbox.status === "DEPLOYING" || sandbox.status === "CREATING") && Date.now() < deadline) {
      await delay(1_500);
      sandbox = await this.getSandbox(auth, cleanName, { bypassCache: true });
    }
    if (!sandbox.url) {
      throw new Error(`Blaxel sandbox "${cleanName}" was created but does not have an endpoint URL yet.`);
    }

    await this.wakeSandbox(auth, sandbox.url);
    if (input.workingDir?.trim() && input.workingDir.trim().startsWith("/")) {
      await this.ensureDirectory(auth, sandbox.url, input.workingDir.trim());
    }
    this.sandboxCache.set(cacheKey(auth.workspace, cleanName), {
      sandbox,
      expiresAt: Date.now() + SANDBOX_CACHE_TTL_MS,
    });
    return sandbox;
  }

  async wakeSandbox(auth: BlaxelAuth, sandboxUrl: string): Promise<void> {
    const base = sandboxUrl.replace(/\/+$/u, "");
    const response = await this.fetchImpl(`${base}/health`, {
      method: "GET",
      headers: sandboxHeaders(auth),
    });
    if (!response.ok) {
      throw new Error(await formatHttpError("Could not wake Blaxel sandbox", response));
    }
  }

  async ensureDirectory(auth: BlaxelAuth, sandboxUrl: string, absPath: string): Promise<void> {
    const encoded = encodeBlaxelPath(absPath);
    const response = await this.sandboxRequest(auth, sandboxUrl, `/filesystem/${encoded}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDirectory: true }),
    });
    if (!response.ok && response.status !== 409) {
      throw new Error(await formatHttpError(`Could not ensure remote directory "${absPath}"`, response));
    }
  }

  async readDirectory(auth: BlaxelAuth, sandboxUrl: string, absPath: string): Promise<BlaxelDirectoryListing> {
    const encoded = encodeBlaxelPath(absPath);
    const response = await this.sandboxRequest(auth, sandboxUrl, `/filesystem/${encoded}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(await formatHttpError(`Could not list remote directory "${absPath}"`, response));
    }
    const body = (await response.json()) as Record<string, unknown>;
    const files = Array.isArray(body.files)
      ? body.files.flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const record = entry as Record<string, unknown>;
          const name = typeof record.name === "string" ? record.name : "";
          const path = typeof record.path === "string" ? record.path : "";
          if (!name) return [];
          return [
            {
              path: path || `${absPath.replace(/\/+$/u, "")}/${name}`,
              name,
              size: typeof record.size === "number" ? record.size : 0,
              lastModified: typeof record.lastModified === "string" ? record.lastModified : undefined,
              permissions: typeof record.permissions === "string" ? record.permissions : undefined,
            },
          ];
        })
      : [];
    const subdirectories = Array.isArray(body.subdirectories)
      ? body.subdirectories.flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const record = entry as Record<string, unknown>;
          const name = typeof record.name === "string" ? record.name : "";
          const path = typeof record.path === "string" ? record.path : "";
          if (!name) return [];
          return [
            {
              path: path || `${absPath.replace(/\/+$/u, "")}/${name}`,
              name,
            },
          ];
        })
      : [];
    return {
      path: typeof body.path === "string" ? body.path : absPath,
      name: typeof body.name === "string" ? body.name : (absPath.split("/").filter(Boolean).pop() ?? "/"),
      files,
      subdirectories,
    };
  }

  async readFile(
    auth: BlaxelAuth,
    sandboxUrl: string,
    absPath: string,
  ): Promise<{ bytes: Buffer; contentType: string | null }> {
    const encoded = encodeBlaxelPath(absPath);
    const response = await this.sandboxRequest(auth, sandboxUrl, `/filesystem/${encoded}`, {
      method: "GET",
      headers: { Accept: "application/octet-stream" },
    });
    if (!response.ok) {
      throw new Error(await formatHttpError(`Could not read remote file "${absPath}"`, response));
    }
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      const json = (await response.json()) as Record<string, unknown>;
      if (typeof json.content === "string") {
        return { bytes: Buffer.from(json.content, "utf8"), contentType };
      }
      throw new Error(`"${absPath}" is a directory, not a file.`);
    }
    return { bytes: Buffer.from(await response.arrayBuffer()), contentType };
  }

  async runProcess(
    auth: BlaxelAuth,
    sandboxUrl: string,
    input: {
      command: string;
      workingDir?: string;
      timeoutMs?: number;
      name?: string;
      waitForCompletion?: boolean;
      keepAlive?: boolean;
      restartOnFailure?: boolean;
      maxRestarts?: number;
    },
  ): Promise<BlaxelProcessResult> {
    const waitForCompletion = input.waitForCompletion ?? true;
    const timeoutMs = input.timeoutMs ?? (waitForCompletion ? 20_000 : 0);
    const response = await this.sandboxRequest(auth, sandboxUrl, "/process", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        name: input.name ?? `roder-ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        command: input.command,
        ...(input.workingDir ? { workingDir: input.workingDir } : {}),
        waitForCompletion,
        ...(input.keepAlive !== undefined ? { keepAlive: input.keepAlive } : {}),
        ...(input.restartOnFailure !== undefined ? { restartOnFailure: input.restartOnFailure } : {}),
        ...(input.maxRestarts !== undefined ? { maxRestarts: input.maxRestarts } : {}),
        timeout: timeoutMs,
      }),
    });
    if (!response.ok) {
      throw new Error(await formatHttpError("Remote command failed", response));
    }
    const body = (await response.json()) as Record<string, unknown>;
    return {
      pid: typeof body.pid === "string" ? body.pid : undefined,
      name: typeof body.name === "string" ? body.name : undefined,
      status: typeof body.status === "string" ? body.status : undefined,
      exitCode: typeof body.exitCode === "number" ? body.exitCode : 0,
      stdout: typeof body.stdout === "string" ? body.stdout : "",
      stderr: typeof body.stderr === "string" ? body.stderr : "",
      logs: typeof body.logs === "string" ? body.logs : "",
    };
  }

  async getPreview(
    auth: BlaxelAuth,
    sandboxName: string,
    previewName: string,
  ): Promise<{ url: string; name: string; port: number | null; public: boolean | null } | null> {
    const response = await this.fetchImpl(
      `${this.controlPlaneBase}/sandboxes/${encodeURIComponent(sandboxName)}/previews/${encodeURIComponent(previewName)}`,
      {
        method: "GET",
        headers: controlPlaneHeaders(auth),
      },
    );
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as Record<string, unknown>;
    const spec = body.spec && typeof body.spec === "object" ? (body.spec as Record<string, unknown>) : null;
    const metadata =
      body.metadata && typeof body.metadata === "object" ? (body.metadata as Record<string, unknown>) : null;
    const url =
      (typeof spec?.url === "string" && spec.url) || (typeof metadata?.url === "string" && metadata.url) || "";
    if (!url) return null;
    return {
      url,
      name: previewName,
      port: typeof spec?.port === "number" ? spec.port : null,
      public: typeof spec?.public === "boolean" ? spec.public : null,
    };
  }

  async deletePreview(auth: BlaxelAuth, sandboxName: string, previewName: string): Promise<void> {
    await this.fetchImpl(
      `${this.controlPlaneBase}/sandboxes/${encodeURIComponent(sandboxName)}/previews/${encodeURIComponent(previewName)}`,
      {
        method: "DELETE",
        headers: controlPlaneHeaders(auth),
      },
    ).catch(() => undefined);
  }

  async createPreview(
    auth: BlaxelAuth,
    sandboxName: string,
    port: number,
    options: { name?: string; public?: boolean } = {},
  ): Promise<{ url: string; name: string }> {
    const previewName = options.name?.trim() || `roder-port-${port}`;
    const isPublic = options.public ?? true;

    const existing = await this.getPreview(auth, sandboxName, previewName);
    if (existing) {
      const portMatches = existing.port === null || existing.port === port;
      const publicMatches = existing.public === null || existing.public === isPublic;
      if (portMatches && publicMatches) {
        return { url: existing.url, name: existing.name };
      }
      await this.deletePreview(auth, sandboxName, previewName);
    }

    const response = await this.fetchImpl(
      `${this.controlPlaneBase}/sandboxes/${encodeURIComponent(sandboxName)}/previews`,
      {
        method: "POST",
        headers: {
          ...controlPlaneHeaders(auth),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          metadata: { name: previewName },
          spec: { port, public: isPublic },
        }),
      },
    );
    if (response.status === 409) {
      const raced = await this.getPreview(auth, sandboxName, previewName);
      if (raced) {
        return { url: raced.url, name: raced.name };
      }
    }
    if (!response.ok) {
      throw new Error(await formatHttpError(`Could not open preview for port ${port}`, response));
    }
    const body = (await response.json()) as Record<string, unknown>;
    const spec = body.spec && typeof body.spec === "object" ? (body.spec as Record<string, unknown>) : null;
    const metadata =
      body.metadata && typeof body.metadata === "object" ? (body.metadata as Record<string, unknown>) : null;
    const url =
      (typeof spec?.url === "string" && spec.url) || (typeof metadata?.url === "string" && metadata.url) || "";
    if (!url) {
      throw new Error(`Blaxel did not return a preview URL for port ${port}.`);
    }
    return { url, name: previewName };
  }

  private async sandboxRequest(
    auth: BlaxelAuth,
    sandboxUrl: string,
    path: string,
    init: RequestInit,
  ): Promise<Response> {
    const base = sandboxUrl.replace(/\/+$/u, "");
    const headers = {
      ...sandboxHeaders(auth),
      ...(init.headers as Record<string, string> | undefined),
    };
    const response = await this.fetchImpl(`${base}${path}`, { ...init, headers });
    if (response.status === 408 || response.status === 502 || response.status === 503 || response.status === 504) {
      // Sandbox may be waking from standby — wake via /health and retry once.
      await this.fetchImpl(`${base}/health`, { method: "GET", headers: sandboxHeaders(auth) }).catch(() => undefined);
      return this.fetchImpl(`${base}${path}`, { ...init, headers });
    }
    return response;
  }
}

function controlPlaneHeaders(auth: BlaxelAuth): Record<string, string> {
  return {
    Authorization: `Bearer ${auth.apiKey}`,
    Accept: "application/json",
    ...(auth.workspace ? { "X-Blaxel-Workspace": auth.workspace } : {}),
  };
}

function sandboxHeaders(auth: BlaxelAuth): Record<string, string> {
  return {
    Authorization: `Bearer ${auth.apiKey}`,
    ...(auth.workspace ? { "X-Blaxel-Workspace": auth.workspace } : {}),
  };
}

function cacheKey(workspace: string, name: string): string {
  return `${workspace}:${name}`;
}

function parseSandboxSummary(raw: unknown, fallbackWorkspace: string): BlaxelSandboxSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const metadata =
    record.metadata && typeof record.metadata === "object" ? (record.metadata as Record<string, unknown>) : {};
  const spec = record.spec && typeof record.spec === "object" ? (record.spec as Record<string, unknown>) : {};
  const runtime = spec.runtime && typeof spec.runtime === "object" ? (spec.runtime as Record<string, unknown>) : {};
  const name = typeof metadata.name === "string" ? metadata.name : "";
  if (!name) return null;
  return {
    name,
    displayName: typeof metadata.displayName === "string" && metadata.displayName ? metadata.displayName : name,
    workspace: typeof metadata.workspace === "string" && metadata.workspace ? metadata.workspace : fallbackWorkspace,
    url: typeof metadata.url === "string" && metadata.url ? metadata.url : null,
    status: typeof record.status === "string" ? record.status : "UNKNOWN",
    region: typeof spec.region === "string" ? spec.region : null,
    image: typeof runtime.image === "string" ? runtime.image : null,
    memory: typeof runtime.memory === "number" ? runtime.memory : null,
    updatedAt:
      typeof metadata.updatedAt === "string"
        ? metadata.updatedAt
        : typeof metadata.createdAt === "string"
          ? metadata.createdAt
          : null,
  };
}

async function formatHttpError(prefix: string, response: Response): Promise<string> {
  const detail = await response
    .text()
    .then((text) => {
      try {
        const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
        if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim();
        if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message.trim();
      } catch {
        // plain text body
      }
      return text.trim().slice(0, 200);
    })
    .catch(() => "");
  return detail ? `${prefix} (${response.status}): ${detail}` : `${prefix} (${response.status}).`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

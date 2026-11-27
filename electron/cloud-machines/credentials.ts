import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeTailscaleTags, TAILSCALE_DEFAULT_TAG, validateTailscaleAuthKey } from "./tailscale";

export type BlaxelCredentialRecord = {
  apiKey: string;
  workspace?: string;
  source?: "manual" | "blaxel-cli";
};

export type TailscaleCredentialRecord = {
  mode: "oauth" | "auth-key";
  authKey?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  tags?: string[];
  tailnet?: string;
  preferForSandboxes?: boolean;
};

export type TailscaleCredentialStatus = {
  configured: boolean;
  mode: "oauth" | "auth-key" | "none";
  source: "saved" | "env" | "none";
  preview: string | null;
  oauthClientId: string | null;
  tags: string[];
  tailnet: string | null;
  preferForSandboxes: boolean;
};

export type ResolvedTailscaleAuth =
  | {
      mode: "oauth";
      oauthClientId: string;
      oauthClientSecret: string;
      tags: string[];
      tailnet: string;
      preferForSandboxes: boolean;
    }
  | {
      mode: "auth-key";
      authKey: string;
      preferForSandboxes: boolean;
    };

export type StoredCloudCredentials = {
  blaxel?: BlaxelCredentialRecord;
  tailscale?: TailscaleCredentialRecord;
  tokens?: Record<string, string>;
};

export type CloudProviderCredentialStatus = {
  providerId: string;
  configured: boolean;
  source: "saved" | "blaxel-cli" | "env" | "none";
  workspace?: string | null;
  preview?: string | null;
  envVars: string[];
};

export type BlaxelAuth = {
  apiKey: string;
  workspace: string;
};

export interface CloudCredentialsServiceOptions {
  filePath: string;
  encrypt: (value: string) => Buffer;
  decrypt: (value: Buffer) => string;
  encryptionAvailable: () => boolean;
}

const providerTokenEnvMap: Record<string, string[]> = {
  sprites: ["SPRITES_TOKEN", "RODER_SPRITES_TOKEN"],
  cloudflare: ["CLOUDFLARE_API_TOKEN"],
  daytona: ["DAYTONA_API_KEY"],
  e2b: ["E2B_API_KEY"],
  modal: ["MODAL_TOKEN_SECRET"],
  runloop: ["RUNLOOP_API_KEY"],
  vercel: ["VERCEL_TOKEN"],
};

const blaxelKeyEnvVars = ["BLAXEL_API_KEY", "RODER_BLAXEL_API_KEY", "BL_API_KEY"] as const;
const tailscaleAuthKeyEnvVars = ["RODER_TAILSCALE_AUTH_KEY", "TAILSCALE_AUTH_KEY", "TS_AUTHKEY"] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

export function maskCredentialPreview(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length <= 8) {
    return "••••••••";
  }
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

function normalizeStored(data: unknown): StoredCloudCredentials {
  if (!isPlainRecord(data)) {
    throw new Error("Invalid credential storage");
  }
  const result: StoredCloudCredentials = {};
  if (data.blaxel !== undefined) {
    if (!isPlainRecord(data.blaxel)) throw new Error("Invalid Blaxel credential");
    const apiKey = nonEmptyString(data.blaxel.apiKey, "apiKey");
    const workspace =
      typeof data.blaxel.workspace === "string" && data.blaxel.workspace.trim()
        ? data.blaxel.workspace.trim()
        : undefined;
    const source = data.blaxel.source === "blaxel-cli" ? "blaxel-cli" : "manual";
    result.blaxel = { apiKey, ...(workspace ? { workspace } : {}), source };
  }
  if (data.tailscale !== undefined) {
    if (!isPlainRecord(data.tailscale)) throw new Error("Invalid Tailscale credential");
    const mode = data.tailscale.mode === "oauth" ? "oauth" : "auth-key";
    const preferForSandboxes = data.tailscale.preferForSandboxes !== false;
    if (mode === "oauth") {
      const oauthClientId = nonEmptyString(data.tailscale.oauthClientId, "Tailscale OAuth client ID");
      const oauthClientSecret = nonEmptyString(data.tailscale.oauthClientSecret, "Tailscale OAuth client secret");
      const tags = Array.isArray(data.tailscale.tags)
        ? normalizeTailscaleTags(data.tailscale.tags.filter((item): item is string => typeof item === "string"))
        : [TAILSCALE_DEFAULT_TAG];
      const tailnet =
        typeof data.tailscale.tailnet === "string" && data.tailscale.tailnet.trim()
          ? data.tailscale.tailnet.trim()
          : undefined;
      result.tailscale = {
        mode: "oauth",
        oauthClientId,
        oauthClientSecret,
        tags: tags.length > 0 ? tags : [TAILSCALE_DEFAULT_TAG],
        ...(tailnet ? { tailnet } : {}),
        preferForSandboxes,
      };
    } else {
      const authKey = validateTailscaleAuthKey(nonEmptyString(data.tailscale.authKey, "Tailscale auth key"));
      result.tailscale = {
        mode: "auth-key",
        authKey,
        preferForSandboxes,
      };
    }
  }
  if (data.tokens !== undefined) {
    if (!isPlainRecord(data.tokens)) throw new Error("Invalid provider tokens");
    const tokens: Record<string, string> = {};
    for (const [providerId, token] of Object.entries(data.tokens)) {
      if (!(providerId in providerTokenEnvMap)) continue;
      tokens[providerId] = nonEmptyString(token, `${providerId} token`);
    }
    if (Object.keys(tokens).length > 0) {
      result.tokens = tokens;
    }
  }
  return result;
}

export class CloudCredentialsService {
  private queue: Promise<unknown> = Promise.resolve();
  private cachedStored: StoredCloudCredentials = {};

  constructor(private readonly options: CloudCredentialsServiceOptions) {}

  async hydrate(): Promise<void> {
    await this.serialized(async () => {
      try {
        this.cachedStored = await this.read();
      } catch {
        this.cachedStored = {};
      }
    });
  }

  getCachedRunnerEnv(baseEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
    return runnerEnvFromStored(this.cachedStored, baseEnv);
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => {});
    return next;
  }

  private requireEncryption(): void {
    if (!this.options.encryptionAvailable()) {
      throw new Error("Cloud credential storage encryption is unavailable");
    }
  }

  private async read(): Promise<StoredCloudCredentials> {
    let bytes: Buffer;
    try {
      bytes = await readFile(this.options.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
    this.requireEncryption();
    try {
      const parsed: unknown = JSON.parse(this.options.decrypt(bytes));
      return normalizeStored(parsed);
    } catch {
      throw new Error("Unable to read encrypted cloud credential storage");
    }
  }

  private async write(credentials: StoredCloudCredentials): Promise<void> {
    this.requireEncryption();
    const bytes = this.options.encrypt(JSON.stringify(credentials));
    await mkdir(dirname(this.options.filePath), { recursive: true });
    const temporaryPath = `${this.options.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, bytes, { mode: 0o600, flag: "wx" });
      await rename(temporaryPath, this.options.filePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  saveBlaxel(input: {
    apiKey: string;
    workspace?: string;
    source?: "manual" | "blaxel-cli";
  }): Promise<CloudProviderCredentialStatus> {
    const apiKey = nonEmptyString(input.apiKey, "Blaxel API key");
    const workspace =
      typeof input.workspace === "string" && input.workspace.trim() ? input.workspace.trim() : undefined;
    const source = input.source === "blaxel-cli" ? "blaxel-cli" : "manual";
    return this.serialized(async () => {
      this.requireEncryption();
      const current = await this.read();
      const next: StoredCloudCredentials = {
        ...current,
        blaxel: { apiKey, ...(workspace ? { workspace } : {}), source },
      };
      await this.write(next);
      this.cachedStored = next;
      return statusForBlaxel(next.blaxel, process.env);
    });
  }

  saveProviderToken(providerId: string, token: string): Promise<CloudProviderCredentialStatus> {
    if (!(providerId in providerTokenEnvMap)) {
      return Promise.reject(new Error(`Unsupported credential provider: ${providerId}`));
    }
    const cleanToken = nonEmptyString(token, "Provider token");
    return this.serialized(async () => {
      this.requireEncryption();
      const current = await this.read();
      const tokens = { ...current.tokens, [providerId]: cleanToken };
      const next = { ...current, tokens };
      await this.write(next);
      this.cachedStored = next;
      return statusForTokenProvider(providerId, cleanToken, process.env);
    });
  }

  saveTailscaleAuthKey(input: { authKey: string; preferForSandboxes?: boolean }): Promise<TailscaleCredentialStatus> {
    const authKey = validateTailscaleAuthKey(input.authKey);
    const preferForSandboxes = input.preferForSandboxes !== false;
    return this.serialized(async () => {
      this.requireEncryption();
      const current = await this.read();
      const next: StoredCloudCredentials = {
        ...current,
        tailscale: {
          mode: "auth-key",
          authKey,
          preferForSandboxes,
        },
      };
      await this.write(next);
      this.cachedStored = next;
      return statusForTailscale(next.tailscale, process.env);
    });
  }

  saveTailscaleOAuth(input: {
    oauthClientId: string;
    oauthClientSecret: string;
    tags?: readonly string[] | string;
    tailnet?: string;
    preferForSandboxes?: boolean;
  }): Promise<TailscaleCredentialStatus> {
    const oauthClientId = nonEmptyString(input.oauthClientId, "Tailscale OAuth client ID");
    const oauthClientSecret = nonEmptyString(input.oauthClientSecret, "Tailscale OAuth client secret");
    const parsedTags = normalizeTailscaleTags(input.tags);
    const tags = parsedTags.length > 0 ? parsedTags : [TAILSCALE_DEFAULT_TAG];
    const tailnet = typeof input.tailnet === "string" && input.tailnet.trim() ? input.tailnet.trim() : undefined;
    const preferForSandboxes = input.preferForSandboxes !== false;
    return this.serialized(async () => {
      this.requireEncryption();
      const current = await this.read();
      const next: StoredCloudCredentials = {
        ...current,
        tailscale: {
          mode: "oauth",
          oauthClientId,
          oauthClientSecret,
          tags,
          ...(tailnet ? { tailnet } : {}),
          preferForSandboxes,
        },
      };
      await this.write(next);
      this.cachedStored = next;
      return statusForTailscale(next.tailscale, process.env);
    });
  }

  setTailscalePreferForSandboxes(preferForSandboxes: boolean): Promise<TailscaleCredentialStatus> {
    return this.serialized(async () => {
      this.requireEncryption();
      const current = await this.read();
      if (!current.tailscale) {
        throw new Error("Configure Tailscale credentials before changing sandbox tunneling preference.");
      }
      const next: StoredCloudCredentials = {
        ...current,
        tailscale: {
          ...current.tailscale,
          preferForSandboxes,
        },
      };
      await this.write(next);
      this.cachedStored = next;
      return statusForTailscale(next.tailscale, process.env);
    });
  }

  clearProvider(providerId: string): Promise<{ cleared: true }> {
    return this.serialized(async () => {
      this.requireEncryption();
      const current = await this.read();
      if (providerId === "blaxel") {
        const { blaxel: _, ...rest } = current;
        await this.write(rest);
        this.cachedStored = rest;
        return { cleared: true };
      }
      if (providerId === "tailscale") {
        const { tailscale: _, ...rest } = current;
        await this.write(rest);
        this.cachedStored = rest;
        return { cleared: true };
      }
      if (providerId in providerTokenEnvMap) {
        const tokens = { ...current.tokens };
        delete tokens[providerId];
        const { tokens: _oldTokens, ...rest } = current;
        const next: StoredCloudCredentials = Object.keys(tokens).length > 0 ? { ...rest, tokens } : rest;
        await this.write(next);
        this.cachedStored = next;
        return { cleared: true };
      }
      throw new Error(`Unsupported credential provider: ${providerId}`);
    });
  }

  getTailscaleStatus(baseEnv: NodeJS.ProcessEnv = process.env): Promise<TailscaleCredentialStatus> {
    return this.serialized(async () => {
      let stored: StoredCloudCredentials = {};
      try {
        stored = await this.read();
      } catch {
        stored = {};
      }
      return statusForTailscale(stored.tailscale, baseEnv);
    });
  }

  resolveTailscaleAuth(baseEnv: NodeJS.ProcessEnv = process.env): Promise<ResolvedTailscaleAuth | null> {
    return this.serialized(async () => {
      let stored: StoredCloudCredentials = {};
      try {
        stored = await this.read();
      } catch {
        stored = {};
      }
      const saved = stored.tailscale;
      if (saved) {
        if (saved.mode === "oauth" && saved.oauthClientId && saved.oauthClientSecret) {
          return {
            mode: "oauth",
            oauthClientId: saved.oauthClientId,
            oauthClientSecret: saved.oauthClientSecret,
            tags: saved.tags && saved.tags.length > 0 ? saved.tags : [TAILSCALE_DEFAULT_TAG],
            tailnet: saved.tailnet?.trim() || "-",
            preferForSandboxes: saved.preferForSandboxes !== false,
          };
        }
        if (saved.mode === "auth-key" && saved.authKey) {
          return {
            mode: "auth-key",
            authKey: saved.authKey,
            preferForSandboxes: saved.preferForSandboxes !== false,
          };
        }
      }
      const envOAuthId = baseEnv.TAILSCALE_OAUTH_CLIENT_ID?.trim();
      const envOAuthSecret = baseEnv.TAILSCALE_OAUTH_CLIENT_SECRET?.trim();
      if (envOAuthId && envOAuthSecret) {
        let tags = [TAILSCALE_DEFAULT_TAG];
        try {
          const parsed = normalizeTailscaleTags(baseEnv.TAILSCALE_TAGS);
          if (parsed.length > 0) tags = parsed;
        } catch {
          tags = [TAILSCALE_DEFAULT_TAG];
        }
        return {
          mode: "oauth",
          oauthClientId: envOAuthId,
          oauthClientSecret: envOAuthSecret,
          tags,
          tailnet: baseEnv.TAILSCALE_TAILNET?.trim() || "-",
          preferForSandboxes: true,
        };
      }
      const envAuthKey = tailscaleAuthKeyEnvVars.map((envVar) => baseEnv[envVar]?.trim()).find(Boolean);
      if (envAuthKey) {
        return {
          mode: "auth-key",
          authKey: envAuthKey,
          preferForSandboxes: true,
        };
      }
      return null;
    });
  }

  listStatuses(baseEnv: NodeJS.ProcessEnv = process.env): Promise<{ statuses: CloudProviderCredentialStatus[] }> {
    return this.serialized(async () => {
      let stored: StoredCloudCredentials = {};
      try {
        stored = await this.read();
      } catch {
        // When storage is unavailable or unreadable, still expose environment-based readiness without crashing settings.
        stored = {};
      }
      const statuses: CloudProviderCredentialStatus[] = [
        statusForBlaxel(stored.blaxel, baseEnv),
        ...Object.keys(providerTokenEnvMap).map((providerId) =>
          statusForTokenProvider(providerId, stored.tokens?.[providerId], baseEnv),
        ),
      ];
      return { statuses };
    });
  }

  async resolveBlaxelAuth(
    overrideWorkspace?: string,
    baseEnv: NodeJS.ProcessEnv = process.env,
  ): Promise<BlaxelAuth | null> {
    return this.serialized(async () => {
      let stored: StoredCloudCredentials = {};
      try {
        stored = await this.read();
      } catch {
        stored = {};
      }
      const apiKey =
        stored.blaxel?.apiKey || blaxelKeyEnvVars.map((envVar) => baseEnv[envVar]?.trim()).find(Boolean) || "";
      if (!apiKey) return null;
      const workspace =
        overrideWorkspace?.trim() ||
        stored.blaxel?.workspace?.trim() ||
        baseEnv.BL_WORKSPACE?.trim() ||
        baseEnv.BLAXEL_WORKSPACE?.trim() ||
        "";
      return { apiKey, workspace };
    });
  }

  async buildRunnerEnv(baseEnv: NodeJS.ProcessEnv = process.env): Promise<Record<string, string>> {
    return this.serialized(async () => {
      let stored: StoredCloudCredentials = {};
      try {
        stored = await this.read();
        this.cachedStored = stored;
      } catch {
        return {};
      }
      return runnerEnvFromStored(stored, baseEnv);
    });
  }
}

function runnerEnvFromStored(stored: StoredCloudCredentials, baseEnv: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  if (stored.blaxel?.apiKey) {
    env.BLAXEL_API_KEY = stored.blaxel.apiKey;
    env.RODER_BLAXEL_API_KEY = stored.blaxel.apiKey;
    env.BL_API_KEY = stored.blaxel.apiKey;
    if (stored.blaxel.workspace) {
      env.BL_WORKSPACE = stored.blaxel.workspace;
    }
  }
  if (stored.tokens) {
    for (const [providerId, token] of Object.entries(stored.tokens)) {
      const vars = providerTokenEnvMap[providerId];
      if (!vars) continue;
      for (const envVar of vars) {
        env[envVar] = token;
      }
    }
  }
  if (!env.BL_WORKSPACE && baseEnv.BL_WORKSPACE) {
    env.BL_WORKSPACE = baseEnv.BL_WORKSPACE;
  }
  return env;
}

function statusForBlaxel(
  saved: BlaxelCredentialRecord | undefined,
  baseEnv: NodeJS.ProcessEnv,
): CloudProviderCredentialStatus {
  if (saved?.apiKey) {
    return {
      providerId: "blaxel",
      configured: true,
      source: saved.source === "blaxel-cli" ? "blaxel-cli" : "saved",
      workspace: saved.workspace ?? baseEnv.BL_WORKSPACE ?? null,
      preview: maskCredentialPreview(saved.apiKey),
      envVars: ["BLAXEL_API_KEY", "BL_WORKSPACE"],
    };
  }
  const envKey = blaxelKeyEnvVars.map((envVar) => baseEnv[envVar]?.trim()).find(Boolean);
  if (envKey) {
    return {
      providerId: "blaxel",
      configured: true,
      source: "env",
      workspace: baseEnv.BL_WORKSPACE?.trim() || baseEnv.BLAXEL_WORKSPACE?.trim() || null,
      preview: maskCredentialPreview(envKey),
      envVars: ["BLAXEL_API_KEY", "BL_WORKSPACE"],
    };
  }
  return {
    providerId: "blaxel",
    configured: false,
    source: "none",
    workspace: null,
    preview: null,
    envVars: ["BLAXEL_API_KEY", "BL_WORKSPACE"],
  };
}

function statusForTailscale(
  saved: TailscaleCredentialRecord | undefined,
  baseEnv: NodeJS.ProcessEnv,
): TailscaleCredentialStatus {
  if (saved) {
    if (saved.mode === "oauth" && saved.oauthClientId && saved.oauthClientSecret) {
      return {
        configured: true,
        mode: "oauth",
        source: "saved",
        preview: maskCredentialPreview(saved.oauthClientSecret),
        oauthClientId: saved.oauthClientId,
        tags: saved.tags && saved.tags.length > 0 ? saved.tags : [TAILSCALE_DEFAULT_TAG],
        tailnet: saved.tailnet ?? null,
        preferForSandboxes: saved.preferForSandboxes !== false,
      };
    }
    if (saved.mode === "auth-key" && saved.authKey) {
      return {
        configured: true,
        mode: "auth-key",
        source: "saved",
        preview: maskCredentialPreview(saved.authKey),
        oauthClientId: null,
        tags: [],
        tailnet: null,
        preferForSandboxes: saved.preferForSandboxes !== false,
      };
    }
  }
  const envOAuthId = baseEnv.TAILSCALE_OAUTH_CLIENT_ID?.trim();
  const envOAuthSecret = baseEnv.TAILSCALE_OAUTH_CLIENT_SECRET?.trim();
  if (envOAuthId && envOAuthSecret) {
    let tags = [TAILSCALE_DEFAULT_TAG];
    try {
      const parsed = normalizeTailscaleTags(baseEnv.TAILSCALE_TAGS);
      if (parsed.length > 0) tags = parsed;
    } catch {
      tags = [TAILSCALE_DEFAULT_TAG];
    }
    return {
      configured: true,
      mode: "oauth",
      source: "env",
      preview: maskCredentialPreview(envOAuthSecret),
      oauthClientId: envOAuthId,
      tags,
      tailnet: baseEnv.TAILSCALE_TAILNET?.trim() || null,
      preferForSandboxes: true,
    };
  }
  const envAuthKey = tailscaleAuthKeyEnvVars.map((envVar) => baseEnv[envVar]?.trim()).find(Boolean);
  if (envAuthKey) {
    return {
      configured: true,
      mode: "auth-key",
      source: "env",
      preview: maskCredentialPreview(envAuthKey),
      oauthClientId: null,
      tags: [],
      tailnet: null,
      preferForSandboxes: true,
    };
  }
  return {
    configured: false,
    mode: "none",
    source: "none",
    preview: null,
    oauthClientId: null,
    tags: [TAILSCALE_DEFAULT_TAG],
    tailnet: null,
    preferForSandboxes: true,
  };
}

function statusForTokenProvider(
  providerId: string,
  savedToken: string | undefined,
  baseEnv: NodeJS.ProcessEnv,
): CloudProviderCredentialStatus {
  const envVars = providerTokenEnvMap[providerId] ?? [];
  if (savedToken) {
    return {
      providerId,
      configured: true,
      source: "saved",
      workspace: null,
      preview: maskCredentialPreview(savedToken),
      envVars,
    };
  }
  const envToken = envVars.map((envVar) => baseEnv[envVar]?.trim()).find(Boolean);
  if (envToken) {
    return {
      providerId,
      configured: true,
      source: "env",
      workspace: null,
      preview: maskCredentialPreview(envToken),
      envVars,
    };
  }
  return {
    providerId,
    configured: false,
    source: "none",
    workspace: null,
    preview: null,
    envVars,
  };
}

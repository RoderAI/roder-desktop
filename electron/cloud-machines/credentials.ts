import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type BlaxelCredentialRecord = {
  apiKey: string;
  workspace?: string;
  source?: "manual" | "blaxel-cli";
};

export type StoredCloudCredentials = {
  blaxel?: BlaxelCredentialRecord;
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
      if (providerId in providerTokenEnvMap) {
        const tokens = { ...current.tokens };
        delete tokens[providerId];
        const next: StoredCloudCredentials =
          Object.keys(tokens).length > 0 ? { ...current, tokens } : current.blaxel ? { blaxel: current.blaxel } : {};
        await this.write(next);
        this.cachedStored = next;
        return { cleared: true };
      }
      throw new Error(`Unsupported credential provider: ${providerId}`);
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

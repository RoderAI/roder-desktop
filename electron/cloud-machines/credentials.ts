import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { BOAT_OAUTH_CLIENT_ID, refreshBoatAccessToken } from "./boat-oauth";
import { normalizeTailscaleTags, TAILSCALE_DEFAULT_TAG, validateTailscaleAuthKey } from "./tailscale";

export type BlaxelCredentialRecord = {
  apiKey: string;
  workspace?: string;
  source?: "manual" | "blaxel-cli";
};

export type BoatCredentialRecord = {
  mode: "oauth" | "api-key";
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
  clientId?: string;
  userLogin?: string;
  userDisplayName?: string;
  userEmail?: string;
};

export type BoatCredentialStatus = {
  configured: boolean;
  mode: "oauth" | "api-key" | "none";
  source: "oauth" | "saved" | "env" | "none";
  preview: string | null;
  userLogin: string | null;
  userDisplayName: string | null;
  userEmail: string | null;
  scope: string | null;
  expiresAt: number | null;
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
  boat?: BoatCredentialRecord;
  tailscale?: TailscaleCredentialRecord;
  tokens?: Record<string, string>;
};

export type CloudProviderCredentialStatus = {
  providerId: string;
  configured: boolean;
  source: "saved" | "blaxel-cli" | "oauth" | "env" | "none";
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
const boatKeyEnvVars = ["BOAT_API_KEY", "RODER_BOAT_API_KEY"] as const;
const tailscaleAuthKeyEnvVars = ["RODER_TAILSCALE_AUTH_KEY", "TAILSCALE_AUTH_KEY", "TS_AUTHKEY"] as const;
const BOAT_REFRESH_WINDOW_MS = 5 * 60 * 1000;

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
  if (data.boat !== undefined) {
    if (!isPlainRecord(data.boat)) throw new Error("Invalid Boat credential");
    const mode = data.boat.mode === "oauth" ? "oauth" : "api-key";
    const accessToken = nonEmptyString(data.boat.accessToken, "Boat access token");
    const refreshToken =
      typeof data.boat.refreshToken === "string" && data.boat.refreshToken.trim()
        ? data.boat.refreshToken.trim()
        : undefined;
    const expiresAt =
      typeof data.boat.expiresAt === "number" && Number.isFinite(data.boat.expiresAt) ? data.boat.expiresAt : undefined;
    const scope = typeof data.boat.scope === "string" && data.boat.scope.trim() ? data.boat.scope.trim() : undefined;
    const clientId =
      typeof data.boat.clientId === "string" && data.boat.clientId.trim() ? data.boat.clientId.trim() : undefined;
    const userLogin =
      typeof data.boat.userLogin === "string" && data.boat.userLogin.trim() ? data.boat.userLogin.trim() : undefined;
    const userDisplayName =
      typeof data.boat.userDisplayName === "string" && data.boat.userDisplayName.trim()
        ? data.boat.userDisplayName.trim()
        : undefined;
    const userEmail =
      typeof data.boat.userEmail === "string" && data.boat.userEmail.trim() ? data.boat.userEmail.trim() : undefined;
    result.boat = {
      mode,
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(scope ? { scope } : {}),
      ...(clientId ? { clientId } : {}),
      ...(userLogin ? { userLogin } : {}),
      ...(userDisplayName ? { userDisplayName } : {}),
      ...(userEmail ? { userEmail } : {}),
    };
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
  private boatRefreshInFlight: Promise<string | null> | null = null;

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

  saveBoatOAuth(input: {
    accessToken: string;
    refreshToken?: string | null;
    expiresAt?: number;
    scope?: string;
    clientId?: string;
    userLogin?: string | null;
    userDisplayName?: string | null;
    userEmail?: string | null;
  }): Promise<BoatCredentialStatus> {
    const accessToken = nonEmptyString(input.accessToken, "Boat access token");
    const refreshToken = input.refreshToken?.trim() || undefined;
    const scope = input.scope?.trim() || undefined;
    const clientId = input.clientId?.trim() || BOAT_OAUTH_CLIENT_ID;
    const userLogin = input.userLogin?.trim() || undefined;
    const userDisplayName = input.userDisplayName?.trim() || undefined;
    const userEmail = input.userEmail?.trim() || undefined;
    return this.serialized(async () => {
      this.requireEncryption();
      const current = await this.read();
      const next: StoredCloudCredentials = {
        ...current,
        boat: {
          mode: "oauth",
          accessToken,
          ...(refreshToken ? { refreshToken } : {}),
          ...(typeof input.expiresAt === "number" && Number.isFinite(input.expiresAt)
            ? { expiresAt: input.expiresAt }
            : {}),
          ...(scope ? { scope } : {}),
          clientId,
          ...(userLogin ? { userLogin } : {}),
          ...(userDisplayName ? { userDisplayName } : {}),
          ...(userEmail ? { userEmail } : {}),
        },
      };
      await this.write(next);
      this.cachedStored = next;
      return statusForBoat(next.boat, process.env);
    });
  }

  saveBoatApiKey(input: {
    apiKey: string;
    userLogin?: string | null;
    userDisplayName?: string | null;
    userEmail?: string | null;
  }): Promise<BoatCredentialStatus> {
    const accessToken = nonEmptyString(input.apiKey, "Boat API key");
    const userLogin = input.userLogin?.trim() || undefined;
    const userDisplayName = input.userDisplayName?.trim() || undefined;
    const userEmail = input.userEmail?.trim() || undefined;
    return this.serialized(async () => {
      this.requireEncryption();
      const current = await this.read();
      const next: StoredCloudCredentials = {
        ...current,
        boat: {
          mode: "api-key",
          accessToken,
          ...(userLogin ? { userLogin } : {}),
          ...(userDisplayName ? { userDisplayName } : {}),
          ...(userEmail ? { userEmail } : {}),
        },
      };
      await this.write(next);
      this.cachedStored = next;
      return statusForBoat(next.boat, process.env);
    });
  }

  getBoatStatus(baseEnv: NodeJS.ProcessEnv = process.env): Promise<BoatCredentialStatus> {
    return this.serialized(async () => {
      let stored: StoredCloudCredentials = {};
      try {
        stored = await this.read();
      } catch {
        stored = {};
      }
      return statusForBoat(stored.boat, baseEnv);
    });
  }

  getBoatRefreshToken(): Promise<string | null> {
    return this.serialized(async () => {
      let stored: StoredCloudCredentials = {};
      try {
        stored = await this.read();
      } catch {
        return null;
      }
      return stored.boat?.mode === "oauth" ? (stored.boat.refreshToken ?? null) : null;
    });
  }

  /**
   * Resolves a valid Boat Bearer token, refreshing OAuth tokens through a single serialized flight
   * so Boat's rotating refresh tokens are never sent concurrently.
   */
  async resolveBoatAccessToken(
    options: { forceRefresh?: boolean; fetchImpl?: typeof fetch; baseEnv?: NodeJS.ProcessEnv } = {},
  ): Promise<string | null> {
    const baseEnv = options.baseEnv ?? process.env;
    if (this.boatRefreshInFlight) {
      return this.boatRefreshInFlight;
    }

    const stored = await this.serialized(async () => {
      try {
        return await this.read();
      } catch {
        return {} as StoredCloudCredentials;
      }
    });

    const saved = stored.boat;
    if (!saved) {
      return boatKeyEnvVars.map((envVar) => baseEnv[envVar]?.trim()).find(Boolean) ?? null;
    }

    if (saved.mode !== "oauth") {
      return saved.accessToken;
    }

    const needsRefresh =
      Boolean(options.forceRefresh) ||
      (typeof saved.expiresAt === "number" && Date.now() >= saved.expiresAt - BOAT_REFRESH_WINDOW_MS);

    if (!needsRefresh) {
      return saved.accessToken;
    }

    if (!saved.refreshToken) {
      return saved.accessToken;
    }

    const refreshTask = this.serialized(async () => {
      const latest = await this.read();
      const latestBoat = latest.boat;
      if (!latestBoat || latestBoat.mode !== "oauth") {
        return latestBoat?.accessToken ?? null;
      }
      const stillNeedsRefresh =
        Boolean(options.forceRefresh) ||
        (typeof latestBoat.expiresAt === "number" && Date.now() >= latestBoat.expiresAt - BOAT_REFRESH_WINDOW_MS);
      if (!stillNeedsRefresh) {
        return latestBoat.accessToken;
      }
      if (!latestBoat.refreshToken) {
        return latestBoat.accessToken;
      }
      const rotated = await refreshBoatAccessToken({
        refreshToken: latestBoat.refreshToken,
        clientId: latestBoat.clientId ?? BOAT_OAUTH_CLIENT_ID,
        fetchImpl: options.fetchImpl,
      });
      const updatedBoat: BoatCredentialRecord = {
        ...latestBoat,
        accessToken: rotated.accessToken,
        refreshToken: rotated.refreshToken ?? latestBoat.refreshToken,
        expiresAt: rotated.expiresAt,
        scope: rotated.scope || latestBoat.scope,
      };
      const next: StoredCloudCredentials = { ...latest, boat: updatedBoat };
      await this.write(next);
      this.cachedStored = next;
      return updatedBoat.accessToken;
    }).finally(() => {
      if (this.boatRefreshInFlight === refreshTask) {
        this.boatRefreshInFlight = null;
      }
    });

    this.boatRefreshInFlight = refreshTask;
    return refreshTask;
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
      if (providerId === "boat") {
        const { boat: _, ...rest } = current;
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
        statusForBoatProvider(stored.boat, baseEnv),
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
  if (stored.boat?.accessToken) {
    env.BOAT_API_KEY = stored.boat.accessToken;
    env.RODER_BOAT_API_KEY = stored.boat.accessToken;
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

function statusForBoat(saved: BoatCredentialRecord | undefined, baseEnv: NodeJS.ProcessEnv): BoatCredentialStatus {
  if (saved?.accessToken) {
    return {
      configured: true,
      mode: saved.mode,
      source: saved.mode === "oauth" ? "oauth" : "saved",
      preview: maskCredentialPreview(saved.accessToken),
      userLogin: saved.userLogin ?? null,
      userDisplayName: saved.userDisplayName ?? null,
      userEmail: saved.userEmail ?? null,
      scope: saved.scope ?? null,
      expiresAt: saved.expiresAt ?? null,
    };
  }
  const envKey = boatKeyEnvVars.map((envVar) => baseEnv[envVar]?.trim()).find(Boolean);
  if (envKey) {
    return {
      configured: true,
      mode: "api-key",
      source: "env",
      preview: maskCredentialPreview(envKey),
      userLogin: null,
      userDisplayName: null,
      userEmail: null,
      scope: null,
      expiresAt: null,
    };
  }
  return {
    configured: false,
    mode: "none",
    source: "none",
    preview: null,
    userLogin: null,
    userDisplayName: null,
    userEmail: null,
    scope: null,
    expiresAt: null,
  };
}

function statusForBoatProvider(
  saved: BoatCredentialRecord | undefined,
  baseEnv: NodeJS.ProcessEnv,
): CloudProviderCredentialStatus {
  const detail = statusForBoat(saved, baseEnv);
  return {
    providerId: "boat",
    configured: detail.configured,
    source: detail.source,
    workspace: detail.userLogin ? `@${detail.userLogin}` : null,
    preview: detail.preview,
    envVars: ["BOAT_API_KEY"],
  };
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

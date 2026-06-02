import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, shell } from "electron";

const rateLimitResetDateFormatter = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

export type CodexRateWindow = {
  label: string;
  usedPercent: number;
  remainingPercent: number;
  windowMinutes: number | null;
  resetsAt: number | null;
  resetLabel: string;
};

export type CodexAccountSnapshot = {
  signedIn: boolean;
  roderSignedIn: boolean;
  codexSignedIn: boolean;
  displayName: string | null;
  accountId: string | null;
  planType: string | null;
  loginPending: boolean;
  limits: {
    primary: CodexRateWindow | null;
    secondary: CodexRateWindow | null;
    updatedAt: string | null;
  } | null;
  error?: string;
};

type CodexAuthJson = {
  auth_mode?: string;
  email?: string;
  account_email?: string;
  chatgpt_email?: string;
  account_id?: string;
  accountId?: string;
  plan_type?: string;
  planType?: string;
  tokens?: {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    access?: string;
    refresh?: string;
  };
  user?: {
    id?: string;
    email?: string;
    plan_type?: string;
  };
};

type CodexIdTokenPayload = {
  sub?: string;
  email?: string;
  name?: string;
};

type RoderAuthJson = {
  refresh?: string;
  account_id?: string;
};

type RawRateLimits = {
  plan_type?: string | null;
  primary?: RawRateWindow | null;
  secondary?: RawRateWindow | null;
};

type RawRateWindow = {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
};

const thisDir = dirname(fileURLToPath(import.meta.url));
let loginPending = false;

export async function getCodexAccountSnapshot(): Promise<CodexAccountSnapshot> {
  try {
    const [codexAuth, roderAuth, limits] = await Promise.all([readCodexAuth(), readRoderAuth(), readLatestLimits()]);
    const displayName = roderAuth.signedIn
      ? (codexAuth.displayName ?? (roderAuth.accountId ? `Codex account ${shortId(roderAuth.accountId)}` : null))
      : null;
    return {
      signedIn: roderAuth.signedIn,
      roderSignedIn: roderAuth.signedIn,
      codexSignedIn: codexAuth.signedIn,
      displayName,
      accountId: roderAuth.accountId ?? codexAuth.accountId,
      planType: limits?.planType ?? codexAuth.planType,
      loginPending,
      limits: limits
        ? {
            primary: normalizeRateWindow("5h", limits.raw.primary ?? null),
            secondary: normalizeRateWindow("Weekly", limits.raw.secondary ?? null),
            updatedAt: limits.updatedAt,
          }
        : null,
    };
  } catch (error) {
    return {
      signedIn: false,
      roderSignedIn: false,
      codexSignedIn: false,
      displayName: null,
      accountId: null,
      planType: null,
      loginPending,
      limits: null,
      error: (error as Error).message,
    };
  }
}

export async function startCodexLogin(): Promise<CodexAccountSnapshot> {
  if (!loginPending) {
    loginPending = true;
    const target = resolveRoderBinary();
    const child = spawn(target.command, [...target.args, "auth", "login", "codex"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        RODER_DESKTOP: "1",
      },
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    child.once("exit", () => {
      loginPending = false;
    });
    child.once("error", () => {
      loginPending = false;
    });
  }
  return getCodexAccountSnapshot();
}

export async function logoutCodex(): Promise<CodexAccountSnapshot> {
  loginPending = false;
  await rm(roderAuthPath(), { force: true });
  return getCodexAccountSnapshot();
}

export async function openRateLimitHelp(): Promise<void> {
  await shell.openExternal("https://help.openai.com/");
}

async function readCodexAuth(): Promise<{
  signedIn: boolean;
  displayName: string | null;
  accountId: string | null;
  planType: string | null;
}> {
  const auth = await readJson<CodexAuthJson>(join(homedir(), ".codex", "auth.json"));
  if (!auth) {
    return { signedIn: false, displayName: null, accountId: null, planType: null };
  }
  const idToken = parseIdToken(auth.tokens?.id_token);
  const signedIn = Boolean(
    auth.tokens?.access_token ||
    auth.tokens?.refresh_token ||
    auth.tokens?.access ||
    auth.tokens?.refresh ||
    auth.auth_mode,
  );
  return {
    signedIn,
    displayName: firstText(
      auth.email,
      auth.account_email,
      auth.chatgpt_email,
      auth.user?.email,
      idToken?.email,
      idToken?.name,
      auth.auth_mode === "chatgpt" ? "Codex account" : null,
    ),
    accountId: firstText(auth.account_id, auth.accountId, auth.user?.id, idToken?.sub),
    planType: firstText(auth.plan_type, auth.planType, auth.user?.plan_type),
  };
}

async function readRoderAuth(): Promise<{ signedIn: boolean; accountId: string | null }> {
  const auth = await readJson<RoderAuthJson>(roderAuthPath());
  return {
    signedIn: Boolean(auth?.refresh),
    accountId: firstText(auth?.account_id),
  };
}

async function readLatestLimits(): Promise<{ raw: RawRateLimits; updatedAt: string; planType: string | null } | null> {
  const files = await collectJsonlFiles([
    join(homedir(), ".codex", "sessions"),
    join(homedir(), ".codex", "archived_sessions"),
  ]);
  let latest: { timestamp: number; raw: RawRateLimits } | null = null;

  const sessionFiles = await Promise.all(
    files.slice(0, 160).map(async (file) => ({
      ...file,
      data: await readFile(file.path, "utf8").catch(() => ""),
    })),
  );
  for (const file of sessionFiles) {
    for (const line of file.data.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      const parsed = parseJson<{
        type?: string;
        timestamp?: string;
        payload?: { type?: string; rate_limits?: RawRateLimits };
      }>(line);
      if (parsed?.type !== "event_msg" || parsed.payload?.type !== "token_count" || !parsed.payload.rate_limits) {
        continue;
      }
      const timestamp = Date.parse(parsed.timestamp ?? "") || file.mtimeMs;
      if (!latest || timestamp > latest.timestamp) {
        latest = { timestamp, raw: parsed.payload.rate_limits };
      }
    }
  }

  if (!latest) {
    return null;
  }
  return {
    raw: latest.raw,
    updatedAt: new Date(latest.timestamp).toISOString(),
    planType: firstText(latest.raw.plan_type),
  };
}

async function collectJsonlFiles(roots: string[]): Promise<Array<{ path: string; mtimeMs: number }>> {
  const files: Array<{ path: string; mtimeMs: number }> = [];
  await Promise.all(roots.map((root) => walkJsonl(root, files)));
  return files.sort((left, right) => right.mtimeMs - left.mtimeMs);
}

async function walkJsonl(dir: string, files: Array<{ path: string; mtimeMs: number }>): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walkJsonl(path, files);
      } else if (entry.isFile() && path.endsWith(".jsonl")) {
        const info = await stat(path).catch(() => null);
        if (info) {
          files.push({ path, mtimeMs: info.mtimeMs });
        }
      }
    }),
  );
}

function normalizeRateWindow(label: string, raw: RawRateWindow | null): CodexRateWindow | null {
  if (!raw) {
    return null;
  }
  const usedPercent = clamp(raw.used_percent ?? 0, 0, 100);
  const remainingPercent = clamp(100 - usedPercent, 0, 100);
  const resetsAt = Number.isFinite(raw.resets_at) ? (raw.resets_at ?? null) : null;
  return {
    label,
    usedPercent,
    remainingPercent,
    windowMinutes: Number.isFinite(raw.window_minutes) ? (raw.window_minutes ?? null) : null,
    resetsAt,
    resetLabel: formatResetLabel(resetsAt),
  };
}

function formatResetLabel(resetsAt: number | null): string {
  if (!resetsAt) {
    return "";
  }
  const resetMs = resetsAt * 1000;
  const diffMs = resetMs - Date.now();
  if (diffMs > 0 && diffMs < 24 * 60 * 60 * 1000) {
    const totalMinutes = Math.ceil(diffMs / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}:${minutes.toString().padStart(2, "0")}`;
  }
  return rateLimitResetDateFormatter.format(new Date(resetMs));
}

async function readJson<T>(path: string): Promise<T | null> {
  const data = await readFile(path, "utf8").catch(() => "");
  if (!data.trim()) {
    return null;
  }
  return parseJson<T>(data);
}

function parseJson<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

function parseIdToken(idToken: string | undefined): CodexIdTokenPayload | null {
  const payload = idToken?.split(".")[1];
  if (!payload) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as CodexIdTokenPayload;
  } catch {
    return null;
  }
}

function resolveRoderBinary(): { command: string; args: string[] } {
  const binaryName = process.platform === "win32" ? "roder.exe" : "roder";
  const packaged = join(process.resourcesPath, "bin", binaryName);
  if (app.isPackaged && existsSync(packaged)) {
    return { command: packaged, args: [] };
  }
  const bundled = resolve(thisDir, "..", "..", "resources", "bin", binaryName);
  if (existsSync(bundled)) {
    return { command: bundled, args: [] };
  }
  throw new Error(
    `Could not find embedded roder binary at ${app.isPackaged ? packaged : bundled}. Run pnpm bundle:roder before launching the desktop app.`,
  );
}

function roderAuthPath(): string {
  return join(process.env.RODER_DATA_DIR || join(homedir(), ".roder"), "auth", "codex.json");
}

function firstText(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

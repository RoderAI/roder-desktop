import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export type RawRateLimits = {
  plan_type?: string | null;
  primary?: RawRateWindow | null;
  secondary?: RawRateWindow | null;
};

export type RawRateWindow = {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
};

/** Newest session files to inspect for rate-limit events. */
const maxCandidateFiles = 24;
/** Only the trailing slice of each file is loaded — full session jsonl can be hundreds of MB. */
const tailBytes = 512 * 1024;

export type LatestCodexRateLimits = {
  raw: RawRateLimits;
  updatedAt: string;
  planType: string | null;
};

/**
 * Find the newest Codex `token_count` rate-limit snapshot under session roots.
 * Scans only recent files and only their trailing bytes so huge `~/.codex/sessions`
 * trees cannot OOM the Electron main process on boot.
 */
export async function findLatestCodexRateLimits(roots: string[]): Promise<LatestCodexRateLimits | null> {
  const files = (await collectJsonlFiles(roots)).slice(0, maxCandidateFiles);

  for (const file of files) {
    const data = await readFileTail(file.path, tailBytes);
    if (!data) {
      continue;
    }
    // Newest files are checked first; the first tail hit is the latest snapshot.
    const found = latestRateLimitsInJsonl(data, file.mtimeMs);
    if (found) {
      return {
        raw: found.raw,
        updatedAt: new Date(found.timestamp).toISOString(),
        planType: firstText(found.raw.plan_type),
      };
    }
  }

  return null;
}

export function latestRateLimitsInJsonl(
  data: string,
  fallbackTimestampMs: number,
): { timestamp: number; raw: RawRateLimits } | null {
  let latest: { timestamp: number; raw: RawRateLimits } | null = null;
  // A tail read may start mid-line; drop the incomplete first fragment.
  const lines = data.split("\n");
  const startIndex = data.length > 0 && !data.startsWith("{") && !data.startsWith("\n") ? 1 : 0;

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) {
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
    const timestamp = Date.parse(parsed.timestamp ?? "") || fallbackTimestampMs;
    if (!latest || timestamp > latest.timestamp) {
      latest = { timestamp, raw: parsed.payload.rate_limits };
    }
  }
  return latest;
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

async function readFileTail(path: string, maxBytes: number): Promise<string> {
  const handle = await open(path, "r").catch(() => null);
  if (!handle) {
    return "";
  }
  try {
    const info = await handle.stat();
    const size = info.size;
    if (size <= 0) {
      return "";
    }
    const length = Math.min(size, maxBytes);
    const position = size - length;
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function parseJson<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
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

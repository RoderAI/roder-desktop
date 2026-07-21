import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { findLatestCodexRateLimits, latestRateLimitsInJsonl } from "../electron/codex/codex-rate-limits";

function rateLimitLine(timestamp: string, usedPercent: number): string {
  return JSON.stringify({
    type: "event_msg",
    timestamp,
    payload: {
      type: "token_count",
      rate_limits: {
        plan_type: "plus",
        primary: { used_percent: usedPercent, window_minutes: 300, resets_at: 1_700_000_000 },
        secondary: { used_percent: 10, window_minutes: 10_080, resets_at: 1_700_100_000 },
      },
    },
  });
}

test("latestRateLimitsInJsonl skips a truncated leading fragment from a tail read", () => {
  const found = latestRateLimitsInJsonl(
    `truncated","x":1}\n${rateLimitLine("2026-07-21T12:00:00.000Z", 42)}\n`,
    Date.parse("2026-07-21T11:00:00.000Z"),
  );

  expect(found?.raw.primary?.used_percent).toBe(42);
  expect(found?.timestamp).toBe(Date.parse("2026-07-21T12:00:00.000Z"));
});

test("findLatestCodexRateLimits reads only the tail of huge session files", async () => {
  const root = await mkdtemp(join(tmpdir(), "roder-codex-rate-limits-"));
  const sessions = join(root, "sessions", "2026", "07", "21");
  await mkdir(sessions, { recursive: true });

  const hugePath = join(sessions, "huge-old.jsonl");
  const recentPath = join(sessions, "recent.jsonl");

  // ~40MB of padding with a stale rate-limit event at the start. Loading this whole
  // file into the Electron main process is what previously OOM'd on boot.
  const stale = `${rateLimitLine("2020-01-01T00:00:00.000Z", 99)}\n`;
  const paddingLine = `${JSON.stringify({ type: "response_item", payload: { text: "x".repeat(2000) } })}\n`;
  const chunks: string[] = [stale];
  let size = stale.length;
  while (size < 40 * 1024 * 1024) {
    chunks.push(paddingLine);
    size += paddingLine.length;
  }
  await writeFile(hugePath, chunks.join(""));
  await writeFile(recentPath, `${rateLimitLine("2026-07-21T12:00:00.000Z", 17)}\n`);

  // Make the huge file newer so a naive "read top N full files by mtime" path would
  // prefer it and blow the heap — the bounded scanner must still prefer a safe read.
  const now = Date.now();
  const { utimes } = await import("node:fs/promises");
  await utimes(recentPath, now / 1000, (now - 60_000) / 1000);
  await utimes(hugePath, now / 1000, now / 1000);

  const before = process.memoryUsage().heapUsed;
  const latest = await findLatestCodexRateLimits([join(root, "sessions")]);
  const after = process.memoryUsage().heapUsed;

  // Huge file is newest but its tail has no rate_limits; scanner should fall through
  // to the recent smaller file without retaining the 40MB body.
  expect(latest?.raw.primary?.used_percent).toBe(17);
  expect(after - before).toBeLessThan(15 * 1024 * 1024);
});

test("findLatestCodexRateLimits returns the rate limits from the newest file tail", async () => {
  const root = await mkdtemp(join(tmpdir(), "roder-codex-rate-limits-"));
  const sessions = join(root, "sessions");
  await mkdir(sessions, { recursive: true });

  await writeFile(join(sessions, "older.jsonl"), `${rateLimitLine("2026-07-20T12:00:00.000Z", 5)}\n`);
  await writeFile(
    join(sessions, "newer.jsonl"),
    `${"y".repeat(100)}\n${rateLimitLine("2026-07-21T12:00:00.000Z", 33)}\n`,
  );

  const latest = await findLatestCodexRateLimits([sessions]);
  expect(latest?.raw.primary?.used_percent).toBe(33);
  expect(latest?.planType).toBe("plus");
});

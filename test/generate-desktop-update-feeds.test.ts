import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

test("generate-desktop-update-feeds writes R2-hosted Sparkle feeds", () => {
  const distDir = mkdtempSync(join(tmpdir(), "roder-feeds-"));
  try {
    writeFileSync(join(distDir, "Roder-macos-arm64.zip"), "fake-zip-bytes");

    const result = spawnSync(process.execPath, ["scripts/generate-desktop-update-feeds.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DIST_DIR: distDir,
        R2_PUBLIC_BASE_URL: "https://dl.roder.sh",
        CHANNEL_PREFIX: "desktop/latest",
        VERSION: "0.1.2",
        TAG: "v0.1.2",
        PUB_DATE: "2026-07-21T15:00:00Z",
        RELEASE_NOTES: "Test notes",
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);

    const updates = JSON.parse(readFileSync(join(distDir, "updates.json"), "utf8"));
    expect(updates).toEqual({
      url: "https://dl.roder.sh/desktop/latest/Roder-macos-arm64.zip",
      name: "0.1.2",
      notes: "Test notes",
      pub_date: "2026-07-21T15:00:00Z",
    });

    const appcast = readFileSync(join(distDir, "appcast.xml"), "utf8");
    expect(appcast).toContain("https://dl.roder.sh/desktop/latest/appcast.xml");
    expect(appcast).toContain("https://dl.roder.sh/desktop/latest/Roder-macos-arm64.zip");
    expect(appcast).toContain("<sparkle:version>0.1.2</sparkle:version>");
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
});

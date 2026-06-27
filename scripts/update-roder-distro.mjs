// Manage the upstream Roder version roder-desktop embeds.
//
// Usage:
//   node scripts/update-roder-distro.mjs <version>   pin <version> in the config
//                                                     + distro crate, refresh lock
//   node scripts/update-roder-distro.mjs             re-sync to the configured
//                                                     version + refresh lock
//   node scripts/update-roder-distro.mjs --check     compare the pin against
//                                                     crates.io latest (no writes)
//   node scripts/update-roder-distro.mjs <version> --build   also build after pin

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { readDistroConfig, setDistroVersion } from "./lib/roder-distro.mjs";

async function fetchLatestCratesVersion(crate) {
  try {
    const response = await fetch(`https://crates.io/api/v1/crates/${crate}`, {
      headers: { "User-Agent": "roder-desktop-distro (version management)" },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.crate?.max_stable_version ?? data?.crate?.max_version ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const build = args.includes("--build");
  const positional = args.filter((arg) => !arg.startsWith("--"));

  const config = readDistroConfig();

  if (check) {
    const latest = await fetchLatestCratesVersion(config.crate);
    console.log(`[roder-distro] crate:          ${config.crate}`);
    console.log(`[roder-distro] pinned version: ${config.version}`);
    console.log(`[roder-distro] crates.io latest: ${latest ?? "unknown (offline?)"}`);
    if (latest && latest !== config.version) {
      console.log(`[roder-distro] update available -> pnpm roder:distro:update ${latest}`);
    }
    return;
  }

  const version = positional[0] ?? config.version;
  const { configPath, manifestPath } = setDistroVersion(version);
  console.log(`[roder-distro] pinned roder ${version}`);
  console.log(`[roder-distro]   ${configPath}`);
  console.log(`[roder-distro]   ${manifestPath}`);

  // Refresh the distro crate lockfile so the pin is reflected deterministically.
  const lockResult = spawnSync(
    "cargo",
    ["update", "--manifest-path", resolve(config.distroDir, "Cargo.toml"), "-p", config.crate, "--precise", version],
    { cwd: config.distroDir, stdio: "inherit", env: process.env },
  );
  if (lockResult.status !== 0) {
    console.warn(
      `[roder-distro] could not refresh Cargo.lock automatically; run ` +
        `\`cargo update -p ${config.crate} --precise ${version}\` in ${config.distroPath}`,
    );
  }

  if (build) {
    const { bundleRoderBinary } = await import("./lib/roder-distro.mjs");
    bundleRoderBinary({ release: true });
  } else {
    console.log("[roder-distro] next: pnpm roder:distro:build (debug) or pnpm roder:distro:release");
  }
}

main().catch((error) => {
  console.error(`[roder-distro] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

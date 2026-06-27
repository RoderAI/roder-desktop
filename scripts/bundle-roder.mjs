// Build roder-desktop's embedded `roder` binary from the pinned upstream
// crates.io release (see roder-distro-config.toml) and copy it to
// resources/bin/roder. Used by `pnpm dev` / `pnpm bundle:roder`.
//
// Defaults to a debug build for fast iteration. Pass --release (or set
// RODER_DISTRO_RELEASE=1) for an optimized binary. Packaging uses the release
// path via scripts/install-roder-for-build.mjs.

import { bundleRoderBinary } from "./lib/roder-distro.mjs";

const release = process.argv.includes("--release") || process.env.RODER_DISTRO_RELEASE === "1";

try {
  bundleRoderBinary({ release });
} catch (error) {
  console.error(`[bundle:roder] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

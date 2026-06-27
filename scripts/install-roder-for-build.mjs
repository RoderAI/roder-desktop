// Release build of roder-desktop's embedded `roder` binary, invoked by the
// electron-forge `prePackage` hook (see forge.config.ts). Builds the
// `roder-desktop-distro` crate from the pinned upstream crates.io release and
// installs it at resources/bin/roder.

import { bundleRoderBinary } from "./lib/roder-distro.mjs";

try {
  bundleRoderBinary({ release: true });
} catch (error) {
  console.error(`[build:roder] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

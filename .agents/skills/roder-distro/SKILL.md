---
name: roder-distro
description: Use when building, pinning, upgrading, downgrading, or debugging the upstream Roder agent harness that roder-desktop embeds. Covers roder-distro-config.toml, the roder-desktop-distro crate, the bundle/install scripts, and how the Electron shell links to resources/bin/roder. Triggers include "bump roder", "upgrade roder", "which roder version", "rebuild the roder binary", "embedded roder", or any work on the roder binary the desktop app ships.
---

# Roder Distribution Management

roder-desktop ships an embedded `roder` agent-harness binary. That binary is
built from a **pinned upstream release published to crates.io**, NOT from the
local `~/w/roder` checkout. This skill is the source of truth for how that works
and how to change the embedded version.

## Architecture (how the pieces link)

```
roder-distro-config.toml        # [roder].version pins the upstream crates.io release (source of truth)
   |                            #   kept in sync with v
roder-desktop-distro/           # standalone Cargo workspace (like vex's vex-roder/)
   Cargo.toml                   #   roder = "<version>"  (the real Cargo pin)
   src/main.rs                  #   calls roder::run_distribution(...) -> [[bin]] name = "roder"
   |  cargo build (--release)
   v
resources/bin/roder            # the bundled binary (gitignored)
   |  forge.config.ts extraResource -> process.resourcesPath/bin/roder
   v
electron/roder/app-server-client.ts   # spawns `roder app-server --listen stdio://`
```

Key facts:

- Roder is the published `roder` crate on crates.io. It exposes both the `roder`
  CLI binary and a library entrypoint `roder::run_distribution(DistributionOptions { .. })`.
- `roder-desktop-distro` is a **standalone Cargo workspace** (it has its own
  `[workspace]` table). It is excluded from the pnpm/JS workspace and must not be
  compiled from `~/w/roder`. It depends only on the crates.io release.
- The desktop build NEVER builds upstream roder from source in `~/w/roder`.
  `~/w/roder` is reference-only.
- `scripts/lib/roder-distro.mjs` enforces that `roder-distro-config.toml` and
  `roder-desktop-distro/Cargo.toml` pin the same version; a mismatch fails the
  build with the exact fix command.

## Commands (run from the repo root)

| Goal | Command |
| --- | --- |
| See pinned vs crates.io latest | `pnpm roder:distro:check` |
| Pin/upgrade/downgrade a version | `pnpm roder:distro:update <version>` |
| Debug build into resources/bin | `pnpm roder:distro:build` (alias `pnpm bundle:roder`) |
| Release build into resources/bin | `pnpm roder:distro:release` |
| Pin + build in one step | `node scripts/update-roder-distro.mjs <version> --build` |

`pnpm dev` runs `pnpm bundle:roder` automatically. Packaging (`pnpm make` /
`pnpm dist`) runs the release build through the electron-forge `prePackage`
hook (`scripts/install-roder-for-build.mjs`).

## Upgrade / downgrade workflow

1. Check what is available:
   ```sh
   pnpm roder:distro:check
   ```
2. Pin the target version (updates BOTH `roder-distro-config.toml` and
   `roder-desktop-distro/Cargo.toml`, then refreshes the distro `Cargo.lock`):
   ```sh
   pnpm roder:distro:update <version>
   ```
3. Build and smoke-test the binary:
   ```sh
   pnpm roder:distro:release
   ./resources/bin/roder --version
   ./resources/bin/roder app-server schema --format manifest | head
   ```
4. Launch the desktop app to confirm the app-server connects:
   ```sh
   pnpm dev
   ```
5. Commit `roder-distro-config.toml`, `roder-desktop-distro/Cargo.toml`, and
   `roder-desktop-distro/Cargo.lock`. Do NOT commit `resources/bin/*` (gitignored).

## Adding desktop-only extensions

If roder-desktop ever needs tools/providers beyond stock upstream roder, do NOT
fork upstream. Register them through `roder::run_distribution` in
`roder-desktop-distro/src/main.rs`:

```rust
roder::run_distribution(roder::DistributionOptions {
    extra_extensions: vec![std::sync::Arc::new(my_extension)],
    inference_providers: None,
})
```

This mirrors how `~/w/vex/vex-roder` registers the Vex MCP tools extension.

## Rules

- Never repoint the build at `~/w/roder` or a sibling source tree. Use the
  crates.io pin. (`RODER_SOURCE_DIR` and `make install`-from-sibling are retired.)
- Keep `roder-distro-config.toml` and the distro crate's `roder` dependency in
  sync; let `pnpm roder:distro:update` change both. The build refuses to run on
  drift.
- A first build downloads and compiles the upstream crate tree, so it is slow;
  subsequent builds are incremental.
- Only pin versions that actually exist on crates.io (`pnpm roder:distro:check`).

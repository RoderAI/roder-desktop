# roder-desktop-distro

Roder Desktop's distribution of the [Roder](https://crates.io/crates/roder)
agent harness. It embeds the full upstream `roder` CLI built from a pinned
crates.io release and produces the binary the Electron shell bundles at
`resources/bin/roder`.

This crate is a **standalone Cargo workspace** (like vex's `vex-roder/`). It is
intentionally excluded from the desktop project's JS/pnpm workspace and depends
only on the published Roder crate from crates.io -- it never compiles from the
local `~/w/roder` checkout.

## Why a wrapper crate?

- **Versioned upstream builds.** The embedded binary comes from a pinned
  crates.io release (`roder-distro-config.toml`), not a sibling source tree, so
  desktop builds are reproducible.
- **A single extension seam.** `roder::run_distribution` is the supported way to
  register desktop-only extensions/providers without forking upstream roder.
  Add them in `src/main.rs`.

## Version pinning

The pinned version lives in two places that are kept in sync and verified at
build time:

- `../roder-distro-config.toml` -> `[roder].version` (human-facing source of
  truth)
- `Cargo.toml` -> `roder = "<version>"` (the actual Cargo pin)

Change both at once from the repo root:

```sh
pnpm roder:distro:update <version>   # e.g. pnpm roder:distro:update 0.1.4
pnpm roder:distro:check              # compare the pin against crates.io latest
```

## Building

The desktop scripts drive this for you; you rarely build it by hand.

```sh
# from the repo root
pnpm roder:distro:build     # debug build -> resources/bin/roder (used by pnpm dev)
pnpm roder:distro:release   # release build -> resources/bin/roder (used by packaging)

# directly, if needed
cargo build --release --bin roder
```

The compiled binary is the stock roder CLI, so it also works standalone:

```sh
cargo run -- app-server --listen stdio://
cargo run -- exec --json -
```

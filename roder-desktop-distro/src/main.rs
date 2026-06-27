//! Roder Desktop distribution of the upstream Roder agent harness.
//!
//! This binary embeds the full upstream `roder` CLI (TUI, exec, app-server, ...)
//! built from the published crates.io release pinned in the repo-root
//! `roder-distro-config.toml`. The Electron shell bundles the compiled binary at
//! `resources/bin/roder` and drives it via `roder app-server --listen stdio://`
//! (see `electron/roder/app-server-client.ts`).
//!
//! It exists so roder-desktop builds from a versioned upstream release instead
//! of the local `~/w/roder` checkout, while leaving a single, supported place to
//! register desktop-specific extensions through `roder::run_distribution`.

fn main() -> anyhow::Result<()> {
    roder::run_distribution(roder::DistributionOptions {
        // No desktop-specific extensions today; the stock upstream CLI is
        // bundled verbatim. Add `Arc<dyn roder::RoderExtension>` entries here to
        // ship desktop-only tools without forking upstream roder.
        extra_extensions: Vec::new(),
        // Keep upstream provider resolution (env / user config).
        inference_providers: None,
    })
}

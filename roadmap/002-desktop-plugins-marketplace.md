# Desktop Plugins Marketplace PRD

**Status:** Complete
**Current Stage:** 2 - Runtime Smoke And Follow-Up Gaps
**Owner:** Codex
**Created:** 2026-05-18
**Updated:** 2026-05-19
**Related:** `/Users/pz/w/gode/docs/app-server/api.md`, `/Users/pz/w/gode/crates/roder-app-server/src/marketplaces.rs`, `roadmap/001-desktop-custom-user-extensions.md`

---

## Overview

### Problem

Roder Desktop has a local Extensions surface for `.rdx` packages and development folders, but it does not expose the app-server's plugin marketplace APIs. The sidebar also has an inert Marketplace row. Users need a first-class, full-width Plugins view in the main app surface that can list marketplaces, search de-duplicated plugin groups, preview risk/component metadata, install variants, and manage installed plugin records through the bundled app-server.

### Goals

- [x] Rename the user-facing marketplace entry point to Plugins.
- [x] Add typed desktop renderer APIs for the app-server `marketplaces/*` and `plugins/*` methods.
- [x] Build a full-width main Plugins view that lists marketplaces, searches plugins, installs plugin variants, and manages installed records.
- [x] Keep the existing local Extensions screen intact for desktop `.rdx` and dev-folder extensions.
- [x] Record verification evidence for the UI wiring and API contract.

### Non-goals

- Do not execute installed marketplace plugin code in this slice.
- Do not replace the existing local Extensions catalog, extension host, or `.rdx` packaging flow.
- Do not add a remote marketplace review/signing policy in this slice.
- Do not refactor the app-server marketplace implementation in `/Users/pz/w/gode` unless the desktop integration exposes a contract bug.

### Success Metrics

- The left sidebar opens a main app view labeled Plugins, not Marketplace or a nested Settings section.
- The Plugins screen can call `marketplaces/list`, `marketplaces/install_default`, `marketplaces/refresh`, `marketplaces/search`, `plugins/preview_install`, `plugins/install`, `plugins/install_all_variants`, `plugins/list_installed`, `plugins/disable`, and `plugins/uninstall`.
- Installed variants show state, source marketplace, install path, and disable/uninstall actions.
- Search results show provider variants, component hints, risk, and install controls.
- `pnpm test`, `pnpm typecheck`, `pnpm build`, and the roadmap validator pass or record actionable gaps.

## Current Repo State

- At discovery, `src/components/app-sidebar.tsx` had a `Marketplace` row with no click handler.
- `src/components/settings-view.tsx` hosts a settings overlay and an Extensions section; Plugins should remain outside Settings.
- `src/stores/theme-store.ts` persists `settingsSection` and should normalize any older persisted `plugins` setting back to a valid Settings section.
- `src/lib/roder-ipc.ts` wraps a small subset of app-server methods through `window.roderDesktop.request`.
- `src/types/roder.ts` exposes the generic `request(method, params)` bridge; no new main-process IPC is required for app-server method calls.
- `src/stores/roder-store.ts` is over 500 lines, so marketplace state must live in a separate store.
- `/Users/pz/w/gode/docs/app-server/api.md` documents the app-server marketplace/plugin methods and DTO behavior.
- `/Users/pz/w/gode/crates/roder-protocol/src/lib.rs` defines the marketplace and plugin request/result structs.
- Dirty worktree note: `docs/api.md`, `electron/main/index.ts`, `roadmap/001-desktop-custom-user-extensions.md`, `roadmap/STATUS.md`, and `docs/extensions.md` already had unrelated changes when this work started. Ignore unknown work and keep this PRD scoped.

## Product Requirements

### Users And Workflows

- User opens Plugins from the main sidebar to discover or manage marketplace-backed plugin records without entering Settings.
- User installs built-in marketplace descriptors, refreshes a marketplace, searches plugins, previews install risk, and installs the recommended or all variants.
- User can see installed plugin variants and disable or uninstall a variant without changing local `.rdx` extensions.

### Functional Requirements

- `P0`: Add a Plugins navigation entry that replaces the inert Marketplace sidebar label and selects a full-width main view.
- `P0`: Add app-server client wrappers for every documented marketplace/plugin method in this slice.
- `P0`: Add a separate Plugins store with loading/error/result state, marketplace list, search results, previews, and installed variants.
- `P0`: List marketplaces with enabled/default/state/source metadata and actions for install defaults, refresh, and remove.
- `P0`: Search plugins with an empty query as the all-results view.
- `P0`: Install a selected variant and install all variants in a de-duplicated group.
- `P0`: Preview install metadata before install and display the risk/component hints returned by the app-server.
- `P0`: List installed variants with disable and uninstall actions.
- `P1`: Allow adding a local marketplace path through typed form inputs.
- `P1`: Preserve app-server errors as visible UI messages.

### UX Requirements

- Use the visible label `Plugins` for the marketplace view.
- Keep Plugins outside Settings; selecting Plugins in the app sidebar should replace the chat transcript/composer area.
- Keep the screen dense and operational, matching the desktop settings/tooling style.
- Avoid a marketing landing page; the first view should show controls, marketplace state, search results, and installed records.
- Use standard Tailwind spacing tokens and existing UI primitives.
- Show loading, empty, error, preview, installed, disabled, and no-results states.

### Data And State

- Marketplace/plugin data is app-server owned and persists in `~/.roder/marketplaces.json` and plugin cache paths as documented by the backend.
- Desktop stores only transient UI state for loading, search query, previews, and the latest result message.
- Installed state comes from `plugins/list_installed` and `installedVariants` in search rows.

## Technical Plan

### Owned Paths

- Create: `roadmap/002-desktop-plugins-marketplace.md`
- Modify: `roadmap/STATUS.md`
- Create: `src/types/plugins.ts`
- Create: `src/lib/plugins-ipc.ts`
- Create: `src/lib/plugins-marketplace.ts`
- Create: `src/stores/plugins-store.ts`
- Create: `src/components/plugins/plugins-marketplace-panel.tsx`
- Modify: `src/components/app-sidebar.tsx`
- Modify: `src/components/top-bar.tsx`
- Modify: `src/components/settings-view.tsx`
- Modify: `src/stores/theme-store.ts`
- Modify: `scripts/bundle-roder.mjs`
- Sibling modify: `/Users/pz/w/gode/crates/roder-extension-host/src/marketplace/mod.rs`
- Verify: `test/*.test.mjs`, `package.json`

### Dependency Checks

- Confirm the sibling `~/w/gode` app-server currently registers the methods. Fallback: keep wrappers but show app-server errors if the bundled binary is stale.
- Confirm `scripts/bundle-roder.mjs` builds the sibling `/Users/pz/w/gode` binary before desktop build. Fallback: run `RODER_SOURCE_DIR=/Users/pz/w/gode pnpm build`.
- Do not edit `src/stores/roder-store.ts`; create a dedicated store because it is already above the 500-line split threshold.

### Architecture

The renderer calls the existing constrained app-server bridge through a typed `pluginsIpc` wrapper. `plugins-store` owns transient state and composes calls such as reload, refresh, install, disable, and uninstall. The Plugins panel is a main app view opened from the primary sidebar and rendered full width in the content area. It intentionally does not use the local Extensions catalog because marketplace-backed plugins are app-server records, while Extensions are desktop-hosted `.rdx` packages.

## Implementation Stages

### Stage 0: Discovery

**Status:** Complete
**Owned Paths:** `roadmap/002-desktop-plugins-marketplace.md`, `/Users/pz/w/gode/docs/app-server/api.md`, `/Users/pz/w/gode/crates/roder-protocol/src/lib.rs`, `src/components/app-sidebar.tsx`, `src/stores/theme-store.ts`

- [x] Inspect roadmap state and choose the next PRD id.
- [x] Inspect dirty worktree state and identify unrelated concurrent work.
- [x] Inspect app-server marketplace/plugin methods and protocol DTOs.
- [x] Inspect existing desktop settings/sidebar/IPC/store boundaries.

Run:

```sh
git status --short
find roadmap -maxdepth 1 -type f -name '*.md' -print | sort
rg -n "marketplaces/|plugins/" /Users/pz/w/gode/docs/app-server/api.md /Users/pz/w/gode/crates/roder-protocol/src/lib.rs /Users/pz/w/gode/crates/roder-app-server/src
```

Acceptance:

- The PRD names the live app-server method surface and current desktop ownership boundaries.

### Stage 1: Desktop API And Screen

**Status:** Complete
**Owned Paths:** `src/types/plugins.ts`, `src/lib/plugins-ipc.ts`, `src/lib/plugins-marketplace.ts`, `src/stores/plugins-store.ts`, `src/components/plugins/plugins-marketplace-panel.tsx`, `src/components/app-sidebar.tsx`, `src/components/top-bar.tsx`, `src/components/settings-view.tsx`, `src/stores/theme-store.ts`

- [x] Add TypeScript types matching the app-server marketplace/plugin DTOs.
- [x] Add typed IPC wrappers for the documented marketplace/plugin methods.
- [x] Add a dedicated Plugins store with load/search/refresh/install/disable/uninstall operations.
- [x] Add a Plugins view and wire it from the sidebar as a main app view, not a Settings subsection.
- [x] Add focused utility tests for variant selection/state mapping.

Run:

```sh
pnpm test
pnpm typecheck
pnpm build
```

Acceptance:

- The sidebar opens a full-width Plugins main view.
- The Plugins screen has visible controls for marketplace list, default install, local marketplace add, refresh, search, preview, install, install all variants, disable, and uninstall.
- Typed wrappers call the exact app-server methods documented in `/Users/pz/w/gode/docs/app-server/api.md`.

### Stage 2: Runtime Smoke And Follow-Up Gaps

**Status:** Complete
**Owned Paths:** desktop app runtime, `roadmap/002-desktop-plugins-marketplace.md`, `roadmap/STATUS.md`

- [x] Build with the bundled sibling app-server.
- [x] Smoke the Plugins screen against the running app when feasible.
- [x] Record app-server/API gaps that should move to `/Users/pz/w/gode` instead of papering them over in the renderer.

Run:

```sh
pnpm build
```

Acceptance:

- Verification evidence names whether the current bundled app-server supports the marketplace/plugin calls.

## Verification Plan

### Automated Checks

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- `python3 "${CODEX_HOME:-$HOME/.codex}/skills/roadmap-prd-verifier/scripts/validate_roadmap.py" roadmap/002-desktop-plugins-marketplace.md`

### Manual Checks

- Open Plugins from the sidebar and confirm the full-width main UI is labeled Plugins.
- Confirm app-server error states are visible if the bundled binary cannot satisfy a method.
- Confirm marketplace/plugin result data is not confused with local Extensions catalog data.

### Rollback Or Recovery

- Remove the `plugins` main view state, sidebar handler, Plugins component/store, and typed wrappers.
- Existing Extensions APIs remain separate and should continue to work.
- Backend marketplace state can be manually reset by removing `~/.roder/marketplaces.json` and plugin cache markers if test installs are undesirable.

## Evidence Log

### 2026-05-18 - Discovery And PRD

- Evidence: inspected existing roadmap, dirty worktree, desktop settings/sidebar/store boundaries, and `/Users/pz/w/gode` app-server marketplace/plugin methods.
- Commands: `git status --short`; `find roadmap -maxdepth 1 -type f -name '*.md' -print`; `rg -n "marketplaces/|plugins/" /Users/pz/w/gode/docs/app-server/api.md /Users/pz/w/gode/crates/roder-protocol/src/lib.rs /Users/pz/w/gode/crates/roder-app-server/src`; targeted `sed -n` reads.
- Gaps: implementation and verification still in progress.

### 2026-05-18 - Desktop Plugins Screen And API Wrappers

- Evidence: added typed marketplace/plugin DTOs, app-server method wrappers, a dedicated Plugins store, focused marketplace utility helpers, the initial Plugins settings screen, settings navigation, and the sidebar Plugins entry. Fixed `scripts/bundle-roder.mjs` so desktop builds infer `/Users/pz/w/gode` instead of `/Users/pz/w/w`.
- Commands: `pnpm test` passed 31 tests; `pnpm typecheck` passed; `pnpm build` passed after rebundling and signing `resources/bin/roder` from `/Users/pz/w/gode`.
- Gaps: interactive Electron click-through of the Plugins screen has not been run.

### 2026-05-18 - App-Server Marketplace Contract Fixes

- Evidence: app-server stdio smoke initially exposed live default-marketplace failures for invalid homepage/author identity keys and Codex `"source": "github"` plugin manifests. Fixed the normalizer in `/Users/pz/w/gode/crates/roder-extension-host/src/marketplace/mod.rs` and added regression tests. A concurrent TUI module issue briefly blocked rebundling, but the current sibling checkout now builds the desktop binary.
- Commands: `cargo fmt -p roder-extension-host --check`; `cargo test -p roder-extension-host marketplace::tests`; `cargo test -p roder-app-server --test e2e marketplace_methods -- --test-threads=1`; `pnpm build`; stdio smoke with temp `RODER_MARKETPLACES_PATH`, `marketplaces/install_default`, `marketplaces/search`, and `plugins/list_installed` returned marketplace/search results without errors.
- Gaps: `cargo test -p roder-app-server marketplace_methods` without `--test-threads=1` failed because the existing tests mutate shared marketplace environment variables in parallel.

### 2026-05-18 - Roadmap Validation

- Evidence: direct validator invocation still crashes on the installed skill's malformed placeholder regex; the same validator passed when run through a one-process regex shim without editing the installed skill.
- Commands: `python3 "${CODEX_HOME:-$HOME/.codex}/skills/roadmap-prd-verifier/scripts/validate_roadmap.py" roadmap/002-desktop-plugins-marketplace.md` crashed with `re.PatternError`; shimmed single-file and full-roadmap validation both passed.
- Gaps: installed validator script still has the regex bug.

### 2026-05-19 - Plugins Promoted To Main View

- Evidence: moved Plugins out of Settings into a main app view selected by the primary sidebar. Removed the Settings nav item, normalized persisted legacy `settingsSection: "plugins"` values, changed the top bar title for the Plugins view, and changed the marketplace panel shell to fill the content area without the Settings max-width/card wrapper.
- Commands: `pnpm test` passed 31 tests; `pnpm typecheck` passed; `git diff --check` passed; `pnpm build` passed after rebundling/signing `/Users/pz/w/gode-desktop/resources/bin/roder` from `/Users/pz/w/gode`; shimmed full-roadmap validation passed; `pnpm run dev` launched the Electron app, `/opt/homebrew/bin/cliclick c:300,160` selected Plugins from the main sidebar, and `/Users/pz/tmp/roder-plugin-smoke-after4.png` confirmed the full-width main Plugins view without the Settings shell.
- Gaps: `pnpm build` still emits the existing `/Users/pz/w/gode` `roder-tui` dead-code warning for `push_assistant_delta`; direct roadmap validation remains blocked by the installed validator regex bug, so validation used the documented one-process shim.

### 2026-05-19 - Marketplace Enable CTA

- Evidence: default marketplaces in `bakedIn`, `removedByUser`, or otherwise inactive states now render as `Not enabled` and expose a per-row `Enable` button. The button calls the existing `marketplaces/install_default` app-server method for that specific default marketplace, while active marketplaces show `Enabled` and keep refresh available.
- Commands: `pnpm test` passed 32 tests including a new marketplace enablement utility regression; `pnpm typecheck` passed; `git diff --check` passed; `pnpm build` passed; `pnpm run dev` launched the Electron app, `/opt/homebrew/bin/cliclick c:300,160` selected Plugins, and `/Users/pz/tmp/roder-marketplace-enable-smoke.png` confirmed visible `Not enabled` badges and `Enable` buttons for Codex and Cursor defaults.
- Gaps: visual smoke intentionally did not click `Enable`, to avoid mutating the user's local marketplace state during verification.

### 2026-05-19 - Plugins Top Bar Removed

- Evidence: the app-level `TopBar` is now mounted only for the chat view, so the Plugins view no longer shows the duplicate title/tool row above the Plugins panel header. Removed the `TopBar` `mainTitle` special case because Plugins no longer uses the top bar.
- Commands: `pnpm test` passed 32 tests; `pnpm typecheck` passed; `git diff --check` passed; `pnpm build` passed. `pnpm run dev` launched, but screenshot capture was blocked by the macOS loginwindow display shield in this environment.
- Gaps: no interactive screenshot artifact was captured for this specific title-bar removal because the desktop was shielded by loginwindow during the smoke attempt.

## Open Questions

- [ ] Product owner: decide whether installed marketplace plugin records should eventually feed directly into the local Extensions host, workflow imports, or a distinct plugin activation pipeline.

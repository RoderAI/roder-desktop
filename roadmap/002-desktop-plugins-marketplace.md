# Desktop Plugins Marketplace PRD

**Status:** In progress
**Current Stage:** 1 - Desktop API And Screen
**Owner:** Codex
**Created:** 2026-05-18
**Updated:** 2026-05-18
**Related:** `/Users/pz/w/gode/docs/app-server/api.md`, `/Users/pz/w/gode/crates/roder-app-server/src/marketplaces.rs`, `roadmap/001-desktop-custom-user-extensions.md`

---

## Overview

### Problem

Roder Desktop has a local Extensions surface for `.rdx` packages and development folders, but it does not expose the app-server's plugin marketplace APIs. The sidebar also has an inert Marketplace row. Users need a first-class Plugins screen that can list marketplaces, search de-duplicated plugin groups, preview risk/component metadata, install variants, and manage installed plugin records through the bundled app-server.

### Goals

- [ ] Rename the user-facing marketplace entry point to Plugins.
- [ ] Add typed desktop renderer APIs for the app-server `marketplaces/*` and `plugins/*` methods.
- [ ] Build a Plugins screen that lists marketplaces, searches plugins, installs plugin variants, and manages installed records.
- [ ] Keep the existing local Extensions screen intact for desktop `.rdx` and dev-folder extensions.
- [ ] Record verification evidence for the UI wiring and API contract.

### Non-goals

- Do not execute installed marketplace plugin code in this slice.
- Do not replace the existing local Extensions catalog, extension host, or `.rdx` packaging flow.
- Do not add a remote marketplace review/signing policy in this slice.
- Do not refactor the app-server marketplace implementation in `/Users/pz/w/gode` unless the desktop integration exposes a contract bug.

### Success Metrics

- The left sidebar opens a screen labeled Plugins, not Marketplace.
- The Plugins screen can call `marketplaces/list`, `marketplaces/install_default`, `marketplaces/refresh`, `marketplaces/search`, `plugins/preview_install`, `plugins/install`, `plugins/install_all_variants`, `plugins/list_installed`, `plugins/disable`, and `plugins/uninstall`.
- Installed variants show state, source marketplace, install path, and disable/uninstall actions.
- Search results show provider variants, component hints, risk, and install controls.
- `pnpm test`, `pnpm typecheck`, `pnpm build`, and the roadmap validator pass or record actionable gaps.

## Current Repo State

- `src/components/app-sidebar.tsx` has a `Marketplace` row with no click handler.
- `src/components/settings-view.tsx` already hosts a settings overlay and an Extensions section.
- `src/stores/theme-store.ts` persists `settingsSection` and currently knows the `extensions` section but not `plugins`.
- `src/lib/roder-ipc.ts` wraps a small subset of app-server methods through `window.roderDesktop.request`.
- `src/types/roder.ts` exposes the generic `request(method, params)` bridge; no new main-process IPC is required for app-server method calls.
- `src/stores/roder-store.ts` is over 500 lines, so marketplace state must live in a separate store.
- `/Users/pz/w/gode/docs/app-server/api.md` documents the app-server marketplace/plugin methods and DTO behavior.
- `/Users/pz/w/gode/crates/roder-protocol/src/lib.rs` defines the marketplace and plugin request/result structs.
- Dirty worktree note: `docs/api.md`, `electron/main/index.ts`, `roadmap/001-desktop-custom-user-extensions.md`, `roadmap/STATUS.md`, and `docs/extensions.md` already had unrelated changes when this work started. Ignore unknown work and keep this PRD scoped.

## Product Requirements

### Users And Workflows

- User opens Plugins from the sidebar to discover or manage marketplace-backed plugin records.
- User installs built-in marketplace descriptors, refreshes a marketplace, searches plugins, previews install risk, and installs the recommended or all variants.
- User can see installed plugin variants and disable or uninstall a variant without changing local `.rdx` extensions.

### Functional Requirements

- `P0`: Add a Plugins navigation entry that replaces the inert Marketplace sidebar label.
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

- Use the visible label `Plugins` for the marketplace screen.
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
- Modify: `src/components/settings-view.tsx`
- Modify: `src/stores/theme-store.ts`
- Verify: `test/*.test.mjs`, `package.json`

### Dependency Checks

- Confirm the sibling `~/w/gode` app-server currently registers the methods. Fallback: keep wrappers but show app-server errors if the bundled binary is stale.
- Confirm `scripts/bundle-roder.mjs` builds the sibling `/Users/pz/w/gode` binary before desktop build. Fallback: run `RODER_SOURCE_DIR=/Users/pz/w/gode pnpm build`.
- Do not edit `src/stores/roder-store.ts`; create a dedicated store because it is already above the 500-line split threshold.

### Architecture

The renderer calls the existing constrained app-server bridge through a typed `pluginsIpc` wrapper. `plugins-store` owns transient state and composes calls such as reload, refresh, install, disable, and uninstall. The Plugins panel is a normal settings screen opened from the sidebar and settings navigation. It intentionally does not use the local Extensions catalog because marketplace-backed plugins are app-server records, while Extensions are desktop-hosted `.rdx` packages.

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

**Status:** In progress
**Owned Paths:** `src/types/plugins.ts`, `src/lib/plugins-ipc.ts`, `src/lib/plugins-marketplace.ts`, `src/stores/plugins-store.ts`, `src/components/plugins/plugins-marketplace-panel.tsx`, `src/components/app-sidebar.tsx`, `src/components/settings-view.tsx`, `src/stores/theme-store.ts`

- [ ] Add TypeScript types matching the app-server marketplace/plugin DTOs.
- [ ] Add typed IPC wrappers for the documented marketplace/plugin methods.
- [ ] Add a dedicated Plugins store with load/search/refresh/install/disable/uninstall operations.
- [ ] Add a Plugins screen and wire it from the sidebar and settings navigation.
- [ ] Add focused utility tests for variant selection/state mapping.

Run:

```sh
pnpm test
pnpm typecheck
pnpm build
```

Acceptance:

- The sidebar opens a Plugins screen.
- The Plugins screen has visible controls for marketplace list, default install, local marketplace add, refresh, search, preview, install, install all variants, disable, and uninstall.
- Typed wrappers call the exact app-server methods documented in `/Users/pz/w/gode/docs/app-server/api.md`.

### Stage 2: Runtime Smoke And Follow-Up Gaps

**Status:** Ready
**Owned Paths:** desktop app runtime, `roadmap/002-desktop-plugins-marketplace.md`, `roadmap/STATUS.md`

- [ ] Build with the bundled sibling app-server.
- [ ] Smoke the Plugins screen against the running app when feasible.
- [ ] Record app-server/API gaps that should move to `/Users/pz/w/gode` instead of papering them over in the renderer.

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

- Open Plugins from the sidebar and confirm the UI is labeled Plugins.
- Confirm app-server error states are visible if the bundled binary cannot satisfy a method.
- Confirm marketplace/plugin result data is not confused with local Extensions catalog data.

### Rollback Or Recovery

- Remove the `plugins` settings section, sidebar handler, Plugins component/store, and typed wrappers.
- Existing Extensions APIs remain separate and should continue to work.
- Backend marketplace state can be manually reset by removing `~/.roder/marketplaces.json` and plugin cache markers if test installs are undesirable.

## Evidence Log

### 2026-05-18 - Discovery And PRD

- Evidence: inspected existing roadmap, dirty worktree, desktop settings/sidebar/store boundaries, and `/Users/pz/w/gode` app-server marketplace/plugin methods.
- Commands: `git status --short`; `find roadmap -maxdepth 1 -type f -name '*.md' -print`; `rg -n "marketplaces/|plugins/" /Users/pz/w/gode/docs/app-server/api.md /Users/pz/w/gode/crates/roder-protocol/src/lib.rs /Users/pz/w/gode/crates/roder-app-server/src`; targeted `sed -n` reads.
- Gaps: implementation and verification still in progress.

## Open Questions

- [ ] Product owner: decide whether installed marketplace plugin records should eventually feed directly into the local Extensions host, workflow imports, or a distinct plugin activation pipeline.

# Desktop Custom User Extensions PRD

**Status:** In progress
**Current Stage:** 6 - Developer Tooling, Packaging, And Documentation
**Owner:** Codex
**Created:** 2026-05-18
**Updated:** 2026-05-18
**Related:** `/Users/pz/w/gode` extension host, https://code.visualstudio.com/api, https://github.com/raycast/extensions

---

## Overview

### Problem

Roder Desktop is currently a closed Electron shell around the bundled Roder app-server. Users can configure models, workspaces, themes, browser/canvas/terminal panels, and MCP-facing backend behavior, but they cannot install local desktop extensions that add commands, tools, views, settings, or workflow-specific integrations without changing the app itself.

The sibling Roder backend already has a hardened native Rust extension model for built-in runtime capabilities. The missing product layer is a user-facing desktop extension platform, closer to VS Code's manifest/contribution/activation model and Raycast's TypeScript command/tool developer experience.

### Goals

- [ ] Let users install, enable, disable, update, and remove local extension packages from the desktop UI.
- [ ] Define a stable extension manifest and API surface for commands, agent tools, settings/preferences, UI panels, storage, secrets, notifications, and workspace/thread context.
- [ ] Run user extension code outside the renderer and outside the Rust app-server process, with explicit capability grants and auditability.
- [ ] Allow extension-contributed tools to participate in agent workflows through the existing app-server tool system.
- [ ] Provide a first-party developer loop with templates, type definitions, local dev mode, package validation, and hot reload.
- [ ] Keep the first version useful without promising binary compatibility with VS Code VSIX packages or Raycast extensions.

### Non-goals

- Do not run arbitrary extension code in the React renderer.
- Do not expose raw Node, Electron, shell, filesystem, network, or app-server authority by default.
- Do not make Roder Desktop execute unreviewed marketplace extensions silently.
- Do not support full VS Code extension compatibility, language servers, debug adapters, or VSIX marketplace publishing in the first phase.
- Do not replace the existing native Rust `roder-api` extension system in `/Users/pz/w/gode`.
- Do not add a remote extension marketplace before local packaging, install safety, and update semantics are stable.

### Success Metrics

- A local example extension can be created from a template, run in dev mode, install into Roder Desktop, and expose at least one command and one agent-callable tool.
- The desktop Extensions settings panel shows installed extension metadata, enabled state, capability grants, activation state, logs, and errors.
- Extension tools are visible through `tools/list` and can complete a mocked tool call through the app-server bridge.
- Extension install validation rejects path traversal, missing manifests, unsupported engine ranges, undeclared capabilities, and malformed contribution points.
- Disabling an extension removes its commands/tools/views without restarting the app.
- `pnpm typecheck`, `pnpm build`, and the focused extension-host tests pass without proprietary service access.

## Current Repo State

- `package.json` defines an Electron/Vite/React desktop app named `roder-desktop`; scripts are `pnpm dev`, `pnpm build`, `pnpm dist`, and `pnpm typecheck`.
- `scripts/bundle-roder.mjs` bundles the sibling Rust backend binary into `resources/bin/roder`; runtime backend changes require rebuilding or rebundling before desktop verification.
- `electron/main/index.ts` owns the Electron window, IPC handlers, browser panel manager, terminal manager, Codex account actions, and the `RoderAppServerClient`.
- `electron/preload/index.ts` exposes a constrained `window.roderDesktop` bridge, including generic `request(method, params)` access to the app-server.
- `electron/roder/app-server-client.ts` is already 604 lines and owns child-process lifecycle, JSON-RPC framing, desktop protocol translation, and notification conversion. Extension reverse-RPC must be split out before adding more logic.
- `src/stores/roder-store.ts` is already 544 lines and owns app bootstrapping, thread state, model selection, navigation, prompt sending, and notification handling. Extension catalog state must live in a separate store.
- `src/components/settings-view.tsx` has settings navigation and placeholders for several sections. It has no Extensions section yet.
- `src/types/roder.ts` declares the renderer-visible app-server and desktop bridge types. Extension IPC types should be kept in separate `src/types/extensions.ts` and preload types should be split by domain.
- The sibling `/Users/pz/w/gode` repo already contains native Rust extension contracts:
  - `docs/roder-extension-api.md` documents `RoderExtension`, `ExtensionManifest`, `ExtensionRegistryBuilder`, capability requests, `extensions/list`, and capability statuses.
  - `docs/roder-extension-state.md` documents host-owned, extension-scoped state and `ExtensionStateCodec`.
  - `crates/roder-extension-host/src/lib.rs` composes built-in native extensions and currently exceeds 500 lines.
  - `crates/roder-protocol/src/lib.rs` defines `ExtensionsListResult` and `ToolsListResult`.
  - `crates/roder-app-server/src/server.rs` exposes `extensions/list` and `tools/list`.
- Existing external inspiration:
  - VS Code extensions use a root `package.json` manifest with `main`, `browser`, `activationEvents`, `contributes`, `engines`, `extensionKind`, and dependency metadata.
  - VS Code contribution points are declarative JSON entries such as commands, configuration, menus, views, themes, tasks, and chat-related surfaces.
  - VS Code activation events lazy-load extensions on triggers such as command, language, view, startup, URI, and workspace conditions.
  - Raycast extensions use a TypeScript/React developer loop, `package.json` commands/tools/preferences, a support path, environment API, and `npm run dev`/`npm run build` style validation.
  - The Raycast public extensions repo is a large extension corpus with templates, docs, examples, and store review conventions.
- Dirty worktree note: `roadmap/` was untracked before this PRD. Ignore unrelated work from other agents and keep this change scoped to roadmap artifacts.

## Product Requirements

### Users And Workflows

- Extension user: installs local packages, grants requested capabilities, enables/disables extensions, configures preferences, and sees errors.
- Extension author: creates an extension from a template, writes TypeScript, tests in dev mode with hot reload, packages it, and installs it locally.
- Agent workflow user: enables extension-provided tools so the assistant can call them in turns with normal permission and audit behavior.
- Desktop product maintainer: can evolve contribution points without breaking existing extensions by using explicit engine ranges and API versioning.

### Functional Requirements

- `P0`: Extension packages use a root `package.json` manifest with Roder-specific fields under `roder` plus standard npm metadata.
- `P0`: Manifest validation supports `name`, `displayName`, `publisher`, `version`, `description`, `engines.roder`, `main`, `activationEvents`, `contributes`, `capabilities`, and optional `icon`, `repository`, `homepage`, `license`, `keywords`, and `categories`.
- `P0`: Contribution points support `commands`, `tools`, `configuration`, and `views.panels` in the first product slice.
- `P0`: Activation supports `onStartupFinished`, `onCommand:<id>`, `onTool:<id>`, `onView:<id>`, `onWorkspace`, and manual activation from the Extensions panel.
- `P0`: Extensions run in an isolated extension host process with a narrow RPC API, not in the renderer.
- `P0`: Users must approve sensitive capabilities before activation or first use. Capabilities should align with backend capability names where practical, such as `fs.read.workspace`, `fs.write.workspace`, `process.spawn.shell`, `network.web`, `secret.read`, `desktop.notification`, `appserver.request`, and `ui.panel`.
- `P0`: Extension commands can be invoked from a desktop command palette or an Extensions panel action list. If the command palette does not exist yet, this PRD must introduce the smallest command-surface needed for extension commands.
- `P0`: Extension tools can be listed by the backend and executed through a desktop-hosted proxy with request/result/error/audit events.
- `P0`: Extension settings support text, password, checkbox, dropdown, file, and directory preference types, with required-value validation.
- `P0`: Extensions get per-extension global storage and workspace storage paths plus secret storage for sensitive settings.
- `P0`: The Extensions settings UI lists installed, dev, disabled, and failed extensions and provides install, uninstall, reload, enable, disable, logs, and capability review actions.
- `P0`: Disable and safe-mode behavior can shut off user extensions without breaking core desktop startup.
- `P1`: Support dev-mode extension folders with hot reload and clear error overlays/logs.
- `P1`: Support extension webview panels with strict CSP, no Node integration, resource URI rewriting, and message passing.
- `P1`: Support packaged `.rdx` archives with deterministic manifest, lockfile, checksums, README, icon, `dist`, and assets.
- `P1`: Support CLI developer packages such as `@roderai/extension-api` and `@roderai/create-extension`.
- `P1`: Support extension update checks from trusted local paths or signed release URLs.
- `P2`: Support importing or converting selected VSIX/Raycast-style packages where APIs overlap.
- `P2`: Support a curated registry or marketplace after local install security and review semantics are proven.

### UX Requirements

- Add an Extensions entry to Settings navigation using an icon button consistent with existing settings sections.
- The Extensions panel must be operational, not explanatory marketing copy: list extensions, states, actions, capabilities, and errors.
- Install flow shows manifest metadata, source path/archive, requested capabilities, and warnings before enabling.
- Failed activation shows a concise error, logs, and a reload action.
- Extension commands/tools should include icons where available and fall back to the extension icon.
- Capability prompts must identify the extension, requested action, scope, and persistence choice.
- Extensions must never silently capture secrets. Required secret preferences block activation or tool execution until configured.
- Extension panel and prompts must remain usable at the current desktop minimum size of 980x680.

### Data And State

- Installed extensions live under Electron `app.getPath("userData")/extensions/installed/{publisher}.{name}`.
- Development extensions live as linked records under `app.getPath("userData")/extensions/dev.json` and reference source directories without copying them.
- Package archives use `.rdx` as Roder's initial extension archive format. Internally this is a zip with manifest, assets, and built output.
- Extension catalog state stores installed version, source type, enabled flag, granted/denied capabilities, activation timestamps, and last error.
- Extension runtime state stores global and workspace values per extension id, separate from preferences and secrets.
- Secret preferences and secret storage should use macOS Keychain through a main-process abstraction where available; fall back only behind an explicit insecure-dev-mode gate.
- Tool execution results must be serializable through the app-server protocol and must not leak secrets in errors, logs, `tools/list`, or `extensions/list`.

## Technical Plan

### Owned Paths

- Create: `roadmap/001-desktop-custom-user-extensions.md`
- Modify: `roadmap/STATUS.md`
- Create: `electron/extensions/manifest.ts`
- Create: `electron/extensions/catalog.ts`
- Create: `electron/extensions/package-manager.ts`
- Create: `electron/extensions/extension-host.ts`
- Create: `electron/extensions/extension-rpc.ts`
- Create: `electron/extensions/tool-proxy.ts`
- Create: `electron/extensions/storage.ts`
- Create: `electron/extensions/secrets.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Refactor: `electron/roder/app-server-client.ts`
- Create: `src/stores/extensions-store.ts`
- Create: `src/types/extensions.ts`
- Create: `src/lib/extensions-ipc.ts`
- Create: `src/components/extensions/extensions-settings-panel.tsx`
- Create: `src/components/extensions/extension-capability-review.tsx`
- Create: `src/components/extensions/extension-log-viewer.tsx`
- Modify: `src/components/settings-view.tsx`
- Modify: `src/stores/theme-store.ts`
- Modify or create: `packages/extension-api/**`
- Modify or create: `packages/create-extension/**`
- Create: `examples/extensions/hello-roder/**`
- Sibling repo modify: `/Users/pz/w/gode/crates/roder-app-server/src/server.rs`
- Sibling repo modify: `/Users/pz/w/gode/crates/roder-protocol/src/lib.rs`
- Sibling repo modify or create: `/Users/pz/w/gode/crates/roder-core/src/desktop_extension_tools.rs`
- Sibling repo create or update tests: `/Users/pz/w/gode/crates/roder-app-server/tests/e2e.rs`
- Verify: `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `/Users/pz/w/gode/docs/roder-extension-api.md`

### Dependency Checks

- Confirm Electron 42 supports the chosen isolated host primitive. Prefer `utilityProcess` if it is stable enough for Node-style extension execution; otherwise use `child_process.fork` with an explicit sandbox contract and no Electron object access.
- Confirm whether a command palette exists elsewhere in active branches before building a new one. If absent, implement a narrow extension command launcher rather than a broad palette refactor.
- Confirm backend reverse-RPC shape before implementing tool proxying. The backend currently runs over stdio and can send notifications; desktop tool execution will need request ids, cancellation, timeout, and result channels.
- Confirm that package manager scripts cannot run during install. Extension packages should be prebuilt before packaging.
- Confirm app-server extension introspection already exposes native backend extensions through `extensions/list`; desktop user extensions should appear in a merged desktop view without pretending to be native Rust extensions unless the backend registers a desktop proxy provider.
- Before editing any 500+ line file, split the relevant logic into a focused module:
  - `electron/roder/app-server-client.ts` must move JSON-RPC framing, desktop protocol mapping, or notification decoding into smaller modules before extension reverse-RPC lands.
  - `src/stores/roder-store.ts` must not absorb extension catalog state.
  - `/Users/pz/w/gode/crates/roder-extension-host/src/lib.rs` should not receive desktop user-extension code directly.

### Architecture

Use a three-layer extension architecture:

1. Desktop package/catalog layer.
   - Electron main scans, validates, installs, removes, enables, disables, and updates extensions.
   - Renderer reads catalog state through typed IPC and never directly touches extension files.
   - Package validation is deterministic and rejects unsafe archive paths, unsupported engines, missing entry points, malformed contribution ids, and undeclared sensitive APIs.

2. Desktop extension host layer.
   - A main-process-owned extension host process loads bundled JavaScript entry points.
   - Extensions export `activate(context)` and optional `deactivate()`.
   - The injected API mirrors VS Code's `context.subscriptions`, command registration, activation events, storage paths, and contribution model, plus Raycast's command/tool/preference/environment ergonomics.
   - The host API is request-scoped and capability-checked. The extension process cannot import Electron, access arbitrary Node modules from the app, or call `window.roderDesktop`.

3. Backend tool bridge layer.
   - The desktop registers extension-contributed tool specs with the bundled app-server through a new desktop tool proxy protocol.
   - When the agent calls an extension tool, the backend creates a pending desktop tool call, sends a reverse request to Electron main, waits for the extension host result, and returns a normal tool result to the model.
   - Cancellation, timeout, permission denial, and extension crash map to ordinary tool failure records.
   - Tool schemas and outputs remain JSON Schema/JSON values so they can be listed by `tools/list` and audited consistently with native tools.

## Implementation Stages

### Stage 0: Discovery

**Status:** Complete
**Owned Paths:** `roadmap/001-desktop-custom-user-extensions.md`, `roadmap/STATUS.md`

- [x] Inspect the current desktop app structure, settings UI, IPC bridge, package scripts, large files, and bundled backend boundary.
- [x] Inspect sibling Roder extension API, extension state docs, app-server `extensions/list`, and `tools/list` surfaces.
- [x] Review VS Code extension API docs for manifest fields, contribution points, activation events, and extension host placement.
- [x] Review Raycast extension repo/docs for manifest, file structure, commands, tools, preferences, environment, and dev loop.

Run:

```sh
git status --short
find roadmap -maxdepth 1 -type f -name '*.md' -print | sort
rg -n "extension|tools/list|extensions/list" /Users/pz/w/gode/docs /Users/pz/w/gode/crates/roder-app-server /Users/pz/w/gode/crates/roder-protocol
```

Acceptance:

- Discovery notes cite current files in this repo and sibling backend files instead of assuming a greenfield app.
- External inspiration is narrowed to concrete manifest, contribution, activation, command, tool, preference, environment, and dev-loop ideas.

### Stage 1: Extension Contract And Package Format

**Status:** Complete
**Owned Paths:** `electron/extensions/manifest.ts`, `packages/extension-api/**`, `examples/extensions/hello-roder/**`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`

- [x] Define `RoderExtensionManifest` TypeScript types and runtime validation for `package.json` plus `roder` fields.
- [x] Define stable ids for commands, tools, views, configuration keys, activation events, and capabilities.
- [x] Create `@roderai/extension-api` types for `activate(context)`, commands, tools, storage, secrets, environment, workspace, thread, notifications, and subscriptions.
- [x] Create a minimal example extension with one command, one no-view command, one tool, one preference, and one workspace storage call.
- [x] Add manifest validation tests with accepted and rejected fixtures.

Run:

```sh
pnpm typecheck
pnpm build
```

Acceptance:

- Invalid manifests fail with actionable errors.
- The example extension compiles against the public API package.
- No extension contract depends on renderer internals or private app-server structs.

### Stage 2: Desktop Extension Catalog And Settings UI

**Status:** Ready
**Owned Paths:** `electron/extensions/catalog.ts`, `electron/extensions/package-manager.ts`, `electron/extensions/storage.ts`, `electron/extensions/secrets.ts`, `electron/main/index.ts`, `electron/preload/index.ts`, `src/lib/extensions-ipc.ts`, `src/stores/extensions-store.ts`, `src/types/extensions.ts`, `src/components/extensions/**`, `src/components/settings-view.tsx`, `src/stores/theme-store.ts`

- [x] Add main-process extension catalog APIs for list, install from folder, install from archive, uninstall, enable, disable, reload, and read logs.
- [x] Add typed preload and renderer wrappers for extension catalog methods.
- [x] Add a separate Zustand extension store instead of growing `src/stores/roder-store.ts`.
- [x] Add an Extensions settings section with installed/dev/disabled/error states, capability review, preferences, logs, and actions.
- [ ] Add safe-mode startup behavior that skips user extension activation when configured or when a previous startup crash is attributed to extensions.
- [ ] Add tests for catalog persistence and renderer state mapping.

Run:

```sh
pnpm typecheck
pnpm build
```

Acceptance:

- Users can install, disable, re-enable, reload, and remove a local example extension from Settings.
- Catalog state survives app restart.
- Renderer code cannot read arbitrary extension files directly.

### Stage 3: Isolated Extension Host Runtime

**Status:** In progress
**Owned Paths:** `electron/extensions/extension-host.ts`, `electron/extensions/extension-rpc.ts`, `electron/extensions/storage.ts`, `electron/extensions/secrets.ts`, `electron/main/index.ts`, `electron/preload/index.ts`, `src/types/extensions.ts`

- [ ] Choose and document the host process primitive after checking Electron 42 behavior.
- [ ] Implement activation event routing, lazy activation, `context.subscriptions`, and `deactivate()` cleanup.
- [ ] Implement host API methods for commands, notifications, environment, preferences, storage, secrets, and workspace/thread context.
- [ ] Add per-extension timeout, cancellation, crash detection, log capture, and reload.
- [ ] Ensure host API calls are capability-checked before execution.
- [ ] Add unit tests for lifecycle, activation events, cleanup, crash isolation, and denied capabilities.

Run:

```sh
pnpm typecheck
pnpm build
```

Acceptance:

- A crashing extension does not crash the desktop renderer or app-server.
- Disabled extensions cannot register commands, tools, or views.
- Capability-denied APIs fail with typed errors and visible audit/log entries.

### Stage 4: Backend Tool Proxy Integration

**Status:** Ready
**Owned Paths:** `electron/extensions/tool-proxy.ts`, `electron/roder/app-server-client.ts`, `/Users/pz/w/gode/crates/roder-protocol/src/lib.rs`, `/Users/pz/w/gode/crates/roder-app-server/src/server.rs`, `/Users/pz/w/gode/crates/roder-core/src/desktop_extension_tools.rs`, `/Users/pz/w/gode/crates/roder-app-server/tests/e2e.rs`, `/Users/pz/w/gode/docs/roder-extension-api.md`

- [ ] Refactor `electron/roder/app-server-client.ts` before adding reverse-RPC behavior.
- [ ] Define backend protocol messages for desktop extension tool registration, tool call request, result, error, cancellation, timeout, and unregister.
- [ ] Add a backend desktop tool contributor that exposes desktop extension tools through `tools/list`.
- [ ] Route backend tool execution to Electron main and then into the extension host process.
- [ ] Preserve native `extensions/list` and `tools/list` behavior for built-in Rust extensions.
- [ ] Add backend e2e tests with a fake desktop tool transport and no live provider access.

Run:

```sh
pnpm typecheck
pnpm build
cd /Users/pz/w/gode && cargo test -p roder-app-server desktop_extension
cd /Users/pz/w/gode && cargo test -p roder-protocol
```

Acceptance:

- `tools/list` includes enabled extension tools with schemas and descriptions.
- A fake desktop extension tool can be called through the app-server and returns a normal tool result.
- Tool cancellation and extension crash produce normal tool failure records without hanging the turn.

### Stage 5: Webview Panels And Desktop UI Contributions

**Status:** Ready
**Owned Paths:** `electron/extensions/webview-panels.ts`, `src/components/extensions/**`, `src/App.tsx`, `src/components/top-bar.tsx`, `src/components/settings-view.tsx`, `src/types/extensions.ts`

- [ ] Implement `views.panels` contribution support for extension-owned panels in the existing right-side tool panel area or a dedicated Extensions panel area.
- [ ] Add strict webview sandboxing, CSP, URI rewriting, and message passing.
- [ ] Add extension panel commands to open, close, reload, and inspect logs.
- [ ] Add responsive layout checks so extension UI cannot break the desktop minimum size.

Run:

```sh
pnpm typecheck
pnpm build
```

Acceptance:

- A sample extension panel renders in the desktop without Node integration.
- Panel messages are scoped to the owning extension.
- Bad webview HTML or CSP violations show a contained error state.

### Stage 6: Developer Tooling, Packaging, And Documentation

**Status:** Ready
**Owned Paths:** `packages/create-extension/**`, `packages/extension-api/**`, `examples/extensions/**`, `docs/extensions/**`, `package.json`, `pnpm-lock.yaml`

- [ ] Add `create-roder-extension` or equivalent scaffolding for command, tool, and panel templates.
- [ ] Add local dev mode with watch, hot reload, structured logs, and extension reload hooks.
- [x] Add `.rdx` package creation and validation.
- [ ] Add docs covering manifest fields, contribution points, activation events, capabilities, API examples, packaging, install, and security review.
- [ ] Add a migration guide explaining what VS Code and Raycast concepts map to Roder, and what is intentionally unsupported.

Run:

```sh
pnpm typecheck
pnpm build
```

Acceptance:

- A new author can scaffold, build, run, package, and install an example extension locally.
- Docs include enough examples to implement a command, a tool, a setting, storage, a secret, and a panel.

### Stage 7: End-To-End Desktop Verification

**Status:** Ready
**Owned Paths:** `examples/extensions/hello-roder/**`, `.qa/**`, desktop app runtime

- [ ] Build the app with the bundled backend.
- [ ] Launch the desktop app and install the example extension from a local folder.
- [ ] Verify the Extensions settings panel, command invocation, preference editing, storage persistence, and logs.
- [ ] Verify the extension tool appears in `tools/list` and can complete an app-server tool call.
- [ ] Verify disable, reload, uninstall, safe mode, and crash isolation.
- [ ] Capture screenshots or QA artifacts for the visible extension panel and Settings state.

Run:

```sh
pnpm build
pnpm dist
```

Acceptance:

- Manual smoke proves the packaged desktop app can run the sample extension end to end.
- Verification evidence records the app version, backend binary source, commands run, and any remaining gaps.

## Verification Plan

### Automated Checks

- `python3 "${CODEX_HOME:-$HOME/.codex}/skills/roadmap-prd-verifier/scripts/validate_roadmap.py" roadmap/001-desktop-custom-user-extensions.md`
- `pnpm typecheck`
- `pnpm build`
- `cd /Users/pz/w/gode && cargo test -p roder-protocol`
- `cd /Users/pz/w/gode && cargo test -p roder-app-server desktop_extension`
- Extension manifest/package tests added in Stage 1 and catalog/host tests added in Stages 2 and 3.

### Manual Checks

- Install the sample extension from a dev folder.
- Review and grant capabilities.
- Invoke a contributed command.
- Edit a contributed preference and confirm persistence.
- Trigger a contributed tool through the app-server and confirm transcript/tool timeline behavior.
- Open a contributed panel and confirm layout at 980x680 and a normal desktop size.
- Disable and uninstall the extension and confirm all contributions disappear without restart.
- Crash the extension host and confirm the desktop stays usable with an actionable error.

### Rollback Or Recovery

- Safe mode disables all user extensions at startup while preserving installed packages.
- The Extensions panel can disable or uninstall individual extensions.
- Extension tool proxy registration is reversible by unregistering tools and clearing pending calls.
- Backend protocol additions should be feature-detected so older bundled backends show "extension tools unavailable" instead of breaking app startup.
- If an extension host repeatedly crashes, auto-disable the extension and preserve logs for inspection.

## Evidence Log

### 2026-05-18 - PRD Created

- Evidence: inspected current `gode-desktop` files, package scripts, settings shell, IPC bridge, app-server client, renderer stores, file sizes, sibling `/Users/pz/w/gode` extension docs, app-server protocol surfaces, VS Code extension API docs, and Raycast extension docs/repository.
- Commands: `git status --short`; `find roadmap -maxdepth 1 -type f -name '*.md' -print`; `sed -n` reads for `package.json`, `electron/main/index.ts`, `electron/preload/index.ts`, `electron/roder/app-server-client.ts`, `src/stores/roder-store.ts`, `src/components/settings-view.tsx`; `rg -n "extension|tools/list|extensions/list" /Users/pz/w/gode/docs /Users/pz/w/gode/crates/roder-app-server /Users/pz/w/gode/crates/roder-protocol`; web review of VS Code and Raycast docs.
- Result: Stage 0 complete; PRD is ready for implementation planning and task delegation.
- Gaps: no implementation started; Electron host primitive still needs confirmation during Stage 3; backend reverse-RPC exact shape remains a Stage 4 design checkpoint.

### 2026-05-18 - Structural Validation

- Evidence: required roadmap sections, stage headers, task checkboxes, run blocks, acceptance criteria, and `roadmap/STATUS.md` link were checked with the skill validator logic.
- Commands: `python3 "${CODEX_HOME:-$HOME/.codex}/skills/roadmap-prd-verifier/scripts/validate_roadmap.py" roadmap/001-desktop-custom-user-extensions.md` crashed before checking files because the validator placeholder-scan regex is malformed; reran the same script through a one-process regex shim without editing the installed skill.
- Result: shimmed validator reported `roadmap validation passed`.
- Gaps: stock validator script should be fixed separately; roadmap artifact itself passed structural validation.

### 2026-05-18 - Stage 1 Contract Slice

- Evidence: added the publishable workspace package `@roderai/extension-api`, runtime manifest validation in `electron/extensions/manifest.ts`, the `examples/extensions/hello-roder` extension, and manifest validation tests for accepted and rejected manifests.
- Commands: `pnpm test`; `pnpm typecheck`; `pnpm build`.
- Result: all three commands passed. `pnpm build` completed Electron/Vite output; `scripts/bundle-roder.mjs` reported `skipping: no Cargo workspace at /Users/pz/w/w` before continuing, so no backend binary was rebuilt in this environment.
- Gaps: extension install/catalog, runtime activation, settings UI, and backend tool bridge remain for later stages.

### 2026-05-18 - Stage 2 Catalog IPC Slice

- Evidence: added main-process local folder package reading, persisted extension catalog state, typed preload methods, renderer IPC wrappers, and tests for install persistence, enable/disable/reload/preference changes, uninstall, and invalid manifest rejection.
- Commands: `pnpm test`; `pnpm typecheck`.
- Result: both commands passed.
- Gaps: Settings UI wiring and runtime activation remain open in Stage 2/3.

### 2026-05-18 - Stage 3 Host Runtime Slice

- Evidence: added a forked extension host process, generated runner script, activation routing, command and tool execution, notification log capture, extension-scoped storage paths, and tests proving disabled extensions cannot execute contributions.
- Commands: `node --test test/extension-host.test.mjs`; `pnpm test`; `pnpm typecheck`.
- Result: all commands passed.
- Gaps: crash isolation and capability-denied API tests remain open; Settings UI controls and backend tool proxy are still pending.

### 2026-05-18 - Stage 2 Settings UI Slice

- Evidence: added a dedicated renderer extension store, typed renderer IPC wrapper usage, an Extensions settings section, and operational controls for install-from-folder, refresh, enable, disable, activate, reload, remove, command execution, tool calls, preferences, and logs. Catalog writes were changed to atomic temp-file renames after tests exposed a host log write/read race.
- Commands: `pnpm test`; `pnpm typecheck`; `pnpm build`.
- Result: all commands passed. `pnpm build` again completed Electron/Vite output after `scripts/bundle-roder.mjs` reported `skipping: no Cargo workspace at /Users/pz/w/w`.
- Gaps: safe-mode startup behavior and renderer state mapping tests remain open.

### 2026-05-18 - Example Extension Smoke And Desktop Tool Proxy

- Evidence: built `examples/extensions/hello-roder`, installed it from its local folder into a temp catalog, executed both contributed commands, executed the contributed `hello-roder.echo` tool twice through the forked host, and added a desktop bridge that merges enabled extension tools into `tools/list` and routes matching `tools/call` requests to the extension host.
- Commands: `pnpm --filter hello-roder-extension build`; one-off Node smoke using `ExtensionCatalog` and `ExtensionHost`; `pnpm test`; `pnpm typecheck`; `pnpm build`.
- Result: smoke installed `roder.hello-roder-extension`; `hello-roder.sayHello` returned the configured greeting; `hello-roder.noViewHello` returned `No-view hello #1`; `hello-roder.echo` returned run counts `1` and `2`; `pnpm test`, `pnpm typecheck`, and `pnpm build` passed.
- Gaps: Rust app-server reverse-RPC integration and cancellation/timeout behavior remain pending.

### 2026-05-18 - RDX Packaging And Archive Install

- Evidence: added publishable `@roderai/extension-packager`, `roder-extension-package`, `.rdx` zip creation, archive extraction into `userData/extensions/installed/{extensionId}`, archive install IPC, an `Install .rdx` Settings action, traversal-safe archive validation, and archive source records in the catalog.
- Commands: `pnpm --filter hello-roder-extension package`; one-off Node smoke installing `examples/extensions/hello-roder/dist/hello-roder.rdx` with `ExtensionCatalog.installFromArchive` and executing `hello-roder.sayHello` plus `hello-roder.echo`; `pnpm test`; `pnpm build`.
- Result: `.rdx` archive was created with `dist/extension.js` and `package.json`; smoke installed `roder.hello-roder-extension` from archive storage and executed its command/tool; `pnpm test` and `pnpm build` passed.
- Gaps: `.rdx` checksums/signatures, richer package metadata, and public docs remain pending.

## Open Questions

- [ ] Stage 3 owner: confirm whether Electron `utilityProcess` is the right host primitive for extension execution in Electron 42, or whether a forked Node child process is more reliable for this app.
- [ ] Product owner: decide whether first release should allow only local/dev extensions or also signed release URLs.
- [ ] Backend owner: decide whether desktop extension tools should appear as native `extensions/list` entries, a separate `desktop_extensions/list`, or a merged renderer-only catalog.
- [x] Product owner: choose whether the archive extension should be `.rdx`, `.roderx`, or another package suffix before publishing docs. Decision: use `.rdx`.
- [ ] Security owner: decide the exact review model for shell/process/network capabilities before supporting non-local extension sources.

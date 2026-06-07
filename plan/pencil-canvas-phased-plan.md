# Phased Plan: Separate AI Design Canvas in Roder Desktop

Date: 2026-06-05

## Phase 0 - Scope correction and naming

Goal: align implementation with the corrected product direction.

Decisions:

- Keep existing `canvas` sidebar panel unchanged for freehand drawing/sketch attachment.
- Add a new sidebar panel, tentatively `design`, for Pencil-like AI design work.
- Use `.roderdesign` as the workspace document format.
- Store primary document in the workspace and workspace-specific metadata/assets/cache under `~/.roder/...`.
- Roder agents interact through app-server design tools directly, not through external MCP first.

Deliverables:

- Update existing planning docs to reflect separate `Design Canvas`.
- Add `plan/pencil-mcp-discovery.md` with Pencil MCP findings.
- Review and approve method names and file placement.

Exit criteria:

- Team agrees on panel id/title, `.roderdesign` location, and initial tool list.

## Phase 1 - Backend `.roderdesign` resource and tool contract

Goal: create the durable design document resource before building a complex UI.

Work items:

1. Add Roder protocol DTOs for:
   - design document,
   - design node,
   - variables,
   - patch operations,
   - `batch_get` query,
   - layout snapshot,
   - export/screenshot result.
2. Add app-server module for design documents:
   - resolve active workspace root,
   - locate/create `<workspace-root>/.roderdesign`,
   - create `~/.roder/workspaces/<workspace-id>/design` metadata dirs,
   - read document,
   - atomic write,
   - validate/migrate document.
3. Add methods/tools mirroring Pencil shape:
   - `design/get_editor_state`
   - `design/batch_get`
   - `design/patch`
   - `design/get_variables`
   - `design/set_variables`
   - `design/snapshot_layout`
4. Emit app-server notifications:
   - `design/documentChanged`
   - `design/selectionChanged`
   - `design/exportCompleted` later.
5. Add docs to `docs/api.md`.

Testing/validation:

- Rust unit tests for path resolution and atomic writes.
- Rust tests for schema validation/migration.
- Rust tests for patch operations and `batch_get` depth/search.
- App-server e2e tests for each method.

Exit criteria:

- Roder agent/tool layer can create, read, search, and patch `.roderdesign` without the UI open.

## Phase 2 - Sidebar panel shell and document viewer/editor MVP

Goal: add a new Design sidebar view without touching current Canvas behavior.

Work items:

1. Add `design` to `workspacePanelValues` and route normalization.
2. Add panel entry to `right-workspace-panel-registry.tsx`.
3. Build `DesignCanvasPanel` that calls app-server design methods.
4. Build SVG/DOM stage for:
   - pan/zoom,
   - frame rendering,
   - rectangle/ellipse/line/text/image rendering,
   - single selection,
   - move/resize,
   - editable text.
5. Build toolbar:
   - select,
   - pan,
   - frame,
   - text,
   - shapes,
   - image/artifact insert,
   - undo/redo if backend returns undo patches,
   - attach/export.
6. Build inspector/layers as compact sidebar-within-sidebar UI.
7. User edits call `design/patch`; renderer does not own durable state.

Testing/validation:

- Typecheck/lint.
- Unit tests for frontend query/patch helpers.
- Manual Electron test: `canvas` still works; `design` opens separately and persists.

Exit criteria:

- User can open `Design`, create/edit a simple layout, reload app, and see `.roderdesign` persisted.
- Existing `Canvas` panel remains available and unchanged.

## Phase 3 - Pencil-like read/search and guidelines workflow

Goal: make agents productive on the design document using Pencil-inspired patterns.

Work items:

1. Implement `design/get_editor_state` response with:
   - active document path,
   - document summary,
   - selected ids if UI open,
   - schema/rules when requested.
2. Implement `design/batch_get` with Pencil-like behavior:
   - combined node id reads,
   - pattern search by `name`, `type`, reusable/component flag,
   - `parentId`, `searchDepth`, `readDepth`,
   - geometry abbreviation,
   - variable resolution.
3. Implement `design/get_guidelines`:
   - categories for web app, mobile app, dashboard, component library, Roder UI defaults.
4. Add a concise agent instruction/rules file for design work.
5. Add context summaries so large docs do not overflow turns.

Testing/validation:

- Query fixture tests.
- Depth truncation tests.
- Guidelines API tests.

Exit criteria:

- Roder agent can inspect a design doc like a Pencil agent: state first, batch reads, then patch.

## Phase 4 - Agent mutation, visual export, and screenshots

Goal: close the AI-controlled design loop.

Work items:

1. Implement robust `design/patch` diff/undo reporting.
2. Optionally add `design/batch_design` compatibility wrapper:
   - accepts high-level input string,
   - internally prompts/derives typed patch operations,
   - applies through `design/patch`.
3. Implement `design/get_screenshot`:
   - initially renderer bridge if `Design` panel open,
   - fallback export renderer later.
4. Implement `design/export_nodes`:
   - output to `~/.roder/workspaces/<id>/design/exports`, workspace path, or media artifact.
5. Add `Attach selected frame to composer`.
6. Add prompt node behavior:
   - prompt text on canvas,
   - run prompt against active Roder thread,
   - include selected/container node context.

Testing/validation:

- Patch diff/undo tests.
- Export path tests.
- Manual visual screenshot/export tests.
- Agent workflow manual test.

Exit criteria:

- Agent can modify design, user can inspect diff/visual, export/attach result, and undo if needed.

## Phase 5 - Variables, components, libraries, and `.pen` subset import

Goal: add the Pencil design-system strengths without copying Pencil assets/code.

Work items:

1. Variables/tokens:
   - colors,
   - typography,
   - spacing,
   - Roder design defaults,
   - workspace theme/Tailwind scan.
2. Components:
   - reusable frame/component nodes,
   - instance nodes with overrides,
   - detach instance.
3. Libraries:
   - search workspace for `.roderdesign` libraries,
   - optional `.roderdesignlib` convention later,
   - drag/insert templates.
4. `.pen` subset importer:
   - frame/text/rectangle/ellipse/line/path/image/icon/prompt best effort,
   - preserve unsupported source under `source.pencil`,
   - no save-back guarantee.

Testing/validation:

- Variable merge/replace tests.
- Component instance resolution tests.
- Import mapping fixture tests.

Exit criteria:

- User/agent can build with reusable design components and import useful simple Pencil documents.

## Phase 6 - Roder subagents and external MCP compatibility

Goal: mirror Pencil's multi-agent and MCP story once native tools are stable.

Work items:

1. Implement `design/spawn_agents` as Roder subagents scoped to container node ids.
2. Add agent activity/cursor/status overlays in the Design panel.
3. Consider external MCP server exposing the same design tools:
   - stdio server bundled with Roder,
   - optional install into Claude/Codex/Gemini/OpenCode configs,
   - use Roder app-server/auth rather than Pencil's private socket stack.
4. Add permissions/safety model for external agents.

Testing/validation:

- Subagent scoping tests.
- External MCP smoke tests only after implementation is explicitly approved.

Exit criteria:

- Multiple Roder agents can work on different frames/containers, and external agents can optionally access the design surface safely.

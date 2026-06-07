# Design Canvas Risk Register

Date: 2026-06-05

## Existing Canvas regression risk

Risk: The new Design Canvas could accidentally replace or alter the current sketch/drawing Canvas.

Mitigation:

- Keep route id `canvas` and `CanvasPanel` untouched unless a change is explicitly required.
- Add new route id `design` and separate component tree.
- Include manual verification that both panels open independently.

## Legal/licensing risk

Risk: Pencil's app bundle contains minified proprietary/private code and private `@ha/*` packages.

Mitigation:

- Use only behavioral observations and public interface shape.
- Do not copy Pencil code, assets, private packages, or bundled design kits.
- Implement Roder-native schemas/tools.

## Persistence/location risk

Risk: Storing the only design copy under `~/.roder` could surprise users or make project sharing/versioning hard.

Mitigation:

- Store primary design file in workspace as `.roderdesign`.
- Use `~/.roder/workspaces/<id>/design` only for metadata, cache, thumbnails, exports, and locks.
- Write atomically and keep backups for recovery.

## Agent edit safety risk

Risk: Direct agent access can corrupt or destructively rewrite a design document.

Mitigation:

- Prefer typed `design/patch` over freeform `batch_design`.
- Validate every patch.
- Return diffs and maintain undo information.
- Require approval for large/destructive edits if Roder policy mode demands it.

## Renderer/backend consistency risk

Risk: UI selection/view state and backend document state drift.

Mitigation:

- Backend is durable authority.
- Renderer sends edits through backend patch methods.
- Backend emits document-change notifications.
- Renderer owns only transient camera/selection state and periodically reconciles revision IDs.

## Screenshot/export risk

Risk: Backend may not be able to export exactly what the renderer shows.

Mitigation:

- Initial screenshot/export can route to renderer when panel is open.
- Persist a clear error/fallback when renderer is unavailable.
- Add headless/server-side renderer later only if needed.

## Scope risk

Risk: Pencil/Figma-class design tooling is very large.

Mitigation:

- Ship backend resource/tools first.
- Then MVP editor.
- Add variables/components/import/subagents in later phases.

## React integration risk

Risk: Pointer and subscription code may introduce direct `useEffect` usage.

Mitigation:

- Follow `.agents/skills/no-use-effect/SKILL.md`.
- Use event handlers, derived state, external stores, or explicit mount-only helpers where appropriate.

## Dependency risk

Risk: Adding a large design/whiteboard library can cause bundle, licensing, or patchability problems.

Mitigation:

- Start with small SVG/DOM renderer.
- Evaluate dependencies deliberately before adding any.
- Respect AGENTS.md dependency security policy.

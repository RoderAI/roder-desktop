# React Refactoring & Performance Opportunities

A review of the desktop renderer (and adjacent main-process code) against the
[Vercel React best-practices skill](../../.agents/skills/vercel-react-best-practices/SKILL.md).
Each item is a todo with the matching rule id, severity, and location. Items are ordered
by expected impact within each section.

Legend: `[ ]` todo, `[x]` done. Rule ids in backticks refer to `.agents/skills/vercel-react-best-practices/rules/<id>.md`.

---

## 1. Streaming hot path (critical)

These compound: during a streaming turn every token delta runs the full chain
notification -> store set -> selector -> context -> app re-render.

- [x] **Rebuild messages incrementally instead of per delta** — `rerender-memo` / general-refactor (critical)
  Done: `messagesByTurn` WeakMap caches per-turn messages; deltas only rebuild the touched turn.
  Filtered routing-decision turns keep identity via `filteredTurnsCache`.
  `src/lib/roder-thread.ts:300` caches `messagesFromThread` in a WeakMap keyed by the thread
  object, but `applyThreadItemEvent` (`roder-thread.ts:76`) creates a new thread object for
  every streamed delta, so the cache misses every time and `turns.flatMap(messagesFromTurn)`
  rebuilds every message of every turn per token. Cache per-turn (turn objects for untouched
  turns keep identity) so a delta only rebuilds the affected turn. This is O(n²) over a long
  turn today.

- [x] **Stop persisting the Zustand store on every streaming delta** — `js-cache-storage` / `client-localstorage-schema` (high)
  Done: custom `debouncedLocalStorage` persist storage (500ms trailing write, flush on `pagehide`).
  `src/stores/roder-store.ts:1184-1198` wraps the whole store in `persist`. The persist
  middleware serializes the partialized state (workspaces, nav stacks, queued prompts) and
  writes `localStorage` on *every* `set`, including each `applyNotification` item delta.
  Either move the persisted slice into its own small store, or debounce/limit writes
  (e.g. custom storage with a trailing write).

- [x] **Split the app-shell mega context so streaming doesn't re-render the whole app** — `rerender-defer-reads` / general-refactor (critical)
  Done: `messages` and `showWorkingIndicator` were removed from the context/`selectAgentState`;
  the chat page subscribes via narrow hooks, so per-delta updates no longer invalidate the shell.
  `src/hooks/use-app-shell-controller.ts:426-487` memoizes one context object that embeds
  `agent` (which includes `messages`). Any store change invalidates `appShellContext` and
  `layoutProps`, re-rendering `AppShellLayout`, sidebar, top bar, and all panels on every
  delta. Split into separate contexts (stable actions vs. fast-changing transcript state) or
  have leaf components subscribe to the store directly with narrow selectors.

- [x] **Narrow `selectAgentState`** — `rerender-derived-state` (high)
  Done: added `useActiveThreadMessages()`, `useShowWorkingIndicator()`, and
  `activeThreadMessagesSnapshot()`; the root selector no longer selects messages.
  `src/hooks/use-roder-agent.ts:54-118` selects ~50 fields including the full `threads`
  array and derived `messages` in a single `useShallow` selector consumed at the app root.
  Most consumers need a fraction of this. Export smaller hooks (`useAgentActions()` — store
  actions are stable and never invalidate; `useActiveThreadMessages()`; `useThreadList()`),
  so updates only hit components that read the changed slice.

- [x] **Memoize transcript row components** — `rerender-memo` (high)
  Done: rows wrapped in `memo`; `reconcileTranscriptRows` preserves row identity for
  unchanged entries so the memo actually bails.
  `src/components/transcript.tsx:496/530` — `TranscriptRowView`/`TranscriptEntryView` are not
  memoized, so all mounted virtual rows (visible + overscan 8) re-render per delta, including
  `MessageContent`'s Streamdown markdown parse for unchanged messages. Wrap rows in
  `React.memo`; for it to pay off, also preserve row object identity in `buildTranscriptRows`
  (`src/lib/transcript-rows.ts`) for unchanged entries (cache rows keyed by entry, like
  `messagesByThread`).

- [x] **Don't recompute transcript search text on every scroll** — `js-combine-iterations` (medium)
  Done: keyed on mounted row keys instead of `virtualItems` identity.
  `src/components/transcript.tsx:424-429` rebuilds `transcriptRowsSearchText` over all rows
  (string concat of the whole transcript) every time `virtualItems` changes, i.e. on every
  scroll frame. Cache the per-row search text and only recompute when `transcriptRows`
  changes; subtracting mounted rows can then reuse those strings.

- [x] **Combine the three count passes in tool group summaries** — `js-combine-iterations` (low)
  Done: single loop with three counters.
  `src/lib/tool-message-groups.ts:186-188` runs three `.filter().length` passes over the same
  messages array per group, per transcript rebuild. Use one loop with three counters.

## 2. Design canvas (high — worst per-interaction cost in the app)

- [x] **Decompose `design-canvas-panel.tsx` (6,927 lines)** — general-refactor (high)
  Done: split into `design-canvas-body`, `design-toolbar`, `design-layers`, `design-inspector`,
  `design-templates`, `design-import`, `design-canvas-helpers`/`-types`/`-utils`; panel is ~1,300 lines.
  `src/components/design-canvas/design-canvas-panel.tsx` contains ~45 components and ~60
  helpers in one file. Natural module seams already visible: panel shell + document state,
  `DesignCanvasBody`/stage, `DesignToolbar`, `DesignLayers`, `DesignMiniMap`/rulers,
  `DesignInspector` + inspector inputs, agent-activity panels, templates
  (`buildDesignTemplate` and friends), import/export (`importPencilLikeDesign`,
  clipboard), and undo/patch helpers. Splitting is also a precondition for the memoization
  work below and keeps the design code out of the main chunk (see bundle item).

- [x] **Stop re-rendering the whole canvas tree on every pointer move** — `rerender-use-ref-transient-values` (critical)
  Done: cursor position lives in a tiny external store consumed only by the coordinate
  readout (`useSyncExternalStore`); panning mutates the stage transform via a ref and
  commits viewport state on pointer-up.
  `design-canvas-panel.tsx:2115-2128` calls `setCursorPoint(...)` on every `pointermove`
  (used only by `DesignCoordinateReadout`) and routes panning through `setViewport` state in
  the top-level panel. Every mouse move re-renders `DesignCanvasBody`, the toolbar, every
  `DesignNodePreview` subtree, the minimap, and the inspector. Keep cursor position in a ref
  consumed by an isolated readout component (or write a CSS variable), and apply pan/zoom by
  mutating the stage `transform` via a ref during the gesture, committing viewport state on
  pointer-up.

- [x] **Memoize canvas children and stabilize the ~40 handler props** — `rerender-memo` (high)
  Done: `DesignCanvasBody`, `DesignToolbar`, `DesignLayers`, `DesignMiniMap`, `DesignInspector`,
  and `DesignNodePreview` are memoized; the panel routes all handler props through a
  `useStableHandlers` dispatch object (latest-ref pattern) so identities stay stable.
  `DesignCanvasPanel` (lines 227-1378) defines every handler inline (no `useCallback`) and
  passes them to `DesignCanvasBody`/`DesignInspector`, so nothing in the tree can bail out.
  After extracting modules, wrap `DesignToolbar`, `DesignLayers`, `DesignMiniMap`,
  `DesignInspector`, and `DesignNodePreview` in `React.memo` and stabilize handlers — either
  `useCallback` + functional updates, or a `useLatest`-style dispatch object
  (`advanced-event-handler-refs`), or `useReducer` for document/undo state.

- [x] **Parallelize design read + layout diagnostics** — `async-parallel` (medium)
  Done: `loadDesign` uses `Promise.all` for the document read and diagnostics.
  `design-canvas-panel.tsx:780-798` (`loadDesign`) awaits `roderIpc.readDesign` and then
  `readLayoutDiagnostics` sequentially; they are independent IPC calls. Use `Promise.all`.
  Same pattern in `setDesignVariables` (line 623-624) where the variables call and the
  diagnostics read could overlap with state work.

- [x] **Avoid JSON deep clone/compare in the undo path** — `js-cache-function-results` adjacent (medium)
  Done: snapshots share structure with the live document; restore diffs by node identity
  first and only falls back to JSON comparison for actually-touched nodes.
  `cloneDesignDocument` (line 5394) and `jsonEqual` (line 5544) round-trip the whole document
  through `JSON.parse(JSON.stringify(...))`/`JSON.stringify` comparison on every patch.
  The document is already treated immutably elsewhere (`onUpdateNodeLocal` spreads); reuse
  structural sharing instead of full clones, and compare fields directly.

- [x] **Derive `rootNodes` and sorted child rects with memoization** — `rerender-simple-expression-in-memo` inverse (low)
  Done: `rootNodes` is `useMemo`'d on document identity in `DesignCanvasBody`.
  `design-canvas-panel.tsx:1966-1968` recomputes `rootNodes` on every render of
  `DesignCanvasBody` (i.e. every pointer move today); `:6041-6042` double-sorts child rects
  per call. Memoize on `document` identity once the re-render storm above is fixed.

## 3. Bundle size (critical category, applies at startup)

- [x] **Lazy-load right-workspace panels** — `bundle-dynamic-imports` (high)
  Done: all seven panels load via `React.lazy` with a Suspense fallback in
  `renderRightWorkspacePanel`.
  `src/components/right-workspace-panel-registry.tsx` statically imports all seven panels, so
  `@xterm/xterm` + addon (terminal), the 6,900-line design canvas, `@pierre/diffs`/`@pierre/trees`
  (review), and the file panel all land in the initial chunk even though none render until a
  panel is opened. Use `React.lazy` per panel with a Suspense fallback in
  `renderRightWorkspacePanel`.

- [x] **Lazy-load routes/pages that aren't the chat screen** — `bundle-dynamic-imports` (medium)
  Done: `SettingsPage` and `PluginsPage` load via `React.lazy` in their route files with a
  shared `RouteFallback`; only the route files imported them, so they leave the main chunk.
  `src/routes/*.tsx` bind page components directly (`component: SettingsRoute`, plugins,
  etc.). Settings (theme editor, 7 panels) and the plugins marketplace can be
  `lazyRouteComponent`/`React.lazy` so first paint of the chat view ships less code.

- [ ] **Defer the Lexical editor setup in the composer if feasible** — `bundle-conditional` (low)
  `src/components/composer.tsx` builds a Lexical editor (`createSkillPromptEditor`,
  history, plugins) eagerly. The composer is on the critical path so this may stay static,
  but verify with the bundle analyzer whether lexical packages dominate the main chunk; if
  so, consider a plain-textarea first paint that upgrades to Lexical after hydration.

- [ ] **Audit `lucide-react` and `@hugeicons` import shape** — `bundle-barrel-imports` (low)
  Imports like `import { Files, Globe2 } from "lucide-react"` rely on the package's ESM
  tree-shaking. Vite usually handles lucide fine, but confirm with `vite-bundle-visualizer`;
  if the icon barrels show up large, switch to per-icon paths (`lucide-react/icons/files`).

## 4. Store and hooks

- [x] **Replace inline `state` reads in design/store async functions with functional updates** — `rerender-functional-setstate` (medium)
  Done: post-await writes use `setState(current => ...)` in `patchDesign`,
  `setDesignVariables`, `refreshLayoutDiagnostics`, and friends.
  Many async handlers in `DesignCanvasPanel` (e.g. `patchDesign` line 819-848,
  `setDesignVariables` line 600) read `state` from the closure after `await`, risking stale
  snapshots when patches race (two quick edits, or a `design/documentChanged` notification
  landing mid-patch). Use `setState(current => ...)` or keep the document in a reducer.

- [x] **`useRoderAgent` returns a new object per store change** — `rerender-memo-with-default-value` (low)
  Addressed by the section 1 work: `messages` left the selector, so the selected slice no
  longer changes per delta. Further flattening not needed.
  `src/hooks/use-roder-agent.ts:20-26` spreads `state` into a fresh object; the `useMemo`
  keys on `state`, which is new whenever any selected field changes, so the memo only helps
  for the `models` recompute. Fine today (single consumer), but worth flattening when the
  context split (section 1) happens.

- [x] **`chat-page.tsx` computes `mergedCommandDescriptors` on every render** — `rerender-lazy-state-init` adjacent (low)
  Done: wrapped in `useMemo` keyed on `commands`.
  `src/pages/chat/chat-page.tsx:57` calls `mergedCommandDescriptors(commands)` unmemoized in
  the body; it allocates a merged array each render of a hot page. Wrap in `useMemo` keyed on
  `commands`.

- [x] **`transcriptHasActiveStreaming` scans all messages per render** — `js-early-exit` (low)
  Done: scans from the tail so the per-delta hot path exits in O(1).
  `src/components/transcript.tsx:122-127` — `messages.some(...)` is fine, but it sits in a
  `useMemo` keyed on `messages`, which changes identity every delta; the active flag is
  derivable from the last message / `showWorkingIndicator` in O(1). Minor once section 1
  lands.

## 5. Review panel

- [x] **Cache section rects instead of measuring every scroll frame** — `js-batch-dom-css` / `client-passive-event-listeners` (medium)
  Done: section bounds are measured once into scroll-content coordinates and reused across
  scroll frames; a `ResizeObserver` on each section invalidates the cache when heights change
  (diff loads, collapse toggles, panel resizes).
  `src/components/review-panel.tsx:228-253` — `updateSelectedPathFromScroll` calls
  `getBoundingClientRect` on every diff section on each rAF'd scroll tick. With many changed
  files this forces layout reads per frame. Use an `IntersectionObserver` per section (it
  already tracks `nearbyDiffPaths` similarly) or cache offsets and invalidate on resize.

- [x] **`reviewChangedFilesTotals` runs unmemoized per render** — `js-combine-iterations` (low)
  Done: memoized on `reviewFiles`.
  `review-panel.tsx:138` recomputes totals on every render of the panel (which re-renders on
  scroll-driven `selectedPath` changes). Memoize on `reviewFiles`.

## 6. Cross-cutting / app shell

- [x] **Deduplicate window resize/scroll listeners and make them passive** — `client-event-listeners` / `client-passive-event-listeners` (low)
  Done: the panel-shell menu scroll listener is now `{ capture: true, passive: true }`.
  Sharing one subscription was skipped: both listeners are conditional (menu open / panel
  active) and rarely coexist, so the dedupe abstraction wouldn't pay for itself.
  `src/components/right-workspace-panel-shell.tsx:242-243` and
  `src/components/browser-panel.tsx:74` each attach their own `resize`/`scroll` listeners that
  call `getBoundingClientRect`. Share one `useWindowEvent`-style subscription, and pass
  `{ passive: true }` for the scroll listener since the handlers never `preventDefault`.

- [x] **`use-horizontal-resize` / sidebar drag handlers** — OK as-is, listed for awareness
  `src/hooks/use-horizontal-resize.ts` and `app-shell-layout.tsx:340-371` attach
  pointermove on drag start and clean up on pointer-up — correct pattern. The sidebar drag
  writes `localStorage` on every move via `applySidebarWidth`
  (`app-shell-layout.tsx:331-335`, write at `:663`) — debounce the persistence to pointer-up
  (`js-cache-storage`). Done: the storage write now happens once on pointer-up.

- [ ] **`settings-view.tsx` (744 lines) bundles the theme editor with nav chrome** — general-refactor (low)
  `src/components/settings-view.tsx` mixes the settings shell, appearance panel, theme
  editor, preview panes, and generic `Switch`/rows. Split the theme editor + preview into
  their own module (pairs with the lazy-loading item in section 3).

## 7. Electron main process

- [x] **Review startup sequencing in `electron/main/index.ts`** — `async-parallel` / `advanced-init-once` (low)
  Verified: the manager constructors only store arguments (no I/O); `createWindow()` runs
  before `await roder.start()`, so first paint is not blocked; the extension catalog/host are
  lazily initialized on first use (`??=`). No change needed.

---

## Remaining work

All code items are done. Still open (all measurement-gated or cosmetic):

1. Section 3 item 3 (defer Lexical) and item 4 (icon barrel audit): run
   `vite-bundle-visualizer` first; only act if those packages dominate the main chunk.
2. Section 6 settings-view split: pure file-organization refactor; the bundle win already
   landed via the lazy settings route.

## Verification notes

- Findings were based on direct code reading at the cited lines (master @ time of review).
- Implementation verified with `tsc --noEmit`, `oxlint`, and the vitest suite.
- Not yet measured: actual bundle composition (run a bundle visualizer to confirm the
  remaining section 3 items), and profiler traces for the streaming path (React DevTools
  profiler during a long turn will confirm the section 1 wins).

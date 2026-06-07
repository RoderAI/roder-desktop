# Pencil Canvas Discovery Notes

Date: 2026-06-05

## Scope

This document captures what was learned from the installed `/Applications/Pencil.app` bundle and the current Roder Desktop canvas implementation. It is planning material only; it does not copy Pencil source or propose vendoring Pencil internals.

## Installed Pencil app facts

- App path: `/Applications/Pencil.app`.
- Bundle identifier: `dev.pencil.desktop`.
- Version: `1.1.62`.
- Runtime: Electron app with `Contents/Resources/app.asar`.
- Document type: `.pen` (`Pencil Design File`).
- Deep-link protocol: `pencil://`.
- Extracted archive location used for inspection: `/tmp/pencil-asar`.
- Main entry: `out/main.js`.
- Renderer entry: `out/editor/index.html` -> `out/editor/assets/index.js`.
- Renderer includes a WASM artifact: `out/editor/assets/pencil.wasm`.
- Renderer bundle contains Skia-related names and WebAssembly support, suggesting a custom high-performance canvas/rendering engine rather than ordinary DOM/SVG-only drawing.
- Backend dependencies include private `@ha/*` packages plus Claude/Codex SDKs and an MCP integration layer.

## Pencil high-level architecture inferred from bundle

Pencil is a desktop design-canvas application. The main process:

- Opens one Electron window per `.pen` resource.
- Loads file content into a `DesktopResourceDevice` abstraction.
- Uses a typed IPC transport (`@ha/ipc`) to connect renderer, resources, and agents.
- Tracks dirty state, file changes, recent files, workspace folder association, theme/vibrancy, fullscreen state, and app updates.
- Provides agent configuration/auth for Claude and Codex.
- Exposes MCP configuration/integrations and a desktop MCP adapter.
- Emits/handles events such as:
  - save / request-save
  - file-error / file-changed / dirty-changed
  - workspace-folder-changed
  - prompt-agent
  - add-to-chat
  - active-integrations
  - fullscreen-change

The renderer appears to be a custom React app with a scene graph, Skia renderer, camera/viewport, selection, undo/redo, design libraries, and agent-aware interactions.

## Pencil document model

Pencil `.pen` files are JSON. Sample files live at `/tmp/pencil-asar/out/data/*.pen`.

Observed top-level shape:

```json
{
  "version": "2.13",
  "children": []
}
```

Observed node types across bundled sample/design-kit files:

| Type        | Count in samples | Notes                                                            |
| ----------- | ---------------: | ---------------------------------------------------------------- |
| `frame`     |             2625 | Primary container/artboard/group/layout node.                    |
| `text`      |             1814 | Text node with font, growth, alignment, line height.             |
| `ref`       |              752 | Reusable component instance/reference with descendant overrides. |
| `color`     |              747 | Variable/token value entry.                                      |
| `icon_font` |              361 | Icon font glyph node.                                            |
| `rectangle` |              161 | Primitive shape.                                                 |
| `path`      |              140 | Vector path geometry.                                            |
| `shadow`    |              105 | Effect value.                                                    |
| `number`    |               85 | Variable/token value entry.                                      |
| `icon`      |               79 | Icon library node, e.g. lucide.                                  |
| `ellipse`   |               47 | Primitive shape.                                                 |
| `gradient`  |               23 | Fill/effect value.                                               |
| `string`    |               18 | Variable/token value entry.                                      |
| `prompt`    |               13 | Canvas prompt cards/agent prompt nodes.                          |
| `line`      |               10 | Primitive line/divider.                                          |
| `image`     |                9 | Image fill/value.                                                |

Frequently observed fields:

- Common: `id`, `type`, `name`, `x`, `y`, `width`, `height`, `children`, `fill`, `stroke`, `opacity`, `rotation`, `enabled`.
- Layout: `layout`, `gap`, `padding`, `alignItems`, `justifyContent`, `clip`, `layoutPosition`.
- Componentization: `reusable`, `ref`, `descendants`, `slot`, `context`, `theme`.
- Text: `content`, `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, `textGrowth`, `textAlign`, `textAlignVertical`.
- Vector: `geometry`, `fillRule`, `strokeWidth`, `strokeLinejoin`, `strokeLinecap`, `strokeAlignment`, `flipX`, `flipY`.
- Effects: `effect`, `shadowType`, `blur`, `offset`, `spread`, `gradientType`, `colors`.
- Design tokens: token references commonly use `$...` strings, e.g. `$--background`.

## Pencil capabilities worth replicating conceptually

The valuable capability is not freehand sketching. It is a design/agent canvas:

1. Infinite or large zoomable canvas with camera/viewport.
2. Artboards/frames as first-class objects.
3. Hierarchical scene graph.
4. Selection, move/resize, ordering, grouping, and editable properties.
5. Text, vector primitives, icons, images, fills, strokes, shadows, corner radius.
6. Design system/component libraries and reusable references.
7. Auto-layout-like frame behavior.
8. JSON document persistence.
9. Import/export flows, including image export and possibly `.pen` import.
10. Prompt nodes and agent-generated edits/results on the canvas.
11. Multi-agent awareness/cursors or agent activity overlays.
12. MCP/IDE integration to turn designs into code or inspect running work.

## Current Roder canvas implementation

Relevant files:

- `src/components/right-workspace-panel-registry.tsx`
- `src/components/canvas-panel.tsx`
- `src/components/canvas/canvas-stage.tsx`
- `src/components/canvas/canvas-toolbar.tsx`
- `src/lib/canvas-surface.ts`

Current capabilities:

- Single right workspace panel named `canvas`.
- Immediate-mode HTML canvas drawing.
- Tools: draw, erase, select images, rectangle, ellipse, line.
- Color swatches and custom color picker.
- Stroke size slider.
- Drop images onto the canvas.
- Select/move/resize images.
- Undo last mark/image/shape.
- Clear canvas.
- Capture raster PNG and attach to composer via `onAttach`.

Current limitations:

- No persistent document model.
- No scene graph or object-level editing for strokes/shapes/text.
- No pan/zoom/camera.
- No frame/artboard model.
- No text, icons, components, tokens, reusable refs, or libraries.
- No collaboration/agent cursors.
- No app-server APIs for design documents.
- Implementation currently uses `useEffect` directly; future React edits should follow the repository's no-use-effect guidance and use explicit mount hooks or event-driven patterns where necessary.

## Roder architecture constraints and fit

- Roder Desktop is Electron + React 19 + Vite.
- Roder uses React Compiler; do not add routine `useMemo`, `useCallback`, or `React.memo` for optimization.
- UI changes should follow `docs/design.md`.
- Right workspace panels are registered in `src/components/right-workspace-panel-registry.tsx`.
- Backend app-server JSON-RPC contract is documented in `docs/api.md`; long-lived canvas persistence should eventually be an app-server capability rather than renderer-only local state.
- Roder already has agents, tools, files, media artifacts, review, browser, terminal, and composer attachments. The advanced canvas should connect to those instead of recreating Pencil's separate desktop agent platform.

## Product interpretation for Roder

Replicating Pencil inside Roder should mean: build a separate **Design Canvas** sidebar panel native to Roder's agentic software workbench. The existing freehand sketch Canvas must remain intact and continue to serve quick draw/annotate/attach workflows.

Target use cases:

- Keep the current sketch Canvas for quick sketches, annotations, and PNG composer attachments.
- Add a new Design Canvas sidebar view for persistent structured wireframes with frames, text, shapes, and images.
- Let agents create or modify canvas nodes as a durable artifact.
- Connect canvas nodes to files, screenshots, prompts, plan items, and generated code.
- Persist design state as a `.roderdesign` document for the active workspace/project, with metadata under `~/.roder/...` as needed.

Non-goals for the first implementation:

- Byte-for-byte Pencil compatibility.
- Copying private Pencil code or private `@ha/*` packages.
- Full Figma-class feature parity in one milestone.
- Replacing or regressing the current drawing canvas.
- Multiplayer sync before local single-user document semantics are stable.

# Design Canvas Architecture Proposal for Roder Desktop

Date: 2026-06-05

## Goal

Add a new Pencil-like **Design Canvas** sidebar view to Roder Desktop while keeping the current drawing/sketch Canvas unchanged. The Design Canvas is a persistent, structured, AI-controlled design document surface stored as `.roderdesign` for the active workspace/project and directly accessible to the Roder agent through native app-server tools.

## Non-negotiables from product direction

1. Do **not** replace the current drawing canvas.
2. Add a separate sidebar panel/tab, likely named `Design` or `Design Canvas`.
3. Persist design documents as `.roderdesign` in the user's workspace, with workspace-specific metadata/cache under `~/.roder/...` when needed.
4. Roder's own agent must directly read and mutate the Design Canvas.
5. Mirror Pencil's MCP/tool interaction shape closely enough that agents can reason about the design document the same way, but implement it Roder-native and do not copy private Pencil code.

## Sidebar integration

Current panel values live in `src/lib/route-search.ts`:

```ts
["terminal", "browser", "canvas", "extensions", "review", "files"];
```

Add a new value, for example:

```ts
"design";
```

Current panel registry lives in `src/components/right-workspace-panel-registry.tsx`. Add a new entry:

- id: `design`
- title: `Design`
- description: `AI design canvas`
- icon: likely `PenTool`, `LayoutTemplate`, or `Brush` variant distinct from the current sketch Canvas.

Render path:

```tsx
if (panel === "design") {
  return <DesignCanvasPanel ...workspace/thread/appServer context... />;
}
```

The existing `CanvasPanel` stays registered as `canvas` with current behavior.

## Persistence model

### File placement

Primary document should be a regular workspace file so the user can inspect/version/share it:

```text
<workspace-root>/.roderdesign
```

For projects with multiple design documents, later support:

```text
<workspace-root>/.roder/designs/<name>.roderdesign
```

Workspace-specific metadata/cache can live under the user's Roder app state:

```text
~/.roder/workspaces/<workspace-id>/design/
  index.json
  assets/
  thumbnails/
  exports/
  locks/
```

Use a deterministic workspace id derived from canonical workspace root path or existing Roder workspace id. Avoid storing the only copy of the document under `~/.roder`; `~/.roder` should hold cache, mirrors, thumbnails, temporary exports, and cross-session panel state.

### Document format

A `.roderdesign` file should be JSON, versioned, deterministic, and agent-patchable:

```ts
type RoderDesignDocument = {
  version: "0.1";
  documentId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  nodes: Record<string, RoderDesignNode>;
  rootIds: string[];
  variables: Record<string, RoderDesignVariable>;
  assets: Record<string, RoderDesignAsset>;
  guidelines?: Record<string, RoderDesignGuideline>;
  metadata: {
    workspaceId?: string;
    workspaceRoot?: string;
    threadIds?: string[];
  };
};
```

Node families mirror Pencil concepts but use Roder names:

- `frame`
- `group`
- `text`
- `rectangle`
- `ellipse`
- `line`
- `path`
- `image`
- `icon`
- `component`
- `instance`
- `prompt`
- `annotation`
- `artifactRef`

Common fields:

```ts
type RoderDesignBaseNode = {
  id: string;
  type: string;
  name: string;
  parentId: string | null;
  childIds?: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  visible?: boolean;
  locked?: boolean;
  fill?: Paint;
  stroke?: Stroke;
  effects?: Effect[];
  layout?: LayoutSpec;
  source?: {
    pencil?: unknown;
    filePath?: string;
    artifactId?: string;
    generatedByTurnId?: string;
  };
};
```

## Backend authority and renderer split

Pencil routes tools to the renderer because its renderer owns the live scenegraph. Roder should instead make app-server/backend the durable authority:

- Backend owns `.roderdesign` read/write, schema validation, migrations, patch application, and notifications.
- Renderer owns view state: selected node ids, camera/zoom/pan, drag handles, in-progress edits.
- Renderer subscribes to design document notifications and sends user edits as backend patch commands.
- Roder agents call backend design tools directly. They should not require the Design sidebar to be open for read/write operations.

Renderer-only operations may still exist for screenshot/export if exact visual capture requires the mounted Design Canvas.

## Proposed app-server API / tool surface

Mirror Pencil's MCP tools under Roder-native names:

| Roder method/tool         | Pencil analogue         | Purpose                                                                                                 |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `design/get_editor_state` | `get_editor_state`      | Return active workspace design doc summary, selection/view state if available, schema/rules optionally. |
| `design/batch_get`        | `batch_get`             | Read/search nodes by ids, patterns, parent, depth, variables.                                           |
| `design/patch`            | stricter `batch_design` | Apply typed operations to the document. Preferred over freeform mutation.                               |
| `design/batch_design`     | `batch_design`          | Optional compatibility wrapper that turns high-level input into patch operations.                       |
| `design/snapshot_layout`  | `snapshot_layout`       | Return layout rectangles/problems for document or subtree.                                              |
| `design/get_screenshot`   | `get_screenshot`        | Return image for document or node. May require renderer bridge initially.                               |
| `design/export_nodes`     | `export_nodes`          | Export selected nodes to file/media artifact.                                                           |
| `design/get_variables`    | `get_variables`         | Read variables/tokens.                                                                                  |
| `design/set_variables`    | `set_variables`         | Merge/replace variables.                                                                                |
| `design/get_guidelines`   | `get_guidelines`        | Return Roder design guidelines/templates.                                                               |
| `design/spawn_agents`     | `spawn_agents`          | Later: spawn Roder subagents scoped to container nodes.                                                 |

### Typed patch operations

Prefer structured operations over Pencil's freeform `input` mutation:

```ts
type DesignPatchOperation =
  | { op: "insert_node"; parentId: string | null; index?: number; node: RoderDesignNode }
  | { op: "update_node"; nodeId: string; patch: Partial<RoderDesignNode>; expectRevision?: string }
  | { op: "delete_node"; nodeId: string; recursive?: boolean }
  | { op: "move_node"; nodeId: string; parentId: string | null; index?: number; x?: number; y?: number }
  | { op: "set_variables"; variables: Record<string, RoderDesignVariable>; replace?: boolean }
  | { op: "set_selection"; nodeIds: string[] };
```

Each applied patch should:

- validate schema,
- update document revision,
- write atomically to `.roderdesign`,
- emit notification to renderer,
- return a concise diff and undo token/patch if feasible.

## Agent interaction model

Roder agent should be able to:

1. Read the active workspace design document without opening the sidebar.
2. Search nodes like Pencil `batch_get`.
3. Inspect selection if the sidebar is open.
4. Apply validated patches.
5. Export node/document screenshots as media artifacts for turn context.
6. Create prompt nodes and tie them to Roder turns/subagents.
7. Spawn scoped subagents later, each assigned to a container node.

Design tool instructions should explicitly tell agents:

- Use `design/get_editor_state` first.
- Use `design/batch_get` with combined ids/searches, not many small reads.
- Use depth limits to avoid overflowing context.
- Prefer `design/patch` with typed operations.
- Use `design/snapshot_layout` before/after large layout edits.
- Use `design/get_screenshot` for visual verification.

## External MCP compatibility later

Initial requirement is direct Roder-agent access. External MCP can be added later by exposing the same app-server design tool surface through an MCP server named `roder-design` or `roder`.

If mirroring Pencil's external config model:

- stdio MCP server bundled with Roder.
- supported integrations configured by user.
- config installation logic writes to Claude/Codex/Gemini/OpenCode config formats.
- local socket or direct app-server connection routes tool requests.

Do not build this until native Roder design tools are stable.

## Rendering strategy

Start with SVG/DOM for structured design nodes and keep current sketch canvas separate. This lets Phase 1 ship selection, editable text, shapes, and inspector quickly.

Reassess canvas/WebGL/Skia only after performance fixtures prove SVG/DOM is insufficient.

## Initial file layout

Renderer:

```text
src/components/design-canvas/
  design-canvas-panel.tsx
  design-canvas-stage.tsx
  design-canvas-toolbar.tsx
  design-canvas-inspector.tsx
  design-canvas-layers.tsx
  design-node-view.tsx
```

Shared/frontend model:

```text
src/lib/design-canvas/
  document.ts
  commands.ts
  hit-testing.ts
  layout.ts
  import-pen.ts
  export.ts
  tool-contract.ts
```

Backend/app-server in `../roder`:

```text
crates/roder-app-server/src/design.rs
crates/roder-protocol/src/design.rs or methods.rs additions
```

## Validation strategy

- Type/schema tests for `.roderdesign`.
- Patch operation tests.
- Atomic persistence tests.
- `batch_get` search/depth tests.
- Layout snapshot tests.
- Renderer interaction tests where meaningful.
- Manual Electron verification for sidebar/pointer UX.

# Pencil MCP / Agent Integration Discovery

Date: 2026-06-05

## What was inspected

From the extracted Pencil app archive at `/tmp/pencil-asar`:

- `out/desktop-mcp-adapter.js`
- `out/desktop-resource-device.js`
- `out/ipc-electron.js`
- `node_modules/@ha/mcp/src/*`
- `node_modules/@ha/ipc/src/*`
- `node_modules/@ha/shared/src/*`

This document describes behavior and interface shape. Do not copy private code into Roder.

## Pencil integration architecture

Pencil has three layers for agent/design interaction:

1. **Editor renderer**
   - Owns the live design document and implements tool handlers such as `batch-get`, `batch-design`, `get-screenshot`, etc.
   - Receives requests over Electron IPC from main process/resource manager.

2. **Desktop resource/device manager**
   - One `ResourceDevice` per open `.pen` file/window.
   - Tracks file path, content, dirty state, session, file access, imported files/assets, workspace folder, libraries, and agent auth/env.
   - Routes renderer IPC operations to/from agent and MCP transport.

3. **MCP transport / agents**
   - Pencil installs a stdio MCP server named `pencil` into supported agents/configs.
   - The MCP server connects to a local node-ipc socket under `~/.pencil/socket`.
   - Tool requests include `client_id`, `request_id`, tool `name`, and payload.
   - A `TransportRequestRouter` extracts `filePath` from payload, finds the IPC host for that document, calls `ipc.request(toolName, params)`, and returns success/error/result.
   - In-process agent execution also routes tool calls to the renderer, translating MCP names from underscores to hyphens.

## Pencil MCP installation model

Pencil's desktop MCP adapter exposes:

- install path of bundled MCP binary.
- app path.
- app name (`desktop`).
- supported integrations:
  - `claudeCodeCLI`
  - `codexCLI`
  - `geminiCLI`
  - `antigravity`
  - `openCodeCLI`
  - `kiroCLI`
  - `claudeDesktop`

The MCP config is stdio:

```json
{
  "name": "pencil",
  "transport": "stdio",
  "command": "<appFolder>/out/mcp-server-<platform>",
  "args": ["--app", "desktop"],
  "env": {}
}
```

Depending on the target integration, Pencil mutates config shape: removes unsupported fields, writes TOML for Codex, marks `type: stdio` for Claude-style configs, or `type: local` for OpenCode.

## Pencil tool schemas

Pencil exports these MCP tools:

| Tool               | Read-only | Destructive | Purpose                                                                 |
| ------------------ | --------- | ----------- | ----------------------------------------------------------------------- |
| `get_editor_state` | yes       | no          | Return editor state, optionally schema and rules.                       |
| `batch_get`        | yes       | no          | Read/search nodes by ids/patterns with depth controls.                  |
| `batch_design`     | no        | yes         | Modify design document from a natural-language/structured input string. |
| `snapshot_layout`  | yes       | no          | Return layout rectangles and layout problems.                           |
| `get_screenshot`   | yes       | no          | Return screenshot of document or node.                                  |
| `export_nodes`     | no        | yes         | Export selected nodes to an output directory.                           |
| `get_variables`    | yes       | no          | Read design variables.                                                  |
| `set_variables`    | no        | yes         | Merge/replace variables.                                                |
| `get_guidelines`   | yes       | no          | Retrieve design guidelines by category/name.                            |
| `spawn_agents`     | no        | no          | Spawn additional designer agents assigned to container nodes.           |

Important schema details:

- Most document-scoped tools accept `filePath`.
- `batch_get` supports:
  - `nodeIds`
  - `patterns` with `name`, `type`, `reusable`
  - `parentId`
  - `searchDepth`
  - `readDepth`
  - `includePathGeometry`
  - `resolveVariables`
  - `resolveInstances`
- `batch_design` accepts `input: string`; Pencil's renderer/editor interprets it.
- `export_nodes` accepts `nodeIds`, `outputDir`, `format`, `scale`, `quality`.
- `get_screenshot` accepts `nodeId` or `document`.
- `spawn_agents` accepts configs with `prompt` and `containerNodes`.

## ResourceDevice interface shape

The Pencil resource abstraction includes:

- document state:
  - `getResourcePath()`
  - `getResourceContents()`
  - `getIsDirty()`
  - `saveResource()`
  - `fileChanged()`
- file/assets:
  - `readFile`, `writeFile`, `statFile`
  - `watchFile`, `unwatchFile`
  - `importFiles`, `importFileByName`, `importFileByUri`
  - temp file save/cleanup
- agent bridge:
  - `submitPrompt(prompt, model, selectedIDs, files)`
  - `getAgentPackagePath`, `getAgentApiKey`, `getAgentEnv`
  - `agentIncludePartialMessages`
- workspace/libraries:
  - `getWorkspaceFolderPath`, `setWorkspaceFolderPath`
  - `findLibraries`, `turnIntoLibrary`, `browseLibraries`
- UI/platform:
  - theme, external URL, left sidebar, design mode, session/device id.

## What to mirror in Roder

Roder should mirror the _shape_, not the private implementation:

1. A durable design document resource per workspace with file path and dirty state.
2. A narrow tool API that can be used by Roder's own agents directly and optionally exposed to external MCP later.
3. Tool names/functionality analogous to Pencil:
   - `design/get_editor_state`
   - `design/batch_get`
   - `design/batch_design` or preferably stricter `design/patch`
   - `design/snapshot_layout`
   - `design/get_screenshot`
   - `design/export_nodes`
   - `design/get_variables`
   - `design/set_variables`
   - `design/get_guidelines`
   - `design/spawn_agents` only if it maps cleanly to Roder subagents later.
4. An IPC/event bridge so renderer selection/live state and backend file/tool state remain synchronized.
5. A backend authority for persistence under the workspace-specific Roder data directory.

## Difference from Pencil

Pencil routes MCP tool calls to the renderer because the renderer owns the live scenegraph. For Roder, prefer this split:

- **Backend/app-server owns durable `.roderdesign` JSON and validates patches.**
- **Renderer owns transient view state: selection, camera, drag interaction.**
- Tools read/patch backend state directly and notify renderer.
- Screenshot/export may either:
  - call renderer for exact visual export, or
  - use a backend renderer later if available.

This avoids making the Roder agent depend on an open sidebar view for all design operations, while still allowing renderer-only operations when needed.

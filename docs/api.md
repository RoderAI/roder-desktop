# Roder App-Server API

This document is the canonical integrator-facing reference for the Roder
app-server API. It describes the JSON-RPC methods implemented by
`crates/roder-app-server`, the shared wire DTOs in `crates/roder-protocol`, and
the notification stream emitted to desktop or sibling clients.

For Roder Desktop user extensions, package manifests, `.rdx` archives, commands,
tools, panels, and theme contributions, see `docs/extensions.md`.

> Maintenance note: update this document with the `roder-app-server-docs` skill
> whenever app-server methods, request/response types, events, auth/config
> behavior, provider/model behavior, or session/thread semantics change.

## Overview

The app-server is a JSON-RPC 2.0 control plane for Roder runtime state. Clients
use it to:

- initialize against the current runtime, provider, model, workspace, and
  settings.
- create or resume sessions and desktop-shaped threads.
- start, steer, interrupt, and observe turns.
- list/select providers, models, runners, tools, agents, commands, memories,
  media artifacts, workflow imports, plan reviews, hunks, and background tasks.
- receive notifications for turn lifecycle, streamed assistant output, tool
  lifecycle, teams, workflow imports, media, memory, plan review, and hunk
  events.

The source of truth for method registration is
`AppServer::handle_request` in `crates/roder-app-server/src/server.rs`.

## Transport

All methods use JSON-RPC 2.0 request/response envelopes:

```json
{
  "jsonrpc": "2.0",
  "id": "request-id",
  "method": "thread/start",
  "params": {}
}
```

Responses echo the request `id` and contain either `result` or `error`:

```json
{
  "jsonrpc": "2.0",
  "id": "request-id",
  "result": {}
}
```

Local clients can call the in-process `LocalAppClient`. Remote mode exposes the
same JSON-RPC method surface over an authenticated WebSocket; see
`docs/app-server/remote.md` for startup flags, bearer-token headers,
subprotocol auth, pairing URLs, and remote security assumptions.

Notifications are JSON-RPC notification envelopes with no `id`:

```json
{
  "jsonrpc": "2.0",
  "method": "turn/started",
  "params": {}
}
```

## Authentication and Credentials

Most app-server methods run with the local Roder process authority. There is no
per-request app-server auth layer for in-process clients.

Remote WebSocket mode requires a bearer token during the WebSocket handshake.
Clients send either:

```text
Authorization: Bearer <token>
```

or, for browser-constrained clients:

```text
Sec-WebSocket-Protocol: gode.remote.v1, bearer.<token>
```

Provider auth is provider-specific:

- `auth/codex/login`, `auth/codex/status`, and `auth/codex/logout` manage the
  Codex OAuth token store through `roder-codex-auth`.
- `providers/list` reports each provider's `authType`, `authLabel`,
  `authenticated`, and optional `authDetail`.
- API-key providers rely on environment/config outside this app-server method
  surface.

Config persistence is opt-in on the `AppServer` instance. When enabled,
`providers/select`, `settings/set_web_search`, and `settings/set_default_mode`
write the selected defaults to `~/.roder/config.toml`.

## Core Concepts

`thread` is the persisted runtime conversation unit used by desktop-facing
clients. It is shaped as:

```json
{
  "id": "thread-123",
  "preview": "Untitled thread",
  "modelProvider": "openai",
  "createdAt": 1770000000,
  "updatedAt": 1770000100,
  "status": { "type": "idle", "activeTurnId": null, "activeFlags": [] },
  "workspaceId": "ws_abc123",
  "rootId": "root_abc123",
  "cwd": "/Users/pz/w/gode",
  "name": "optional title",
  "turns": []
}
```

`workspace` is a named project container with one or more registered filesystem
roots. `root` is an admitted absolute directory inside that workspace. `cwd` is
the execution directory derived from the selected root unless a client supplies
a child path.

`turn` is one model interaction within a thread:

```json
{
  "id": "turn-123",
  "items": [],
  "itemsView": "default",
  "status": "inProgress",
  "startedAt": 1770000000
}
```

`item` is a typed visible row or event within a turn. Public item `type` values
are `userMessage`, `agentMessage`, `reasoning`, `toolExecution`, `compaction`,
`error`, and `raw`.

`provider` is an inference backend. Provider/model notation is exposed as a
provider id plus model id, for example `openai` and `gpt-5.5`, or provider
catalog entries that intentionally use Codex provider IDs.

`mode` is Roder's policy mode. App-server clients see it in `thread/state` and
can change it with `thread/set_mode` or `settings/set_default_mode`.

## Method Index

Core:

| Method                      | Purpose                                                         |
| --------------------------- | --------------------------------------------------------------- |
| `initialize`                | Desktop startup handshake with active provider, model, and cwd. |
| `extensions/list`           | List extension manifests and capability status.                 |
| `providers/list`            | List providers, auth status, capabilities, and models.          |
| `providers/configure`       | Persist an API key for an API-key provider.                     |
| `providers/select`          | Select active default provider/model/reasoning.                 |
| `model/list`                | List desktop model descriptors.                                 |
| `settings/get`              | Read hosted web search mode and default policy mode.            |
| `settings/set_web_search`   | Set hosted web search mode.                                     |
| `settings/set_default_mode` | Set default policy mode.                                        |
| `auth/codex/login`          | Start Codex OAuth login.                                        |
| `auth/codex/status`         | Read Codex OAuth status.                                        |
| `auth/codex/logout`         | Clear Codex OAuth credentials.                                  |
| `auth/supergrok/login`      | Start SuperGrok OAuth login.                                    |
| `auth/supergrok/status`     | Read SuperGrok OAuth status.                                    |
| `auth/supergrok/logout`     | Clear SuperGrok OAuth credentials.                              |

Threads and turns:

| Method                      | Purpose                                                           |
| --------------------------- | ----------------------------------------------------------------- |
| `thread/start`              | Create a desktop thread.                                          |
| `thread/list`               | List desktop threads.                                             |
| `thread/read`               | Read a desktop thread with optional turns.                        |
| `thread/archive`            | Archive a desktop thread so it no longer appears in active lists. |
| `thread/goal/get`           | Read the durable goal state for a thread.                         |
| `turn/start`                | Start a desktop turn from rich text input.                        |
| `turn/steer`                | Add user input to an active desktop turn.                         |
| `turn/interrupt`            | Interrupt an active desktop turn.                                 |
| `thread/state`              | Read policy mode and pending plan-exit state.                     |
| `thread/set_mode`           | Set the live policy mode.                                         |
| `thread/exit_plan`          | Resolve a pending plan-exit request.                              |
| `thread/resolve_approval`   | Resolve a pending tool approval request.                          |
| `thread/resolve_user_input` | Resolve a pending model-requested user input request.             |

Tools, commands, files, agents, and tasks:

| Method               | Purpose                                                |
| -------------------- | ------------------------------------------------------ |
| `tools/list`         | List runtime tool specs.                               |
| `tools/call`         | Directly call allowed workflow tools.                  |
| `commands/list`      | List configured slash commands.                        |
| `commands/expand`    | Expand a command to a model prompt and context blocks. |
| `commands/run`       | Expand a command and start a turn.                     |
| `skills/list`        | List runtime skills and diagnostics.                   |
| `skills/setEnabled`  | Enable or disable a skill by selector.                 |
| `skills/setExposure` | Set a skill's runtime exposure by selector.            |
| `fs/readFile`        | Read an absolute host file as base64.                  |
| `fs/readDirectory`   | List direct children of an absolute host directory.    |
| `command/exec`       | Run a non-PTY command subject to policy checks.        |
| `agents/list`        | List subagent definitions visible to the runtime.      |
| `tasks/submit`       | Submit a background task.                              |
| `tasks/list`         | List task handles.                                     |
| `tasks/get`          | Read task handle plus logs.                            |
| `tasks/cancel`       | Cancel a task.                                         |
| `tasks/subscribe`    | Return supported task event kinds.                     |

Teams and panes:

| Method                  | Purpose                                     |
| ----------------------- | ------------------------------------------- |
| `team/start`            | Start an agent team.                        |
| `team/list`             | List active/persisted teams.                |
| `team/read`             | Read a team and mailbox messages.           |
| `team/member/start`     | Add a teammate.                             |
| `team/member/message`   | Send a direct teammate message.             |
| `team/member/interrupt` | Interrupt a teammate.                       |
| `team/member/focus`     | Validate and acknowledge focused teammate.  |
| `team/cleanup`          | Cleanup team state.                         |
| `team/pane/focus`       | Unsupported in headless app-server clients. |
| `team/pane/cleanup`     | Unsupported in headless app-server clients. |

Review, hunks, workflow imports, media, memory, and speech:

| Method                     | Purpose                                                     |
| -------------------------- | ----------------------------------------------------------- |
| `turn/subagentTraces/list` | List subagent traces for a turn.                            |
| `turn/subagentTrace/read`  | Read paged subagent trace deltas.                           |
| `plan/review/read`         | Read a plan review.                                         |
| `plan/review/comment`      | Add a review comment and steer the turn.                    |
| `plan/review/rewrite`      | Request a plan rewrite and steer the turn.                  |
| `plan/review/approve`      | Approve a plan review.                                      |
| `plan/review/reject`       | Reject a plan review.                                       |
| `vcs/changes/list`         | List live provider changes against the resolved base.       |
| `vcs/changes/read`         | Read paged changed content for one provider file.           |
| `workspace/list`           | List registered project workspaces and roots.               |
| `workspace/create`         | Create a workspace from one or more filesystem roots.       |
| `workspace/update`         | Rename a workspace, replace roots, or set its default root. |
| `workspace/forget`         | Remove a workspace registry entry.                          |
| `hunk/list`                | List recorded hunks, optionally by turn/review.             |
| `hunk/read`                | Read a paged hunk diff.                                     |
| `hunk/rollback`            | Confirm and apply a hunk reverse patch.                     |
| `workspace/changes/list`   | List observed VCS-reconciled shell/exec changes.            |
| `workflow/scan`            | Scan workflow imports.                                      |
| `workflow/preview`         | Preview workflow import items.                              |
| `workflow/enable`          | Enable a workflow import.                                   |
| `workflow/ignore`          | Ignore a workflow import.                                   |
| `workflow/refresh`         | Re-scan and detect stale enabled imports.                   |
| `workflow/remove`          | Remove an enabled workflow import decision.                 |
| `media/list`               | List media artifacts.                                       |
| `media/read`               | Read artifact bytes as base64.                              |
| `media/thumbnail`          | Read an artifact preview.                                   |
| `media/delete`             | Delete an artifact.                                         |
| `media/attachToTurn`       | Convert an artifact to a turn attachment/image.             |
| `memory/list`              | List memory records.                                        |
| `memory/read`              | Read one memory.                                            |
| `memory/save`              | Save a memory.                                              |
| `memory/update`            | Update a memory.                                            |
| `memory/delete`            | Delete a memory.                                            |
| `memory/query`             | Search memories.                                            |
| `memory/provider/list`     | List embedding providers and selected provider.             |
| `memory/provider/set`      | Persist the embedding provider/model.                       |
| `memory/recall/preview`    | Preview recall citations/results for a turn.                |
| `speech/providers/list`    | Discover available speech transcription providers.          |
| `speech/transcribe`        | Transcribe an audio recording to text.                      |

## Detailed Method Reference

### `initialize`

Purpose: Perform the desktop startup handshake.

Request:

```json
{}
```

Response:

```json
{
  "provider": "openai",
  "model": "gpt-5.5",
  "cwd": "/Users/pz/w/gode"
}
```

Behavior:

- Reads the runtime default provider/model.
- Uses the process current directory for `cwd` when available.

Errors:

- None expected from the current handler beyond serialization/runtime failure.

### `providers/list`

Purpose: Discover provider auth state, models, and capabilities.

Request:

```json
{}
```

Response:

```json
{
  "active_provider": "openai",
  "active_model": "gpt-5.5",
  "active_reasoning": "high",
  "providers": [
    {
      "id": "openai",
      "name": "OpenAI",
      "description": "OpenAI Responses API",
      "auth_type": "api_key",
      "auth_label": "OPENAI_API_KEY",
      "authenticated": true,
      "auth_detail": null,
      "recommended": true,
      "sort_order": 0,
      "capabilities": {},
      "models": []
    }
  ]
}
```

Behavior:

- Providers are sorted by `sortOrder`, then name.
- OAuth providers report `authenticated` by checking the relevant token store.
- Model listing failures for an individual provider are treated as an empty
  model list.

### `providers/configure`

Purpose: Persist an API key for a registered API-key provider.

Request:

```json
{
  "provider": "opencode",
  "api_key": "sk-..."
}
```

Response:

```json
{
  "provider": "opencode",
  "authenticated": true
}
```

Behavior:

- Normalizes provider aliases before saving, so `opencode-zen` is stored as
  `opencode`.
- Requires the provider to be registered in the runtime inference registry.
- Writes the key to the user config only when the app-server was created with
  user-config persistence enabled.

Errors:

- Empty or unknown providers return code `-32602`.
- Empty API keys return code `-32602`.
- Disabled user-config persistence returns code `-32000`.

### `providers/select`

Purpose: Select the active provider, model, and optional reasoning effort.

Request:

```json
{
  "provider": "openai",
  "model": "gpt-5.5",
  "reasoning": "high"
}
```

Response:

```json
{
  "provider": "openai",
  "model": "gpt-5.5",
  "reasoning": "high"
}
```

Behavior:

- Calls the runtime provider selector.
- Persists defaults only when the app-server was created with user-config
  persistence enabled.

Errors:

- Runtime provider/model validation errors return code `-32000` with
  `data.details`.

### `settings/get`

Purpose: Read runtime settings that app-server clients commonly expose.

Request:

```json
{}
```

Response:

```json
{
  "web_search": { "mode": "cached" },
  "default_provider": "openai",
  "default_model": "gpt-5.5",
  "default_reasoning": "medium",
  "default_mode": "default"
}
```

Notes:

- `web_search.mode` is one of `disabled`, `cached`, or `live`.
- `default_provider`, `default_model`, `default_reasoning`, and `default_mode`
  initialize desktop controls.
- `default_mode` is a `PolicyMode` value from `roder-api`.

### `settings/set_web_search`

Purpose: Change hosted web-search mode.

Request:

```json
{
  "mode": "live"
}
```

Response:

```json
{
  "web_search": { "mode": "live" }
}
```

Behavior:

- Updates runtime state immediately.
- Persists `disabled`, `codex`, or `live` to config when persistence is
  enabled. `codex` is the persisted config value for cached hosted search.

### `settings/set_default_mode`

Purpose: Change the default policy mode.

Request:

```json
{
  "mode": "plan"
}
```

Response:

```json
{
  "default_mode": "plan"
}
```

Behavior:

- Calls runtime policy-mode update with reason `settings default mode`.
- Persists a config value only when user-config persistence is enabled.

### `auth/codex/*`, `auth/supergrok/*`

Purpose: Manage provider OAuth credentials for Codex and SuperGrok.

Request:

```json
{}
```

Response:

```json
{
  "signed_in": true,
  "account_id": "acct_123"
}
```

Behavior:

- `login` runs the provider login flow and returns `signedIn: true`.
- `status` returns whether tokens are present.
- `logout` clears tokens and returns `signedIn: false`.

Errors:

- Token-store or login-flow errors return code `-32000` with `data.details`.

### `thread/start`

Purpose: Create a desktop thread.

Request:

```json
{
  "workspaceId": "ws_abc123",
  "rootId": "root_abc123",
  "model": "gpt-5.5",
  "modelProvider": "openai",
  "reasoning": "high",
  "initialPrompt": "inspect this repo",
  "ephemeral": false
}
```

Response:

```json
{
  "thread": {
    "id": "thread-123",
    "preview": "Untitled thread",
    "modelProvider": "openai",
    "model": "gpt-5.5",
    "createdAt": 1770000000,
    "updatedAt": 1770000000,
    "status": { "type": "idle", "activeTurnId": null, "activeFlags": [] },
    "workspaceId": "ws_abc123",
    "rootId": "root_abc123",
    "cwd": "/Users/pz/w/gode"
  },
  "model": "gpt-5.5",
  "modelProvider": "openai",
  "reasoning": "high",
  "workspaceId": "ws_abc123",
  "rootId": "root_abc123",
  "cwd": "/Users/pz/w/gode"
}
```

Behavior:

- Creates a persisted runtime thread with optional provider/model and required
  `workspaceId`.
- `rootId` is optional and defaults to the workspace default root.
- `cwd` is optional. When omitted, it defaults to the selected root path. When
  supplied, it must be the selected root or a child path of that root.
- Stores the selected provider/model/reasoning for later `turn/start` overrides.
- If `reasoning` is omitted, returns and stores the effective reasoning effort for the selected model.
- If `initialPrompt` is supplied, uses it as the first-turn prompt context for immediate thread naming.
- Emits `thread/started`.
- `ephemeral` is accepted by the DTO but is not currently used by the handler.

### `thread/list`

Purpose: Bootstrap or refresh a desktop sidebar.

Request:

```json
{
  "limit": 100
}
```

Response:

```json
{
  "data": [
    {
      "id": "thread-123",
      "preview": "Fix tests",
      "modelProvider": "openai",
      "model": "gpt-5.5",
      "createdAt": 1770000000,
      "updatedAt": 1770000100,
      "status": { "type": "idle", "activeTurnId": null, "activeFlags": [] },
      "cwd": "/Users/pz/w/gode",
      "name": "Fix tests"
    }
  ],
  "nextCursor": null,
  "backwardsCursor": null
}
```

Behavior:

- Lists persisted runtime threads sorted by newest `updatedAt` first.
- Applies `limit` when supplied.
- Merges in protocol threads that are in memory but not yet persisted.
- Cursor fields are currently always null.

### `thread/read`

Purpose: Read one desktop thread and optionally include turns/items.

Request:

```json
{
  "threadId": "thread-123",
  "includeTurns": true
}
```

Response:

```json
{
  "thread": {
    "id": "thread-123",
    "preview": "Fix tests",
    "modelProvider": "openai",
    "createdAt": 1770000000,
    "updatedAt": 1770000100,
    "status": { "type": "idle", "activeTurnId": null, "activeFlags": [] },
    "cwd": "/Users/pz/w/gode",
    "turns": [
      {
        "id": "turn-123",
        "items": [],
        "itemsView": "default",
        "status": "completed"
      }
    ]
  }
}
```

Behavior:

- Reads a persisted thread snapshot first.
- Falls back to persisted thread metadata and then in-memory protocol threads.
- Returns `{"thread": null}` when the thread is unknown.

### `thread/archive`

Purpose: Archive a thread and remove it from active app-server thread lists.

Request:

```json
{
  "threadId": "thread-123"
}
```

Response:

```json
{
  "threadId": "thread-123",
  "archived": true
}
```

Behavior:

- Calls the runtime thread archive path for the supplied `threadId`.
- Removes in-memory protocol thread and selected model bookkeeping for the
  thread.
- After archive, `thread/list` no longer returns the thread and `thread/read`
  returns `{ "thread": null }`.

### `thread/goal/get`

Purpose: Read the durable goal state for a thread.

Request:

```json
{
  "threadId": "thread-123"
}
```

Response:

```json
{
  "goal": {
    "threadId": "thread-123",
    "objective": "Ship the goal parity slice",
    "status": "active",
    "tokenBudget": 20000,
    "tokensUsed": 1200,
    "timeUsedSeconds": 180,
    "createdAt": "2026-05-22T09:00:00Z",
    "updatedAt": "2026-05-22T09:03:00Z"
  }
}
```

Behavior:

- Returns `{ "goal": null }` when no goal is set.
- Goal status is one of `active`, `paused`, `blocked`, `usageLimited`,
  `budgetLimited`, or `complete`.
- Goal changes are also surfaced through `thread/goal/updated` and
  `thread/goal/cleared` notifications.

### `turn/start`

Purpose: Start a desktop turn on a thread.

Request:

```json
{
  "threadId": "thread-123",
  "input": [{ "type": "text", "text": "inspect this repo" }],
  "modelProvider": "openai",
  "model": "gpt-5.5",
  "reasoning": "high",
  "policyMode": "default"
}
```

Response:

```json
{
  "turnId": "turn-123"
}
```

Behavior:

- Concatenates text input blocks with newlines.
- Uses `prompt` as a transition fallback only when text input is empty.
- Uses explicit model/provider/reasoning overrides first, then the thread's
  selected provider/model/reasoning when known.
- Applies `policyMode` as the live policy mode before starting the turn.
- Starts a runtime turn and records the active turn id for optional
  `turn/interrupt`.

Notifications:

- `turn/started`
- `thread/status/changed` with status `running`
- zero or more typed item-event notifications such as `item/started`,
  `item/agentMessage/delta`, `item/reasoning/textDelta`, and `item/completed`
- optional wait-state notifications: `thread/approvalRequested`,
  `thread/userInputRequested`, or `thread/planExitRequested`, paired with
  their corresponding resolved notifications when the client answers
- terminal `turn/completed`
- `thread/status/changed` with status `idle`

### `turn/steer`

Purpose: Send additional user input to an active desktop turn.

Request:

```json
{
  "threadId": "thread-123",
  "expectedTurnId": "turn-123",
  "input": [{ "type": "text", "text": "also check the app-server tests" }]
}
```

Response:

```json
{
  "turnId": "turn-123"
}
```

Behavior:

- Requires `expectedTurnId`.
- Converts rich text input using the same logic as `turn/start`.
- Calls runtime steering for the supplied turn id.

### `turn/interrupt`

Purpose: Interrupt a desktop turn.

Request:

```json
{
  "threadId": "thread-123"
}
```

Response:

```json
{
  "turnId": "turn-123"
}
```

Behavior:

- Uses `turnId` when supplied.
- Otherwise looks up the active turn recorded by `turn/start`.
- Removes the active-turn record after interrupting.

Errors:

- If no `turnId` is supplied and no active turn is known, returns code
  `-32602` with message `no active turn for thread ...`.

### `thread/state`

Purpose: Read current policy mode and any pending plan-exit request.

Request:

```json
{}
```

Response:

```json
{
  "mode": "plan",
  "pendingPlanExit": {
    "threadId": "thread-123",
    "turnId": "turn-123",
    "requestId": "request-123",
    "targetMode": "default",
    "planSummary": "Implement the test first.",
    "requestedAt": "2026-05-18T12:00:00Z",
    "expiresAt": null
  }
}
```

### `thread/set_mode`

Purpose: Set the live policy mode.

Request:

```json
{
  "mode": "accept_all",
  "reason": "desktop toggle"
}
```

Response:

```json
{
  "mode": "accept_all"
}
```

### `thread/exit_plan`

Purpose: Approve or reject a pending plan-mode exit.

Request:

```json
{
  "requestId": "request-123",
  "approved": true
}
```

Response:

```json
{
  "resolved": true,
  "mode": "default"
}
```

### `thread/resolve_approval`

Purpose: Resolve a pending tool approval.

Request:

```json
{
  "approvalId": "approval-123",
  "approved": true
}
```

Response:

```json
{
  "resolved": true
}
```

### `thread/resolve_user_input`

Purpose: Resolve a pending `request_user_input` tool request.

Request:

```json
{
  "requestId": "input-123",
  "answers": {
    "choice": "continue"
  }
}
```

Response:

```json
{
  "resolved": true
}
```

### `fs/readFile`

Purpose: Read a file from the host filesystem.

Request:

```json
{
  "path": "/Users/pz/w/gode/README.md"
}
```

Response:

```json
{
  "dataBase64": "IyBSb2Rlcgo="
}
```

Errors:

- Relative paths return code `-32602` and message `path must be absolute`.
- Filesystem read errors return code `-32000` with `data.details`.

### `fs/readDirectory`

Purpose: List direct children of an absolute host directory.

Request:

```json
{
  "path": "/Users/pz/w/gode/docs"
}
```

Response:

```json
{
  "entries": [{ "fileName": "api.md", "isDirectory": false, "isFile": true }]
}
```

Behavior:

- Entries are sorted by `fileName`.
- Only direct children are returned.

### `command/exec`

Purpose: Run a one-off non-PTY command under the current policy mode.

Request:

```json
{
  "command": ["cargo", "test", "-p", "roder-app-server"],
  "processId": "process-123",
  "cwd": "/Users/pz/w/gode",
  "env": {
    "RUST_LOG": "info",
    "NO_COLOR": null
  },
  "timeoutMs": 30000,
  "outputBytesCap": 1048576,
  "streamStdoutStderr": true
}
```

Response when `streamStdoutStderr` is false:

```json
{
  "exitCode": 0,
  "stdout": "ok\n",
  "stderr": ""
}
```

Response when `streamStdoutStderr` is true:

```json
{
  "exitCode": 0,
  "stdout": "",
  "stderr": ""
}
```

Behavior:

- Requires `command` to be non-empty.
- `cwd` must be absolute when supplied.
- Default timeout is 30000 ms unless `disableTimeout` is true.
- Default output cap is 1048576 bytes unless `disableOutputCap` is true.
- When streaming is enabled, `processId` is required and stdout/stderr are sent
  as `command/exec/outputDelta` notifications.
- Command execution is checked by the runtime policy gate as a `shell` tool.

Unsupported:

- `tty`, `streamStdin`, and resize via `size` return code `-32004` with
  `data.kind: "unsupported"`.

Validation:

- `disableTimeout` cannot be combined with `timeoutMs`.
- `disableOutputCap` cannot be combined with `outputBytesCap`.

### `tools/list`

Purpose: List tools available to the runtime.

Request:

```json
{}
```

Response:

```json
{
  "tools": [
    {
      "name": "exec_command",
      "description": "Run a command",
      "input_schema": {}
    }
  ]
}
```

### `tools/call`

Purpose: Directly call selected workflow tools.

Request:

```json
{
  "thread_id": "thread-123",
  "tool_name": "get_goal",
  "arguments": {}
}
```

Response:

```json
{
  "text": "",
  "data": {},
  "is_error": false
}
```

Behavior:

- Only `get_goal`, `create_goal`, and `update_goal` can be called directly.
- Other tool names return code `-32602`.

### `commands/list`

Purpose: List available slash commands.

Request:

```json
{}
```

Response:

```json
{
  "commands": [
    {
      "name": "test",
      "description": "Run tests",
      "argument_hint": "[package]",
      "source": "builtin",
      "model": null,
      "agent": null,
      "has_shell_includes": false,
      "has_url_includes": false
    }
  ]
}
```

### `commands/expand`

Purpose: Expand a command into prompt text and context blocks without running
it.

Request:

```json
{
  "name": "test",
  "arguments": "roder-app-server",
  "workspace": "/Users/pz/w/gode"
}
```

Response:

```json
{
  "command": {
    "name": "test",
    "description": "Run tests",
    "argument_hint": "[package]",
    "source": "builtin",
    "model": null,
    "agent": null,
    "has_shell_includes": false,
    "has_url_includes": false
  },
  "message": "Run tests for roder-app-server",
  "context_blocks": [],
  "allowed_tools": [],
  "model": null,
  "agent": null
}
```

Errors:

- Unknown commands return code `-32602`.
- Disabled command configuration returns code `-32000`.
- Missing workspace resolution returns code `-32000`.

### `commands/run`

Purpose: Expand a command and start a turn with the expanded prompt.

Request:

```json
{
  "thread_id": "thread-123",
  "name": "test",
  "arguments": "roder-app-server",
  "workspace": "/Users/pz/w/gode"
}
```

Response:

```json
{
  "turn_id": "turn-123",
  "expanded": {
    "command": {
      "name": "test",
      "description": "Run tests",
      "argument_hint": "[package]",
      "source": "builtin",
      "model": null,
      "agent": null,
      "has_shell_includes": false,
      "has_url_includes": false
    },
    "message": "Run tests for roder-app-server",
    "context_blocks": [],
    "allowed_tools": [],
    "model": null,
    "agent": null
  }
}
```

### Skills methods

Purpose: Inspect and update runtime skills available to the model and direct
`$skill` activation.

List request:

```json
{
  "method": "skills/list",
  "params": {
    "workspaceId": "ws_abc123",
    "rootId": "root_abc123",
    "cwd": "/Users/pz/w/gode"
  }
}
```

List response:

```json
{
  "skills": [
    {
      "id": "builtin:commit",
      "name": "commit",
      "canonicalPath": "builtin://skills/commit/SKILL.md",
      "source": "builtIn",
      "exposure": "direct_only",
      "activation": "enabled",
      "description": "Create a scoped git commit.",
      "shortDescription": "Commit workflow",
      "experimental": false,
      "diagnostics": [],
      "agentMetadata": null
    }
  ],
  "diagnostics": []
}
```

Mutation examples:

```json
{
  "method": "skills/setEnabled",
  "params": {
    "selector": { "path": "builtin://skills/commit/SKILL.md" },
    "enabled": false
  }
}
```

```json
{
  "method": "skills/setExposure",
  "params": {
    "selector": { "path": "builtin://skills/commit/SKILL.md" },
    "exposure": "global"
  }
}
```

Behavior:

- `skills/list`, `skills/setEnabled`, and `skills/setExposure` return
  `{ "skills": [], "diagnostics": [] }`.
- `skills/list` accepts optional `workspaceId`, `rootId`, and `cwd`. When
  supplied, the app-server resolves the workspace root and lists workspace-local
  skills for that path; with `{}` it returns the runtime skill snapshot.
- `selector` accepts a skill `name` or canonical `path`. Desktop callers should
  prefer `{ "path": canonicalPath }` to avoid ambiguous skill-name errors.
- `activation` is `enabled`, `disabled`, or `experimental`.
- `exposure` is `global` or `direct_only`.

### `tasks/submit`

Purpose: Submit a background task to a registered executor.

Request:

```json
{
  "executor_id": "task",
  "input": { "prompt": "summarize docs" },
  "thread_id": "thread-123",
  "turn_id": "turn-123",
  "workspace": "/Users/pz/w/gode"
}
```

Response:

```json
{
  "task": {
    "task_id": "task-123",
    "executor_id": "task",
    "status": "running"
  }
}
```

Behavior:

- Uses explicit `workspace`, then runtime workspace, then process cwd.
- If a remote runner is selected, creates a runner session for the task.
- Errors if the selected remote runner provider is not installed.

### `tasks/list`, `tasks/get`, `tasks/cancel`, `tasks/subscribe`

Purpose: Inspect and manage background tasks.

Examples:

```json
{
  "method": "tasks/get",
  "params": { "task_id": "task-123" }
}
```

```json
{
  "task": {
    "task_id": "task-123",
    "executor_id": "task",
    "status": "completed"
  },
  "logs": [{ "stream": "stdout", "chunk": "done\n", "timestamp": "2026-05-18T12:00:00Z" }],
  "dropped_bytes": 0
}
```

Errors:

- Unknown task ids return code `-32602`.

`tasks/subscribe` currently returns:

```json
{
  "subscribed": true,
  "event_kinds": ["task.started", "task.output", "task.completed", "task.failed", "task.cancelled"]
}
```

### `runners/list`

Purpose: Discover remote runner providers and current runner selection.

Request:

```json
{}
```

Response:

```json
{
  "active": null,
  "providers": [
    {
      "provider_id": "docker",
      "capabilities": {}
    }
  ]
}
```

### `runners/select`

Purpose: Select a remote runner destination.

Request:

```json
{
  "destination_id": "local-docker",
  "provider_id": "docker",
  "config": {},
  "manifest": {}
}
```

Response:

```json
{
  "active": {
    "destination_id": "local-docker",
    "provider_id": "docker",
    "state": "configured",
    "session_id": null
  }
}
```

Behavior:

- Defaults `provider_id` to `destination_id` when omitted.
- Validates the destination through the selected provider.
- Stores the runner destination on runtime state.

Errors:

- Unknown provider returns code `-32602`.
- Provider validation errors return code `-32602` with `data.details`.

### Runner utility methods

Purpose: Read or clear runner state.

Methods:

- `runners/session` returns the active runner destination.
- `runners/snapshot` currently returns `{ "snapshot": null }`.
- `runners/delete` clears the selected destination and returns
  `{ "deleted": true }`.
- `runners/ports` currently returns `{ "ports": [] }`.

### `team/start`

Purpose: Create an agent team.

Request:

```json
{
  "leadThreadId": "thread-123",
  "displayMode": "in_process",
  "members": [{ "name": "Reviewer", "modelProvider": "openai", "model": "gpt-5.5" }]
}
```

Response:

```json
{
  "team": {
    "id": "team-123",
    "leadThreadId": "thread-123",
    "displayMode": "in_process",
    "members": [],
    "tasks": []
  }
}
```

Behavior:

- Defaults display mode through `AgentTeamDisplayMode::default()` when omitted.
- Emits `team/started`.

### Team member methods

Purpose: Manage team state and route messages to teammates.

Examples:

```json
{
  "method": "team/member/message",
  "params": {
    "teamId": "team-123",
    "memberId": "member-123",
    "text": "review this patch",
    "expectedTurnId": null
  }
}
```

```json
{
  "turnId": "turn-456"
}
```

Behavior:

- `team/list` applies optional `limit` and currently returns `nextCursor: null`.
- `team/read` returns `{ "team": null, "messages": [] }` for unknown teams.
- `team/member/start` returns the newly appended member.
- `team/member/interrupt` returns whether a member turn was interrupted.
- `team/member/focus` validates the team and member and echoes
  `focusedMemberId`.
- `team/cleanup` delegates to runtime cleanup and honors `force`.
- `team/pane/focus` and `team/pane/cleanup` return method-not-found style code
  `-32601` with `data.supportedAlternative: "team/member/focus"` because split
  panes are TUI-local.

### Subagent traces

Purpose: Read subagent trace summaries and paged trace deltas from persisted
session events.

Examples:

```json
{
  "method": "turn/subagentTraces/list",
  "params": {
    "threadId": "thread-123",
    "turnId": "turn-123"
  }
}
```

```json
{
  "method": "turn/subagentTrace/read",
  "params": {
    "threadId": "thread-123",
    "traceId": "trace-123",
    "offset": 0,
    "limit": 100
  }
}
```

Behavior:

- Missing sessions return empty trace lists or empty event pages.
- Read defaults to `limit: 100`; limit is clamped to at least 1.
- `nextOffset` is present only when more events remain.

### Plan review methods

Purpose: Read and mutate plan review artifacts.

Examples:

```json
{
  "method": "plan/review/comment",
  "params": {
    "threadId": "thread-123",
    "reviewId": "review-123",
    "anchor": { "kind": "summary" },
    "body": "Please include tests."
  }
}
```

Behavior:

- `plan/review/read` returns `{ "review": null }` for unknown reviews.
- `comment` and `rewrite` emit runtime events and steer the review's turn with
  a synthesized message.
- `approve` and `reject` emit runtime events.
- Unknown review ids for mutating methods return code `-32602`.

### Hunk methods

Purpose: List, read, and rollback recorded file hunks.

Examples:

```json
{
  "method": "hunk/list",
  "params": {
    "threadId": "thread-123",
    "turnId": "turn-123",
    "reviewId": "review-123"
  }
}
```

```json
{
  "method": "hunk/rollback",
  "params": {
    "threadId": "thread-123",
    "hunkId": "hunk-123",
    "confirmed": true
  }
}
```

Behavior:

- `hunk/list` can filter by `turnId` and `reviewId`.
- `hunk/read` pages diff output with default limit 100 and minimum limit 1.
- `hunk/rollback` first emits `hunk/rollbackRequested`, then emits
  `hunk/rollbackCompleted`.
- Rollback requires `confirmed: true` and a recorded reverse patch.
- A successful rollback returns `{ "rolledBack": true }`; failures return
  `{ "rolledBack": false, "error": "..." }`.

### Workspace observed change methods

Purpose: List file-level workspace changes observed after shell/exec tools.

Examples:

```json
{
  "method": "workspace/changes/list",
  "params": {
    "threadId": "thread-123",
    "turnId": "turn-123"
  }
}
```

Behavior:

- `workspace/changes/list` can filter by `turnId`.
- Observed changes are VCS-reconciled file summaries, not exact structured
  hunks. The review panel can read current changed content through `vcs/changes/read`.
- New observed changes emit `workspace/changeObserved`.

### VCS change review methods

Purpose: Inspect the active version-control provider without mutating files.

Examples:

```json
{
  "method": "vcs/changes/list",
  "params": {
    "workspaceId": "ws_abc123",
    "rootId": "root_abc123",
    "limit": 500
  }
}
```

```json
{
  "method": "vcs/changes/read",
  "params": {
    "workspaceId": "ws_abc123",
    "rootId": "root_abc123",
    "path": "src/app.rs",
    "area": "unstaged",
    "offset": 0,
    "limit": 400
  }
}
```

Behavior:

- VCS review operates on a registered workspace root. `workspaceId` is required;
  `rootId` is optional and defaults to the workspace default root.
- `vcs/changes/list` returns provider status, changed files, totals, and whether
  the file list was truncated.
- The bundled git provider compares the merge-base of the resolved base with the
  working tree, including committed, staged, unstaged, and untracked changes.
- `vcs/changes/read` validates provider-relative paths and returns paged changed
  content for one changed file. When `area` is omitted, it returns the full
  branch delta. When `area` is provided, providers may return just that file's
  `committed`, `staged`, `unstaged`, or `untracked` content.

### Workflow import methods

Purpose: Scan, preview, enable, ignore, refresh, and remove workflow imports for
AGENTS.md, skills, MCP, hooks, commands, and plugin-like artifacts.

Examples:

```json
{
  "method": "workflow/scan",
  "params": {
    "workspace": "/Users/pz/w/gode",
    "includeUser": true
  }
}
```

```json
{
  "method": "workflow/enable",
  "params": {
    "workspace": "/Users/pz/w/gode",
    "itemId": "skill:roder-app-server-docs",
    "approveSideEffects": true
  }
}
```

Behavior:

- When `workspace` is omitted, the handler uses runtime workspace then process
  cwd.
- `includeUser: true` also scans `~/.roder` and `~/.agents`.
- `enable`, `ignore`, and `remove` persist decisions to
  `~/.roder/workflow-imports.json` unless overridden by
  `RODER_WORKFLOW_IMPORTS_PATH`.
- Enabling an item that requires approval without `approveSideEffects` returns
  code `-32040` with `itemId`, `source`, and `risk` in `data`.

### Media methods

Purpose: Manage terminal media artifacts and turn attachments.

Examples:

```json
{
  "method": "media/list",
  "params": {
    "threadId": "thread-123",
    "kind": "image"
  }
}
```

```json
{
  "method": "media/read",
  "params": {
    "artifactId": "artifact-123",
    "maxBytes": 1048576
  }
}
```

Behavior:

- `media/list` currently filters by `kind`; `threadId` is accepted by the DTO
  but not used by the handler.
- `media/read` returns artifact metadata plus `bytesBase64`.
- `media/thumbnail` returns a `MediaPreview`.
- `media/delete` emits `media/artifactDeleted` when deletion succeeds.
- `media/attachToTurn` returns a `MediaAttachment` and an `InputImage` only for
  image artifacts.
- The media store root comes from config, `RODER_MEDIA_ARTIFACT_DIR`, or the
  default media artifact directory. Default max read size is 10 MiB.

### Memory methods

Purpose: Manage and search memories through the registered memory store.

Examples:

```json
{
  "method": "memory/save",
  "params": {
    "scope": { "kind": "project", "workspace": "/Users/pz/w/gode" },
    "text": "Roder app-server uses JSON-RPC.",
    "metadata": { "source": "docs" }
  }
}
```

```json
{
  "method": "memory/query",
  "params": {
    "scope": { "kind": "project", "workspace": "/Users/pz/w/gode" },
    "text": "app-server JSON-RPC",
    "limit": 10,
    "includeGlobal": true
  }
}
```

Behavior:

- `memory/list` defaults `limit` to 50.
- `memory/query` defaults `limit` to 10.
- `memory/recall/preview` defaults `limit` to 5 and emits
  `memory/recallReady`.
- Save/update/delete/query/provider changes emit memory notifications.
- If no memory store is registered, memory methods return code `-32000` and
  message `No memory store is registered`.

### Memory provider methods

Purpose: Inspect and persist the embedding provider/model used by memory recall.

Examples:

```json
{
  "method": "memory/provider/set",
  "params": {
    "providerId": "openai",
    "model": "text-embedding-3-large"
  }
}
```

Behavior:

- `memory/provider/list` returns registered embedding providers and the selected
  provider/model from config, defaulting to OpenAI
  `text-embedding-3-large`.
- `memory/provider/set` writes config and emits `memory/providerChanged`.

## Streaming and Notifications

Subscribe through `LocalAppClient::subscribe_notifications()` for local clients
or the remote WebSocket notification stream for remote clients.

### Turn and item notifications

`thread/started`:

```json
{
  "thread": {
    "id": "thread-123",
    "preview": "Untitled thread",
    "modelProvider": "openai",
    "model": "gpt-5.5",
    "createdAt": 1770000000,
    "updatedAt": 1770000000,
    "status": { "type": "idle", "activeTurnId": null, "activeFlags": [] },
    "cwd": "/Users/pz/w/gode"
  }
}
```

`turn/started`:

```json
{
  "threadId": "thread-123",
  "turn": {
    "id": "turn-123",
    "items": [],
    "itemsView": "default",
    "status": "inProgress",
    "startedAt": 1770000000
  }
}
```

`item/agentMessage/delta`:

```json
{
  "seq": 12,
  "eventId": "event-12",
  "threadId": "thread-123",
  "turnId": "turn-123",
  "timestamp": "2026-05-27T12:00:00Z",
  "event": {
    "type": "itemDelta",
    "itemId": "turn-123-agent-final_answer",
    "delta": {
      "type": "agentMessageText",
      "delta": "Hello",
      "phase": "final_answer"
    }
  }
}
```

`item/started`, `item/completed`, `item/agentMessage/delta`,
`item/reasoning/textDelta`, `item/reasoning/summaryPartAdded`, and
`item/reasoning/summaryTextDelta` all carry the same typed item-event envelope:
`seq`, `eventId`, `threadId`, `turnId`, `timestamp`, and `event`. The `event`
is `itemStarted`, `itemDelta`, or `itemCompleted`, and every lifecycle update
targets the same stable item id that later appears in `thread/read`.

`turn/completed` carries `threadId` and a terminal `turn` whose `status` is
`completed`, `failed`, or `interrupted`.

`thread/status/changed`:

```json
{
  "threadId": "thread-123",
  "status": { "type": "running", "activeTurnId": "turn-123", "activeFlags": ["approvalRequired"] }
}
```

`thread/goal/updated`:

```json
{
  "threadId": "thread-123",
  "goal": {
    "threadId": "thread-123",
    "objective": "Ship the goal parity slice",
    "status": "active",
    "tokensUsed": 1200,
    "timeUsedSeconds": 180,
    "createdAt": "2026-05-22T09:00:00Z",
    "updatedAt": "2026-05-22T09:03:00Z"
  }
}
```

`thread/goal/cleared`:

```json
{
  "threadId": "thread-123"
}
```

`thread/approvalRequested`:

```json
{
  "threadId": "thread-123",
  "turnId": "turn-123",
  "approvalId": "tool-call-123",
  "toolId": "tool-call-123",
  "toolName": "shell",
  "reason": "shell commands require approval"
}
```

Clients answer with `thread/resolve_approval`. `thread/approvalResolved`
echoes `threadId`, `turnId`, `approvalId`, `toolId`, `toolName`, and
`approved`.

`thread/userInputRequested`:

```json
{
  "threadId": "thread-123",
  "turnId": "turn-123",
  "requestId": "input-123",
  "questions": [
    {
      "id": "mode",
      "question": "Which mode?",
      "options": []
    }
  ]
}
```

Clients answer with `thread/resolve_user_input`. `thread/userInputResolved`
echoes `threadId`, `turnId`, `requestId`, and `answers`.

`thread/planExitRequested`:

```json
{
  "threadId": "thread-123",
  "turnId": "turn-123",
  "requestId": "exit-plan-123",
  "targetMode": "default",
  "planSummary": "Implement approved edits"
}
```

Clients answer with `thread/exit_plan`. `thread/planExitResolved` echoes
`threadId`, `turnId`, `requestId`, `approved`, `targetMode`, and
`resolvedMode`.

Ordering:

- `turn/started` is emitted before terminal `turn/completed`.
- A running status notification is emitted when a turn starts and includes the
  active turn id.
- Wait states keep `status.type` as `running` and set `activeFlags` to
  `approvalRequired`, `userInputRequired`, or `planExitRequired`.
- An idle status notification is emitted after completed, failed, or
  interrupted terminal turn notifications.

### Command output

`command/exec/outputDelta` is emitted only when `streamStdoutStderr` is true:

```json
{
  "processId": "process-123",
  "stream": "stdout",
  "deltaBase64": "b2sK",
  "capReached": false
}
```

### Team notifications

Team notifications include:

- `team/started`
- `team/member/started`
- `team/member/statusChanged`
- `team/member/messageDelta`
- `team/member/completed`
- `team/cleanupCompleted`

Example:

```json
{
  "teamId": "team-123",
  "memberId": "member-123",
  "turnId": "turn-456",
  "delta": "Reviewing"
}
```

### Advanced artifact notifications

The app-server forwards these event families as same-named JSON-RPC
notifications:

- Subagent traces: `turn/subagentTraceCreated`, `turn/subagentTraceDelta`,
  `turn/subagentTraceStatusChanged`, `turn/subagentTraceCompleted`,
  `turn/subagentTraceFailed`.
- Plan review: `plan/reviewCreated`, `plan/reviewStatusChanged`,
  `plan/reviewCommentAdded`, `plan/reviewRewritten`,
  `plan/reviewApproved`, `plan/reviewRejected`.
- Hunks: `hunk/recorded`, `hunk/rollbackRequested`,
  `hunk/rollbackCompleted`.
- Workflow imports: `workflow/importsDetected`, `workflow/importPreviewed`,
  `workflow/importEnabled`, `workflow/importDisabled`,
  `workflow/importStale`, `workflow/importFailed`.
- Media: `media/artifactCreated`, `media/artifactUpdated`,
  `media/artifactDeleted`, `media/previewReady`.
- Memory: `memory/saved`, `memory/updated`, `memory/deleted`,
  `memory/queried`, `memory/recallReady`, `memory/reembedQueued`,
  `memory/providerChanged`, `memory/observationRecorded`.

Payloads for these notifications are the corresponding `roder-api` event
structs serialized to JSON.

## Error Model

Common errors:

```json
{
  "code": -32601,
  "message": "Method not found"
}
```

```json
{
  "code": -32602,
  "message": "Invalid params: missing field `threadId`"
}
```

```json
{
  "code": -32000,
  "message": "provider error",
  "data": { "details": "provider error" }
}
```

Error conventions:

- `-32601`: unknown methods and unsupported split-pane methods in headless
  clients.
- `-32602`: JSON decoding failures, validation errors, unknown ids, relative
  paths, and invalid runner/team/hunk/memory references.
- `-32000`: runtime, filesystem, provider, config, task, command expansion,
  media, memory-store, and other internal errors. Most include
  `data.details`.
- `-32004`: command policy denial or unsupported `command/exec` mode.
- `-32040`: workflow import approval is required.

Cancellation and interruption:

- `turn/interrupt` calls the runtime interrupt path.
- `team/member/interrupt` interrupts only the selected member.
- `tasks/cancel` cancels a background task and returns `{ "cancelled": bool }`.

## Persistence and Contract Notes

- `thread/list` and `thread/read` use persisted threads first and in-memory
  protocol threads as a fallback.
- `providers/select`, `settings/set_web_search`, and
  `settings/set_default_mode` persist only when the app-server instance enables
  user-config persistence.
- Workflow import decisions are persisted under `~/.roder/workflow-imports.json`
  unless `RODER_WORKFLOW_IMPORTS_PATH` is set.
- Media artifact storage is configured by `media.artifacts_dir`,
  `RODER_MEDIA_ARTIFACT_DIR`, or the default media directory.
- `media/list` accepts `threadId` but currently filters only by `kind`.
- `thread/start` accepts `ephemeral` but the handler currently does not use it.
- Cursor fields in `thread/list` and `team/list` are reserved and currently
  null.

## Integration Recipes

### Startup and Sidebar Bootstrap

1. Call `initialize`.
2. Call `providers/list` and `model/list`.
3. Call `settings/get`.
4. Call `thread/list` with a reasonable limit.
5. Subscribe to notifications before starting or attaching to active turns.

### Create a Thread and Run a Turn

1. Call `thread/start` with `model`, `modelProvider`, and `cwd`.
2. Wait for `thread/started` or use the returned `thread`.
3. Call `turn/start` with rich text `input`.
4. Consume notifications until matching `turn/completed`.
5. Treat `thread/status/changed` `idle` as the sidebar busy-state clear.

### Resume a Thread

1. Call `thread/read` with `includeTurns: true`.
2. Render `thread.turns[].items`.
3. Subscribe to notifications.
4. Use `turn/start` for a new turn or `turn/steer` only when an active turn is
   known.

### Stop Work

1. Call `turn/interrupt` with `threadId`; include `turnId` when the client has
   it.
2. For teammate work, call `team/member/interrupt`.
3. For background tasks, call `tasks/cancel`.

### Run a Command with Streaming Output

1. Generate a client-side `processId`.
2. Call `command/exec` with `streamStdoutStderr: true`, `processId`, and an
   absolute `cwd`.
3. Append decoded `command/exec/outputDelta.deltaBase64` chunks by stream.
4. Use `capReached` to mark truncated output.
5. Use the final `exitCode` response as process completion.

### Provider Login and Selection

1. Call `providers/list`.
2. If the desired Codex provider has `authType: "oauth"` and
   `authenticated: false`, call `auth/codex/login`.
3. Call `providers/list` again or `auth/codex/status`.
4. Call `providers/select` with provider, model, and optional reasoning.

### Memories

1. Call `memory/provider/list` to show available embedding providers.
2. Optionally call `memory/provider/set`.
3. Use `memory/save` or `memory/update` for durable facts.
4. Use `memory/query` for search.
5. Use `memory/recall/preview` when preparing citations for a specific
   thread/turn.

## Maintenance Checklist

When changing the app-server surface, update this document after checking:

- `AppServer::handle_request` method registration.
- DTOs in `crates/roder-protocol/src/lib.rs`.
- Handler behavior in `crates/roder-app-server/src/server.rs`,
  `command.rs`, `fs.rs`, and `remote.rs`.
- Notification mapping in `crates/roder-app-server/src/notifications.rs`.
- E2E tests in `crates/roder-app-server/tests/e2e.rs`.
- Auth/config persistence behavior and environment variables.
- Removed methods and explicitly unsupported methods.

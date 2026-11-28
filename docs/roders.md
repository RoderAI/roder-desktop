# Durable proactive Roders

The desktop and API call this feature Roders: `roder_*` native tools,
`desktop/roders/*` methods, the `/roders` management route, and the private
application-data directory `roders`. Source modules use `RoderAgent*` names
(`electron/roder-agents/`) so they stay distinct from the Roder engine client.
Roders were previously called Persistent Agents. The rename was a clean break:
there is no data migration from the old `persistent-agents` directory, the old
`persistent_agent_*` tool names and `desktop/persistent-agents/*` methods are
not aliased, and the old route does not redirect. Threads created before the
rename still advertise the old tool names, which the desktop no longer resolves;
create a new Roder instead. Existing engine threads are never rewritten.

A Roder owns one real, persisted Roder thread. It keeps that thread across
check-ins and desktop restarts; it never starts a replacement thread to hide
context limits. Its versioned files (see [Roder files](#roder-files)) accompany
each new turn. Roder's native memory search retrieves additional facts, and its
native compaction summarizes the working transcript when necessary. This is
durable context, not infinite model context.

## Using a Roder

1. Open Roders, choose an existing project workspace, and create a Roder.
   The New project Roder dialog lets you choose a model and supported reasoning
   effort from the engine's model catalog, or keep the engine default.
   Creation makes a real thread without starting a proactive conversation turn.
   New Roders are paused; their separate character-generation job
   uses Codex quota immediately.
2. Edit the Roder's files. Set a daily run allowance and run time limit.
   The defaults are five runs per rolling 24 hours and ten minutes per run.
3. Choose a check-in interval, schedule a specific wake, or subscribe to engine
   event methods such as `turn/completed`. A zero interval means no recurring
   check-in. Events from the Roder's own thread are ignored; repeated events
   coalesce into one pending wake per method.
4. Explicitly choose **Enable proactive work**. Pending wakes and intervals do
   nothing while paused. **Run once** is a separate explicit manual action,
   available while paused, and consumes the same run allowance.

**Pause and interrupt** persists the paused state and requests interruption of
an active run. The service retains the active lease until the engine confirms
completion or an idle thread, so an interrupt request cannot cause overlap.
Run time enforcement checks every 15 seconds and also requests interruption;
it is not an instantaneous process kill. User-input waits remain subject to the
same run time limit. All Roder turns use the engine's `bypass`
permission mode: manual chat, **Run once**, and scheduled or event-triggered
runs do not require tool approval prompts. This applies to existing agents after
restart as well as newly created or promoted agents. Ordinary threads retain
their selected permission mode. Bypass does not enable paused agents, remove
run budgets, grant missing OS permissions, or override tool-specific restrictions.

## Persona characters

Creating a Roder queues one persona-matched character through the
installed Codex CLI's managed image-generation route. This uses native Codex
sign-in (`codex login` or the Codex app), not Roder's separate inference OAuth
store. Image generation runs independently of proactive work and does not
enable the Roder. The UI reports queued, generating, ready,
sign-in-required, or failed state without blocking agent creation.

Codex chooses the image model. Its public interface does not report a verified
model version, so saved Codex assets record `model: null` and the UI identifies
them as Codex-managed rather than claiming GPT Image 2.5. No API-key generation
is attempted automatically. The separately billed **Generate with OpenAI API**
action explicitly requests GPT Image 2.5 Flare using an API key stored with OS
encryption; saving a key neither restarts the engine nor generates an image.

Only one character job runs at a time. Failed or interrupted jobs require an
explicit retry, including after desktop restart. A previous good character
stays visible during a retry or failure. Generated PNGs must contain a visible
character and actual transparency before normalization to 256 × 256; a generic
icon is a fallback, never a generated character.

The budget bounds run starts and wall-clock time, not dollars or exact token
usage. Manual compaction can itself call a model; it is an explicit user action
outside the proactive run allowance. Engine tools and native model context
limits remain authoritative. There is no billing integration or hard financial
cap in this MVP.

## Project coordination

The Roder uses an original Roder coordination strategy, not a copied private
prompt. It owns the project outcome, writes self-contained worker briefs with
explicit write ownership and acceptance evidence, and runs independent work in
parallel only when the actual advertised engine tools support it. The released
`task` and optional `agent_swarm` tools dispatch configured roles; the strategy
requires their exact advertised role IDs and schemas rather than inventing
roles or APIs. An advertised `spawn_agent` can handle generic workers. If tools
aren't available, the Roder works serially and reports that limitation.

Local workers may share the worktree. Disjoint writes or read-only research
can run together; shared files, dependency changes, generated output, and git
operations must have one owner or be sequenced. The Roder inspects worker
diffs and test evidence, runs integration checks, records decisions/blockers,
and reports unverified behavior honestly. It must not commit, push, merge, or
discard unrelated work without explicit user authorization. These instructions
guide actual engine behavior; they are not a new OS sandbox or isolation layer.

An existing project thread can be promoted without starting a second thread.
Promotion requires an idle persisted thread in the selected workspace with the
Roder's native host tools already present in `thread.externalTools`. Legacy
threads without these tool definitions are rejected with an explanation; the
released engine has no update-tools RPC, so the desktop cannot silently add
them to an old thread. The existing thread and its history remain unchanged.
Repeated promotion of the same registered thread returns the existing Roder
without resetting its files or enabling proactive work. Explicit model choices
are applied through native `model/select` and saved with the Roder.

## Roder files

Each Roder has five reserved files, modelled on Zuse Zapper files. New Roders
start with every file at version 1: `INSTRUCTIONS.md` holds the mission given
at creation and the others are empty.

| File              | Written by                              | Reaches                                        |
| ----------------- | --------------------------------------- | ---------------------------------------------- |
| `INSTRUCTIONS.md` | The user                                | Every Roder turn, whole                        |
| `AGENTS.md`       | The user only; Roder writes are refused | Every Roder turn, first 16 KiB, when not empty |
| `NOTES.md`        | The Roder and the user                  | Every Roder turn, first 8 KiB                  |
| `WORKERS.md`      | The user                                | Nobody yet; worker prompts come later          |
| `DIGEST.md`       | The user                                | Nobody's prompt; the user reads it             |

Every write is a new version. A write names the version it read as
`expectedVersion`; a stale one is refused with an error that names the current
version (`Roder file version conflict on NOTES.md: expected 1, current version
is 2. ...`). Restore copies an old version's content into a new version, so
history only grows. A version holds at most 1 MiB of UTF-8. When `AGENTS.md`
or `NOTES.md` is longer than its prompt cap, the turn gets the first bytes,
cut on a character boundary, then a line saying how many bytes were left out
and that `roder_files` reads the rest.

The opening paragraph of `INSTRUCTIONS.md` becomes the Roder's one-line
`mission` shown in lists. The Roders page and the agent settings panel show
the file list, an editor, and each file's history with view and restore. A
save from a stale editor is refused and keeps the draft.

Roders saved before files existed get empty files on first use. Their old
`<roder-id>.md` memory and mission are not migrated; the memory file is left on
disk untouched.

## Persistence and recovery

The host chooses a private application-data directory. It contains
`roders.json` (versioned records, enabled state, rolling budget ledger,
pending wakes, and active leases) and `files/<roder-id>/`: `index.json` lists
every version of every file and `<FILE>/<version>.md` holds each version's
content. Writes use a same-directory temporary file followed by rename; a file
version's content is written before the index that names it. State files are
created with mode 0600 and directories with mode 0700. Only one service
instance may own a directory. This is local plaintext, not encrypted secret
storage; never put credentials in Roder files. A corrupt file index fails
closed and is not replaced.

Startup validates every persisted record before allowing autonomous work.
Corrupt or unknown-version state fails closed and is not replaced. An active
lease is reconciled through `thread/read`; no second run starts while that
thread remains busy. Overdue active work is interrupted and paused. If a
`turn/start` response is lost, the run allowance and consumed wakes stay
reserved, the Roder pauses, and the existing thread is inspected rather than
blindly retried. A missing thread is an error, never permission to discard its
history or create another thread.

The desktop app and its engine must be running for wakes to execute. No OS
daemon, cloud worker, or closed-app scheduler is installed. Persisted due wakes
are picked up after restart; missed recurring intervals coalesce into one
check-in rather than a backlog. Event subscriptions observe forwarded engine
notifications while the app is running. Events already persisted as wakes
survive restart, but events emitted while the desktop is closed are not replayed.

## Host integration

```ts
import { createRoderAgentService, roderAgentToolDefinitions } from "./roder-agents/service";

const roderAgents = createRoderAgentService({
  directory: privateRoderAgentDirectory,
  request: engineRequest,
  notify: notifyRoderAgentViews,
});
await roderAgents.start();
```

Route requests with a `desktop/roders/` prefix to
`roderAgents.handleRequest(method, params)`. Forward engine notifications with
`roderAgents.onNotification(method, params)`. Await `roderAgents.stop()` before stopping
the engine. For ordinary composer `turn/start` requests, merge
`await roderAgents.contextForThread(threadId)` into `developerContext` unless the
caller already supplied the Roder context. This unlocked accessor returns
`null` for unrelated threads and rereads the Roder's files on every call;
it does not call the engine or take the service mutation lock, so it is safe to
invoke from the injected engine request path. Scheduled Roder turns already
include this context and native recall, and should not receive it twice.
The injected request function must make real engine requests and
register the exported native ToolSpec descriptors as `externalTools` when
creating Roder threads. The host resolves `thread/toolExecutionRequested`
through `tools/resolve`, invoking
`roderAgents.handleTool(name, arguments, { threadId })` with the authenticated
requesting thread ID, never a model-supplied identity. Resolve the engine tool
call with a proper tool result/error envelope. These are real harness tools,
not a renderer-only tools listing. Existing persisted Roder threads also
need the same host tool dispatcher available after restart.

Requests:

| Suffix          | Parameters                                                                                 | Result                             |
| --------------- | ------------------------------------------------------------------------------------------ | ---------------------------------- |
| `list`          | `{}`                                                                                       | `{ roders: RoderAgent[] }`         |
| `create`        | `{ name, mission, workspaceId, modelProvider?, model?, reasoning? }`                       | `RoderAgentDetail`                 |
| `promote`       | `{ threadId, name, mission, workspaceId, modelProvider?, model?, reasoning? }`             | `RoderAgentDetail`                 |
| `read`          | `{ id }`                                                                                   | `RoderAgentDetail`                 |
| `update`        | `{ id, name?, enabled?, intervalMinutes?, eventMethods?, maxRunsPerDay?, maxRunMinutes? }` | `RoderAgentDetail`                 |
| `files/list`    | `{ id }`                                                                                   | `{ files: RoderFileVersion[] }`    |
| `files/read`    | `{ id, path, version? }`                                                                   | `RoderFile`                        |
| `files/history` | `{ id, path }` (newest first)                                                              | `{ versions: RoderFileVersion[] }` |
| `files/write`   | `{ id, path, content, expectedVersion }`                                                   | `RoderFileVersion`                 |
| `files/restore` | `{ id, path, version, expectedVersion }`                                                   | `RoderFileVersion`                 |
| `schedule`      | `{ id, at, reason }` (`at` is Unix milliseconds)                                           | `RoderAgentDetail`                 |
| `cancelWake`    | `{ id, wakeId }`                                                                           | `RoderAgentDetail`                 |
| `run`           | `{ id, reason? }`                                                                          | `RoderAgentDetail`                 |
| `compact`       | `{ id }`                                                                                   | Native `thread/compact` result     |

`start`, `tick`, `stop`, request handlers, and notification handlers return
promises. The service serializes state mutations, persists only changed state,
and ignores irrelevant streaming notifications. At most 50 pending wakes,
20 event methods, 100 runs per rolling day, and 60 minutes per run are allowed.
These hard ceilings cannot be increased through agent tools.

Agent tools are `roder_files`, `roder_memory_read`, `roder_memory_write`,
`roder_memory_save`, `roder_memory_query`, and `roder_wake_schedule`.
`roder_files` lists the files with no `path`, reads one file (or `version`)
with `path`, and lists its versions with `path` and `history: true`.
`roder_memory_read` and `roder_memory_write` read and write `NOTES.md`;
`roder_memory_write` takes `{ memory, expectedVersion }`. The last three use
native `memory/save`, `memory/query`, and the durable wake queue
respectively. All tools resolve ownership from the caller's thread.
Agents cannot create or enable Roders, change controls, or access another
Roder's files through this API. User approval through the desktop controls
is the only way to enable proactive behavior. This API boundary is not an OS
sandbox against a local process that already has filesystem access.

Native engine integration uses `thread/start`, `thread/read`, `turn/start`
with `developerContext`, `turn/interrupt`, `thread/compact`, `memory/query`,
and `memory/save`. The released protocol's Rust `MemoryScope` uses externally
tagged serialization, e.g. `{ "Thread": "thread-id" }`; older examples in
`docs/api.md` use a different shape. Native memory requires a registered store;
if unavailable, the UI records the recall error and the Roder still has its
files and original engine thread. Explicit memory tools surface
native errors instead of pretending retrieval succeeded. Automatic compaction
remains owned by the engine; the UI exposes a native manual compaction action
on an idle thread and never deletes or slices thread messages itself.

The renderer exports `RoderAgentsPage` and uses the existing generic desktop
request bridge. Routing and navigation are host-owned. Verify the page in the
running Electron app, not a plain browser against the Vite renderer.

# Durable proactive Persistent Agents (PAs)

The desktop, source modules, and API use Persistent Agents throughout:
`persistent_agent_*` native tools, `desktop/persistent-agents/*` methods, and
the `/persistent-agents` management route. The private application-data directory
is `persistent-agents`. This feature has not shipped; it introduces no legacy API
aliases or data migration layer. Existing engine threads are never rewritten.

A persistent agent owns one real, persisted Roder thread. It keeps that thread across
check-ins and desktop restarts; it never starts a replacement thread to hide
context limits. Its mission and concise, user-editable memory accompany each
new turn. Roder's native memory search retrieves additional facts, and its
native compaction summarizes the working transcript when necessary. This is
durable context, not infinite model context.

## Using a persistent agent

1. Open Persistent Agents, choose an existing project workspace, and create a persistent agent.
   The New project persistent agent dialog lets you choose a model and supported reasoning
   effort from the engine's model catalog, or keep the engine default.
   Creation makes a real thread without starting a proactive conversation turn.
   New persistent agents are paused; their separate character-generation job
   uses Codex quota immediately.
2. Edit the mission and memory. Set a daily run allowance and run time limit.
   The defaults are five runs per rolling 24 hours and ten minutes per run.
3. Choose a check-in interval, schedule a specific wake, or subscribe to engine
   event methods such as `turn/completed`. A zero interval means no recurring
   check-in. Events from the persistent agent's own thread are ignored; repeated events
   coalesce into one pending wake per method.
4. Explicitly choose **Enable proactive work**. Pending wakes and intervals do
   nothing while paused. **Run once** is a separate explicit manual action,
   available while paused, and consumes the same run allowance.

**Pause and interrupt** persists the paused state and requests interruption of
an active run. The service retains the active lease until the engine confirms
completion or an idle thread, so an interrupt request cannot cause overlap.
Run time enforcement checks every 15 seconds and also requests interruption;
it is not an instantaneous process kill. Approval and user-input waits remain
subject to the same run time limit. The engine's normal safety policy remains
in effect; the persistent agent does not bypass approvals.

## Persona characters

Creating a persistent agent queues one persona-matched character through the
installed Codex CLI's managed image-generation route. This uses native Codex
sign-in (`codex login` or the Codex app), not Roder's separate inference OAuth
store. Image generation runs independently of proactive work and does not
enable the persistent agent. The UI reports queued, generating, ready,
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

The persistent agent uses an original Roder coordination strategy, not a copied private
prompt. It owns the project outcome, writes self-contained worker briefs with
explicit write ownership and acceptance evidence, and runs independent work in
parallel only when the actual advertised engine tools support it. The released
`task` and optional `agent_swarm` tools dispatch configured roles; the strategy
requires their exact advertised role IDs and schemas rather than inventing
roles or APIs. An advertised `spawn_agent` can handle generic workers. If tools
aren't available, the persistent agent works serially and reports that limitation.

Local workers may share the worktree. Disjoint writes or read-only research
can run together; shared files, dependency changes, generated output, and git
operations must have one owner or be sequenced. The persistent agent inspects worker
diffs and test evidence, runs integration checks, records decisions/blockers,
and reports unverified behavior honestly. It must not commit, push, merge, or
discard unrelated work without explicit user authorization. These instructions
guide actual engine behavior; they are not a new OS sandbox or isolation layer.

An existing project thread can be promoted without starting a second thread.
Promotion requires an idle persisted thread in the selected workspace with the
persistent agent's native host tools already present in `thread.externalTools`. Legacy
threads without these tool definitions are rejected with an explanation; the
released engine has no update-tools RPC, so the desktop cannot silently add
them to an old thread. The existing thread and its history remain unchanged.
Repeated promotion of the same registered thread returns the existing persistent agent
without resetting memory or enabling proactive work. Explicit model choices
are applied through native `model/select` and saved with the persistent agent.

## Persistence and recovery

The host chooses a private application-data directory. It contains
`persistent-agents.json` (versioned records, enabled state, rolling budget ledger,
pending wakes, and active leases) and `<persistent-agent-id>.md` memory files. Writes
use a same-directory temporary file followed by rename. State files are created
with mode 0600 and the directory with mode 0700. Only one service instance may
own a directory. This is local plaintext, not encrypted secret storage; never
put credentials in persistent agent memory.

Memory can be edited in the UI or directly on disk. Every run rereads it. The
memory file is bounded to 32,000 characters and is never silently truncated;
put additional retrievable facts in native memory. UI saves check the previous
memory value so an agent or external editor's concurrent update isn't silently
overwritten. Reopen the persistent agent after a conflict to review the latest text.

Startup validates every persisted record before allowing autonomous work.
Corrupt or unknown-version state fails closed and is not replaced. An active
lease is reconciled through `thread/read`; no second run starts while that
thread remains busy. Overdue active work is interrupted and paused. If a
`turn/start` response is lost, the run allowance and consumed wakes stay
reserved, the persistent agent pauses, and the existing thread is inspected rather than
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
import { createPersistentAgentService, persistentAgentToolDefinitions } from "./persistent-agents/service";

const persistentAgents = createPersistentAgentService({
  directory: privatePersistentAgentDirectory,
  request: engineRequest,
  notify: notifyPersistentAgentViews,
});
await persistentAgents.start();
```

Route requests with a `desktop/persistent-agents/` prefix to
`persistentAgents.handleRequest(method, params)`. Forward engine notifications with
`persistentAgents.onNotification(method, params)`. Await `persistentAgents.stop()` before stopping
the engine. For ordinary composer `turn/start` requests, merge
`await persistentAgents.contextForThread(threadId)` into `developerContext` unless the
caller already supplied the persistent agent context. This unlocked accessor returns
`null` for unrelated threads and rereads the bounded memory file on every call;
it does not call the engine or take the service mutation lock, so it is safe to
invoke from the injected engine request path. Scheduled persistent agent turns already
include this context and native recall, and should not receive it twice.
The injected request function must make real engine requests and
register the exported native ToolSpec descriptors as `externalTools` when
creating persistent agent threads. The host resolves `thread/toolExecutionRequested`
through `tools/resolve`, invoking
`persistentAgents.handleTool(name, arguments, { threadId })` with the authenticated
requesting thread ID, never a model-supplied identity. Resolve the engine tool
call with a proper tool result/error envelope. These are real harness tools,
not a renderer-only tools listing. Existing persisted persistent agent threads also
need the same host tool dispatcher available after restart.

Requests:

| Suffix       | Parameters                                                                                                                     | Result                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `list`       | `{}`                                                                                                                           | `{ persistentAgents: PersistentAgent[] }` |
| `create`     | `{ name, mission, workspaceId, modelProvider?, model?, reasoning? }`                                                           | `PersistentAgentDetail`                   |
| `promote`    | `{ threadId, name, mission, workspaceId, modelProvider?, model?, reasoning? }`                                                 | `PersistentAgentDetail`                   |
| `read`       | `{ id }`                                                                                                                       | `PersistentAgentDetail`                   |
| `update`     | `{ id, name?, mission?, memory?, expectedMemory?, enabled?, intervalMinutes?, eventMethods?, maxRunsPerDay?, maxRunMinutes? }` | `PersistentAgentDetail`                   |
| `schedule`   | `{ id, at, reason }` (`at` is Unix milliseconds)                                                                               | `PersistentAgentDetail`                   |
| `cancelWake` | `{ id, wakeId }`                                                                                                               | `PersistentAgentDetail`                   |
| `run`        | `{ id, reason? }`                                                                                                              | `PersistentAgentDetail`                   |
| `compact`    | `{ id }`                                                                                                                       | Native `thread/compact` result            |

`start`, `tick`, `stop`, request handlers, and notification handlers return
promises. The service serializes state mutations, persists only changed state,
and ignores irrelevant streaming notifications. At most 50 pending wakes,
20 event methods, 100 runs per rolling day, and 60 minutes per run are allowed.
These hard ceilings cannot be increased through agent tools.

Agent tools are `persistent_agent_memory_read`, `persistent_agent_memory_write`,
`persistent_agent_memory_save`, `persistent_agent_memory_query`, and `persistent_agent_wake_schedule`.
The last three use native `memory/save`, `memory/query`, and the durable wake
queue respectively. All tools resolve ownership from the caller's thread.
Agents cannot create or enable persistent agents, change controls, or access another
persistent agent's memory through this API. User approval through the desktop controls
is the only way to enable proactive behavior. This API boundary is not an OS
sandbox against a local process that already has filesystem access.

Native engine integration uses `thread/start`, `thread/read`, `turn/start`
with `developerContext`, `turn/interrupt`, `thread/compact`, `memory/query`,
and `memory/save`. The released protocol's Rust `MemoryScope` uses externally
tagged serialization, e.g. `{ "Thread": "thread-id" }`; older examples in
`docs/api.md` use a different shape. Native memory requires a registered store;
if unavailable, the UI records the recall error and the persistent agent still has its
local memory file and original engine thread. Explicit memory tools surface
native errors instead of pretending retrieval succeeded. Automatic compaction
remains owned by the engine; the UI exposes a native manual compaction action
on an idle thread and never deletes or slices thread messages itself.

The renderer exports `PersistentAgentsPage` and uses the existing generic desktop
request bridge. Routing and navigation are host-owned. Verify the page in the
running Electron app, not a plain browser against the Vite renderer.

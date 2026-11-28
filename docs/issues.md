# Local projects and issues

The Issues page and Roder agent tools use the same local JSON database. There is
no GitHub or Linear synchronization, hosted account, or background network service.

Create a project from **Issues → New project**, optionally linking an existing
Roder workspace. Create an issue, then open its editor to change its title,
description, project, status, priority, owner, done criteria, out of scope and
parent issue. A saved issue's editor also lists its linked threads, pull
requests and activity, and takes a comment. Filters cover project, status,
assignment (a thread owns the issue, or not), and text. Selecting a project exposes **Edit project**, including
archiving. Archived projects keep their issue history but cannot create new
issues or launch work.

Issues are grouped by status with counts. Done and Cancelled start collapsed;
the status headers toggle each group's rows. Active filters reveal every matching
row, including completed and cancelled issues. Clear the filters to restore the
saved group expansion choices.

When a workspace has a project Roder, selecting that project exposes
**Open project Roder**. The Roder link uses the same persistent thread as
the workspace's Roder; it does not create a second agent.

## Issue model

Statuses, in board order: `backlog`, `todo`, `in_progress`, `needs_you`,
`blocked`, `in_review`, `done`, and `cancelled`. Each has its own group on the
Issues page.

| Field          | Meaning                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------- |
| `owner`        | Exactly one: `{type: "roder"}`, `{type: "user"}`, or `{type: "thread", threadId}`. Default Roder. |
| `priority`     | `urgent`, `high`, `normal` (default), or `low`.                                                   |
| `doneCriteria` | What must be true for the issue to be done.                                                       |
| `outOfScope`   | What the issue deliberately leaves alone.                                                         |
| `parent`       | ID of another issue in the same project that this one is part of, or `null`. No cycles.           |
| `threadIds`    | Threads that worked on the issue, oldest first. A thread owner is always linked.                  |
| `pullRequests` | `{url, title}` entries. URLs must be `https://github.com/<owner>/<repo>/pull/<n>`.                |
| `activity`     | Entries for creation, status and owner changes, comments, questions, linked PRs, launch, close.   |

`roder` means the project's Roder; in a project without one it means nobody in
particular. The owner and status stay in step for every actor: a user owner on
an open issue makes it `needs_you`, and an issue that leaves the user goes to
`in_progress` if a thread is linked, else `todo`. Activity entries carry an
`actor` in the owner shape; an agent whose thread is the project's
`roderThreadId` is recorded as `roder`.

Owning is a link, not a scheduler: changing issue status does not stop a
thread, and thread completion does not close the issue.

Save an issue, reopen it, and choose **Save & launch work** to start a thread in
the project's linked workspace. Work cannot launch without that workspace. The
new thread becomes the owner and is linked, and the issue moves to
`in_progress`. An issue a thread already owns opens that thread instead of
launching a duplicate; set the owner to the Roder or yourself if a new thread is
needed. A launch failure leaves the issue unchanged so it can be retried. Saving
edits happens before launching, so those edits remain saved even if launching
fails.

## Actors and the lifecycle

Every change takes an actor: `{type: "user"}` for the person using the app, or
`{type: "agent", threadId}` for an agent's tool call. Reads take none. The rules
below, ported from Zuse Zappers, apply to agents only; the user can make any
change.

- Create: only in `backlog` or `todo`; `todo` needs `doneCriteria`; the owner
  can't be the user.
- Update: `done` and `cancelled` only through `close`; `in_review` needs a
  linked pull request; `in_progress` needs a linked thread, or a child issue in
  progress; `needs_you` and a user owner only through `askUser`; a non-empty
  `doneCriteria` can be edited but not cleared.
- Launch: refused on a closed issue.

Operations for every actor:

- `comment {id, text}` adds a comment. The user's comment on a `needs_you`
  issue answers it: the newest linked thread takes the issue back (status
  `in_progress`), else the Roder (status `todo`).
- `linkPullRequest {id, url, title?}` links a pull request once per URL.
- `askUser {id, question, recommendation?}` makes the user the owner and the
  status `needs_you`, recording the question with the thread that held the
  issue. Refused on a closed issue.
- `close {id, outcome, note}`: `merged` moves the issue to `done` and needs a
  linked pull request; `dropped` moves it to `cancelled`. The note is required.

In the UI, changing only the status into `needs_you` makes you the owner, and
changing it out of `needs_you` hands the issue back the same way a comment does.

## Main-process integration

Import `IssuesService` from `electron/issues/service.ts`. Instantiate exactly one
service per database with `{ storagePath, onEvent, launchIssue }`:

- `storagePath` is the full JSON filename chosen by the application, under its
  user-data directory. Writes use a private temporary sibling and atomic rename.
  All requests through that service instance are serialized, including launch.
  Multiple processes or service instances must not write the same file.
- `onEvent(event)` receives `{ method: "desktop/issues/changed", params: {} }`
  after a successful write. Broadcast it through the usual notification channel
  so an open UI refreshes when an agent writes. Observer exceptions do not undo
  committed changes.
- `launchIssue(issue, project)` must create/start a real Roder thread using
  `project.workspaceId` and its workspace roots, and return `{ threadId }`.
  The service then records assignment and status `in_progress`. It does not
  invent filesystem paths or select a model. A process crash between thread
  creation and storing the link can leave an unlinked thread; reconcile that
  thread manually before retrying.

Forward `desktop/projects/*` and `desktop/issues/*` requests from the renderer
to `service.request(method, params, { type: "user" })`. Params are plain objects.
Agent tool calls go through `handleIssueToolCall`, which always acts as the
calling thread; never forward agent input with the user actor. The UI only uses
`window.roderDesktop.request` and existing notification/workspace/thread state.

| Method suffix     | Project params                                                  | Issue params                                        | Result                        |
| ----------------- | --------------------------------------------------------------- | --------------------------------------------------- | ----------------------------- |
| `list`            | optional `workspaceId`, `archived`                              | optional `projectId`, `status`, `threadId`, `query` | `{ projects }` / `{ issues }` |
| `read`            | `id`                                                            | `id`                                                | `{ project }` / `{ issue }`   |
| `create`          | `name`, optional `description`, `workspaceId`                   | `projectId`, `title`, optional issue fields¹        | `{ project }` / `{ issue }`   |
| `update`          | `id`, optional `name`, `description`, `workspaceId`, `archived` | `id`, optional `projectId`, `title`, issue fields¹  | `{ project }` / `{ issue }`   |
| `delete`          | `id` (must have no issues)                                      | `id` (children lose their `parent`)                 | `{ deleted: true }`           |
| `launch`          | not supported                                                   | `id`                                                | `{ issue, threadId }`         |
| `comment`         | not supported                                                   | `id`, `text`                                        | `{ issue }`                   |
| `linkPullRequest` | not supported                                                   | `id`, `url`, optional `title`                       | `{ issue }`                   |
| `askUser`         | not supported                                                   | `id`, `question`, optional `recommendation`         | `{ issue }`                   |
| `close`           | not supported                                                   | `id`, `outcome` (`merged` \| `dropped`), `note`     | `{ issue }`                   |

¹ `description`, `status`, `priority`, `owner`, `doneCriteria`, `outOfScope`,
`parent`. Threads link through a thread `owner` or `launch`; pull requests and
activity have their own operations. List's `threadId` matches any linked
thread; `null` finds issues no thread has worked on.

After workspace creation or Roder promotion, call
`desktop/projects/ensureWorkspace` with `{workspaceId, name, description?, roderThreadId?}`
to get `{project}` and reuse its tracker project. Registration is serialized and
idempotent across concurrent calls and restarts. It prefers an existing
nonarchived project with that workspace ID, otherwise reuses an archived one
without unarchiving it. Existing project names and descriptions are preserved;
supplied name/description initialize only a new record. Explicitly supplied
`roderThreadId` updates the link; omitting it preserves the link and `null`
clears it. Project `update` also accepts `roderThreadId`.

Project IDs are local stable UUIDs; `workspaceId` references an existing harness
workspace identity rather than an arbitrary path. Issue IDs are stable UUIDs;
display numbers increase globally and are never reused after deletion. Dates
are ISO strings. Clearing a workspace or parent uses explicit `null`.
Malformed or unsupported storage is reported as an error, never reset silently.

The store is schema version 2. Version 1 records are not carried over: a
version 1 `issues.json` is renamed aside to
`issues.json.v1-<timestamp>-<id>.bak` in the same directory, never deleted or
overwritten, and the store starts empty. Workspace projects are registered
again the next time a Roder is created or promoted.

## Agent integration

`electron/issues/tools.ts` exports `issueToolDefinitions`, each with `name`,
`method`, `description`, and JSON `inputSchema`, and
`handleIssueToolCall(service, name, args)`. Register those definitions in the
actual harness tool discovery (native external tools or an MCP bridge), not only
the renderer's `tools/list`. Forward execution to the handler and return its
JSON result to the harness, passing the tool context's `threadId`: every tool
call acts as `{type: "agent", threadId}`. Tool names are `projects_list`,
`projects_read`, `projects_create`, `projects_update`, `projects_delete`,
`issues_list`, `issues_read`, `issues_create`, `issues_update`,
`issues_comment`, `issues_link_pull_request`, `issues_ask_user`, `issues_close`,
`issues_delete`, `issues_launch`. They work for any thread, Roder or not; the
lifecycle rules above apply to all of them. These are app-local tools
available to local trusted agents, not a remote multi-tenant authorization
boundary. A thread takes an issue by setting `owner: {type: "thread", threadId}`;
the service does not implicitly claim issues for a caller.

## Verification

Run `pnpm exec vitest run test/issues-*.test.ts test/desktop-issue-tools-integration.test.ts`
and the project typecheck/lint. Verify the integrated page inside Electron:
create a project linked to a workspace, create/edit an issue with the new
fields, filter it, change its owner, launch work, and reopen the app to confirm
persistence. Ask an agent to list, create, comment on, ask about, and close an
issue and confirm the open UI updates; answer its question with a comment and
check the issue goes back to the thread.
Plain browser previews cannot verify Electron preload integration.

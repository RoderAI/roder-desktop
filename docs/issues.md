# Local projects and issues

The Issues page and Roder agent tools use the same local JSON database. There is
no GitHub or Linear synchronization, hosted account, or background network service.

Create a project from **Issues → New project**, optionally linking an existing
Roder workspace. Create an issue, then open its editor to change its title,
description, project, status, and assigned thread. Filters cover project, status,
assignment, and text. Selecting a project exposes **Edit project**, including
archiving. Archived projects keep their issue history but cannot create new
issues or launch work.

Issues are grouped by status with counts. Done and Cancelled start collapsed;
the status headers toggle each group's rows. Active filters reveal every matching
row, including completed and cancelled issues. Clear the filters to restore the
saved group expansion choices.

When a workspace has a project persistentAgent, selecting that project exposes
**Open project persistentAgent**. The persistentAgent link uses the same persistent thread as
the workspace's persistentAgent; it does not create a second agent.

Statuses are `backlog`, `todo`, `in_progress`, `blocked`, `done`, and `cancelled`.
Assignment is a Roder thread ID, or `null` when unassigned. The UI picker shows
loaded threads in the linked workspace; agents can assign other thread IDs.
Assignment is a link, not a scheduler: changing issue status does not stop a
thread, and thread completion does not automatically close the issue.

Save an issue, reopen it, and choose **Save & launch work** to start a thread in
the project's linked workspace. Work cannot launch without that workspace.
Already-assigned issues open their thread instead of launching a duplicate.
Unassign an issue explicitly if a new thread is needed. A launch failure keeps
the issue unassigned so it can be retried. Saving edits happens before launching,
so those edits remain saved even if launching fails.

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

Forward `desktop/projects/*` and `desktop/issues/*` requests to
`service.request(method, params)`. Params are plain objects. The UI only uses
`window.roderDesktop.request` and existing notification/workspace/thread state.

| Method suffix | Project params                                                  | Issue params                                                             | Result                        |
| ------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------- |
| `list`        | optional `workspaceId`, `archived`                              | optional `projectId`, `status`, `threadId`, `query`                      | `{ projects }` / `{ issues }` |
| `read`        | `id`                                                            | `id`                                                                     | `{ project }` / `{ issue }`   |
| `create`      | `name`, optional `description`, `workspaceId`                   | `projectId`, `title`, optional `description`, `status`, `threadId`       | `{ project }` / `{ issue }`   |
| `update`      | `id`, optional `name`, `description`, `workspaceId`, `archived` | `id`, optional `projectId`, `title`, `description`, `status`, `threadId` | `{ project }` / `{ issue }`   |
| `delete`      | `id` (must have no issues)                                      | `id`                                                                     | `{ deleted: true }`           |
| `launch`      | not supported                                                   | `id`                                                                     | `{ issue, threadId }`         |

After workspace creation or persistentAgent promotion, call
`desktop/projects/ensureWorkspace` with `{workspaceId, name, description?, persistentAgentThreadId?}`
to get `{project}` and reuse its tracker project. Registration is serialized and
idempotent across concurrent calls and restarts. It prefers an existing
nonarchived project with that workspace ID, otherwise reuses an archived one
without unarchiving it. Existing project names and descriptions are preserved;
supplied name/description initialize only a new record. Explicitly supplied
`persistentAgentThreadId` updates the link; omitting it preserves the link and `null`
clears it. Project `update` also accepts `persistentAgentThreadId`. Schema-1 records
without persistentAgent metadata load as `persistentAgentThreadId: null`.

Project IDs are local stable UUIDs; `workspaceId` references an existing harness
workspace identity rather than an arbitrary path. Issue IDs are stable UUIDs;
display numbers increase globally and are never reused after deletion. Dates
are ISO strings. Clearing workspace or assignment uses explicit `null`.
Malformed or unsupported storage is reported as an error, never reset silently.

## Agent integration

`electron/issues/tools.ts` exports `issueToolDefinitions`, each with `name`,
`method`, `description`, and JSON `inputSchema`, and
`handleIssueToolCall(service, name, args)`. Register those definitions in the
actual harness tool discovery (native external tools or an MCP bridge), not only
the renderer's `tools/list`. Forward execution to the handler and return its
JSON result to the harness. Tool names are `projects_list`, `projects_read`,
`projects_create`, `projects_update`, `projects_delete`, `issues_list`,
`issues_read`, `issues_create`, `issues_update`, `issues_delete`, `issues_launch`.
These are app-local tools available to local trusted agents, not a remote
multi-tenant authorization boundary. Caller thread IDs may be supplied by the
integration as `threadId` when creating or updating assignments; the service
does not implicitly claim issues for a caller.

## Verification

Run `pnpm exec vitest run test/issues-service.test.ts test/issues-tools.test.ts`
and the project typecheck/lint. Verify the integrated page inside Electron:
create a project linked to a workspace, create/edit an issue, filter it, assign
or unassign a thread, launch work, and reopen the app to confirm persistence.
Ask an agent to list, create, and close an issue and confirm the open UI updates.
Plain browser previews cannot verify Electron preload integration.

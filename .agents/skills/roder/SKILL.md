---
name: roder
description: Create a Roder (a long-lived Roder Desktop project agent) when the user asks for one or invokes $roder.
---

# Roder

This skill ships with Roder Desktop and works outside this repository. Use it
when the user asks for a Roder, a long-lived project assistant, or
invokes `$roder`.

Use `roder_create` to create a Roder. Ask only for a
missing agent display name or long-lived mission; reuse details already supplied
instead of sending the user to the UI. By default the tool uses the current
thread's workspace; pass `workspaceId` only when the user specifies a
different existing workspace. Omit unused optional fields rather than supplying
empty strings (empty optional strings are treated as omitted). If the user names
a workspace, pass `workspaceName` directly instead of asking for an internal ID.
Do not combine `workspaceId` and `workspaceName`. Use
`roder_workspaces` to list existing workspace names and IDs if needed;
`projects_list` lists issue projects, not workspaces. If names are duplicated, ask
the user to choose from the returned workspaces. Never guess or create a workspace.
Optionally pass both `modelProvider` and
`model` (and `reasoning`) when requested.

New Roders start paused. Do not enable proactive runs, schedule
wakes, or start a run unless explicitly requested. Report the returned agent
ID, workspace ID, thread ID and paused status. Do not claim success before
the tool returns.

A mission spanning multiple repositories does not configure cross-repository
access or monitoring. Explain any access that still needs to be set up.

The desktop must remain running for proactive work. If an older thread does not
advertise the creation tool, ask the user to start a new chat; do not invent a
fallback scheduler or claim the agent was created.

For user-requested Roder configuration, use `$roder-config` with `desktop_config`.
Read the skill through `desktop_config` using method `skills/read` and params
`{"selector":{"name":{"name":"roder-config"}}}`. Inspect current settings, apply
only requested changes, and verify the result. Never pass credentials through
this tool. Enabling executable MCP integrations requires explicit user approval.

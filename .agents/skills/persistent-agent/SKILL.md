---
name: persistent-agent
description: Create a Roder Desktop persistent agent when the user asks for one or invokes $persistent-agent.
---

# Persistent agent

This skill ships with Roder Desktop and works outside this repository. Use it
when the user asks for a persistent agent, a long-lived project assistant, or
invokes `$persistent-agent`.

Use `persistent_agent_create` to create a persistent agent. Ask only for a
missing agent display name or long-lived mission; reuse details already supplied
instead of sending the user to the UI. By default the tool uses the current
thread's workspace; pass `workspaceId` only when the user specifies a
different existing workspace. Optionally pass both `modelProvider` and
`model` (and `reasoning`) when requested.

New persistent agents start paused. Do not enable proactive runs, schedule
wakes, or start a run unless explicitly requested. Report the returned agent
ID, workspace ID, thread ID and paused status. Do not claim success before
the tool returns.

The desktop must remain running for proactive work. If an older thread does not
advertise the creation tool, ask the user to start a new chat; do not invent a
fallback scheduler or claim the agent was created.

For user-requested Roder configuration, use `$roder-config` with `desktop_config`.
Read the skill through `desktop_config` using method `skills/read` and params
`{"selector":{"name":{"name":"roder-config"}}}`. Inspect current settings, apply
only requested changes, and verify the result. Never pass credentials through
this tool. Enabling executable MCP integrations requires explicit user approval.

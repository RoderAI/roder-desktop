---
name: persistent-agent
description: Create a Roder Desktop persistent agent when the user asks for one or invokes $persistent-agent.
---

# Persistent agent

Use `persistent_agent_create` to create a persistent agent. Get the user's
name and long-lived mission first. By default the tool uses the current
thread's workspace; pass `workspaceId` only when the user specifies a
different existing workspace. Optionally pass both `modelProvider` and
`model` (and `reasoning`) when requested.

New persistent agents start paused. Do not enable proactive runs, schedule
wakes, or start a run unless explicitly requested. Report the returned agent
ID, workspace ID, thread ID and paused status. Do not claim success before
the tool returns.

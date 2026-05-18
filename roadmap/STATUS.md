# Roadmap Status

Last updated: **2026-05-18**

This file indexes PRD roadmap plans for `gode-desktop`. Individual PRDs remain the source of truth for detailed tasks, acceptance criteria, implementation stage, and evidence.

## Status Legend

- `Draft`: requirements or approach are still being shaped.
- `Ready`: the PRD is ready for implementation.
- `In progress`: implementation has started.
- `Blocked`: progress is waiting on a decision, dependency, or external condition.
- `Verifying`: code is present and acceptance is being checked.
- `Complete`: acceptance and verification are satisfied.
- `Superseded`: retained for history but replaced by another plan.

## Active PRDs

| ID | PRD | Status | Current Stage | Updated | Verification | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| 001 | [Desktop Custom User Extensions](001-desktop-custom-user-extensions.md) | In progress | 4 - Backend Tool Proxy Integration | 2026-05-18 | Example extension smoke passed; desktop `tools/list`/`tools/call` proxy tests, `pnpm test`, `pnpm typecheck`, and `pnpm build` passed | Implement Rust app-server reverse-RPC bridge, safe mode, and packaging |

## Completed PRDs

| ID | PRD | Completed | Evidence |
| --- | --- | --- | --- |

## Superseded PRDs

| ID | PRD | Replaced By | Reason |
| --- | --- | --- | --- |

## Update Rules

- Add each new PRD to `Active PRDs`.
- Keep status and current stage synchronized with the PRD header.
- Move completed work to `Completed PRDs` only after evidence is recorded in the PRD.
- Keep superseded plans linked instead of deleting them.

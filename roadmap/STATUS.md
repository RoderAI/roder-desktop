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
| 001 | [Desktop Custom User Extensions](001-desktop-custom-user-extensions.md) | In progress | 5 - Webview Panels And Desktop UI Contributions | 2026-05-18 | Compact Extensions sidebar and composer theming passed `pnpm typecheck`, `pnpm test`, and `pnpm build` | Add richer bidirectional panel APIs, safe mode, docs, and Rust app-server reverse-RPC bridge |

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

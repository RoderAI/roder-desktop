# Roadmap Status

Last updated: **2026-05-19**

This file indexes PRD roadmap plans for `roder-desktop`. Individual PRDs remain the source of truth for detailed tasks, acceptance criteria, implementation stage, and evidence.

## Status Legend

- `Draft`: requirements or approach are still being shaped.
- `Ready`: the PRD is ready for implementation.
- `In progress`: implementation has started.
- `Blocked`: progress is waiting on a decision, dependency, or external condition.
- `Verifying`: code is present and acceptance is being checked.
- `Complete`: acceptance and verification are satisfied.
- `Superseded`: retained for history but replaced by another plan.

## Active PRDs

| ID  | PRD                                                                     | Status      | Current Stage                                       | Updated    | Verification                                                                                       | Next Action                                                                                                 |
| --- | ----------------------------------------------------------------------- | ----------- | --------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 001 | [Desktop Custom User Extensions](001-desktop-custom-user-extensions.md) | In progress | 6 - Developer Tooling, Packaging, And Documentation | 2026-05-18 | Sidebar cleanup and theme label persistence passed `pnpm typecheck`, `pnpm test`, and `pnpm build` | Add richer bidirectional panel APIs, safe mode, signed-package docs, and Rust app-server reverse-RPC bridge |

## Completed PRDs

| ID  | PRD                                                               | Completed  | Evidence                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 002 | [Desktop Plugins Marketplace](002-desktop-plugins-marketplace.md) | 2026-05-19 | Plugins main view no longer mounts the app title top bar; inactive default marketplaces expose `Enable`; plugin rows expose `Source` links; `pnpm test`, `pnpm typecheck`, `git diff --check`, `pnpm build`, and shimmed roadmap validation passed |

## Superseded PRDs

| ID  | PRD | Replaced By | Reason |
| --- | --- | ----------- | ------ |

## Update Rules

- Add each new PRD to `Active PRDs`.
- Keep status and current stage synchronized with the PRD header.
- Move completed work to `Completed PRDs` only after evidence is recorded in the PRD.
- Keep superseded plans linked instead of deleting them.

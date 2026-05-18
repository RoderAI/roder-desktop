# Agent Guidance

## Project References

- The Roder app-server API contract is documented in `docs/api.md`.

## TDD

Use TDD when the change affects behavior that can be proven with a meaningful
automated test. A good TDD test exercises the real public surface and would fail
for the bug or missing behavior the user cares about.

Good fits:

- Data transformations, protocol payloads, state transitions, and command logic.
- Bug fixes where a regression test can reproduce the failure.
- Shared utilities or business rules with clear inputs and outputs.
- UI behavior with observable interactions, accessibility state, or DOM changes
  that matter to users.

Poor fits:

- Pure copy, documentation, or comment changes.
- Mechanical cleanup, import removal, or dead-code deletion.
- Small visual chrome changes where a source-string test would only assert the
  current implementation shape.
- Configuration or build metadata changes unless they have a natural contract
  test.

Do not add brittle tests just to satisfy process. In particular, avoid tests that
only scan source text for JSX strings, class names, or file structure unless the
file text itself is the contract being maintained.

When TDD is not a good fit, say so briefly and verify the change another way:
run typecheck, the relevant test suite, build, lint, or a visual/browser check
that matches the risk of the change.

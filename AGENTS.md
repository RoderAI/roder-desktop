# Agent Guidance

## Project References

- The Roder app-server API contract is documented in `docs/api.md`.
- To access the backend code, run `cd ../gode` from this directory.
- Product UI principles and current desktop design decisions are documented in
  `docs/design.md`.

## Dependency Security

Never bypass, disable, or weaken package-manager supply-chain protections such
as pnpm's `minimumReleaseAge`. Do not use override flags or config such as
`--config.minimumReleaseAge=0`, do not add package exceptions to get around the
policy, and do not otherwise force installation of dependencies that the policy
blocks. If a dependency is too new, choose a version that satisfies the policy or
wait for the configured release-age window to pass.

## Project Terminology

When the user says "thread", "last thread", "session", "conversation", or asks
about something getting stuck, assume they are talking about the Roder/Gode app
model and UI in this repository unless they explicitly say "Codex", "Codex
thread", "Codex session", or refer to files under `~/.codex`.

Do not inspect Codex's own local state, logs, sessions, or skill cache for those
requests by default. Start from this app's code, data flow, and documented
backend contract instead.

## UI Styling

Use Base UI for headless primitives and local shadcn-style wrappers. Do not add
or use Radix UI primitives in this project.

Prefer Tailwind's standard spacing scale for margins, padding, gaps, sizing,
positioning, and layout measurements. Avoid arbitrary values such as `px-[13px]`,
`gap-[18px]`, `w-[347px]`, or `z-[80]` unless the value is tied to a real
external constraint, asset size, or one-off integration requirement.

When a design appears to need a custom value, first choose the nearest Tailwind
scale token and adjust the surrounding layout to fit the system. If an arbitrary
value is still necessary, keep it local, document the reason when it is not
obvious, and avoid spreading similar one-off values across multiple components.

When working on UI that changes state visually, such as showing, hiding,
expanding, collapsing, or otherwise changing visibility, use the web animation
/ Interface Craft skills to design and implement the motion. Keep animations
short, purposeful, and consistent with `docs/design.md`.

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

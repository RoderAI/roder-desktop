# Agent Guidance

## Project References

- The Roder app-server API contract is documented in `docs/api.md`.
- The Roder agent harness is consumed as a published crate from crates.io. The
  embedded version is pinned in `roder-distro-config.toml` and built via the
  `roder-desktop-distro` crate into `resources/bin/roder`. See
  `.agents/skills/roder-distro/SKILL.md` for the update/upgrade/build workflow.
- The upstream Roder source lives at `~/w/roder` for reference only; the desktop
  build never compiles from it. (The backend was historically referenced as
  `../gode`; that name is retired.)
- Product UI defaults and current desktop design decisions are documented in
  `docs/design.md`. Reference it before making product UI changes, especially
  when choosing typography, font weight, surfaces, hover states, radius, spacing,
  borders/rings, or component interaction patterns.

## Dependency Security

Use pnpm's default `minimumReleaseAge` of 1 day for dependency installs in this
project. Do not bypass or disable package-manager supply-chain protections with
override flags or config such as `--config.minimumReleaseAge=0`, do not add
package exceptions to get around the policy, and do not otherwise force
installation of dependencies that the policy blocks. If a dependency is too new,
choose a version that satisfies the policy or wait for the configured
release-age window to pass.

## Project Terminology

When the user says "thread", "last thread", "session", "conversation", or asks
about something getting stuck, assume they are talking about the Roder app
model and UI in this repository unless they explicitly say "Codex", "Codex
thread", "Codex session", or refer to files under `~/.codex`.

Do not inspect Codex's own local state, logs, sessions, or skill cache for those
requests by default. Start from this app's code, data flow, and documented
backend contract instead.

## UI Styling

Before changing product UI, read `docs/design.md` and follow its defaults unless
nearby code establishes a more specific local pattern.

Do not add or use Radix UI primitives in this project. Use Base UI and the local
shadcn-style wrappers described in `docs/design.md`.

For desktop UI visual verification, do not rely on the in-app browser or other
plain browser automation against the Vite renderer URL. The renderer depends on
Electron preload APIs and may appear blank or misleading outside the desktop
shell. Ask the user to test UI changes in the running desktop app instead.

## React Compiler

This project uses React Compiler. Do not add `useMemo`, `useCallback`, or
`React.memo` by default for render optimization; prefer plain values and
functions and let the compiler handle memoization.

Manual memoization is still appropriate when it expresses real semantics rather
than routine render tuning, such as preserving referential identity for a
third-party API, stabilizing a context value, or caching work that is observable
outside React rendering. When adding manual memoization, make the reason clear in
the surrounding code or review notes.

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

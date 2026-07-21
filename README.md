# Roder Desktop

Local-first Electron app for the [Roder](https://github.com/RoderAI/roder) agent harness.

Alpha software. Expect sharp edges.

![Roder Desktop — new agent](https://roder.sh/product/roder-desktop/desktop-new-agent.png)

Product page: [roder.sh/desktop](https://roder.sh/desktop/)

## Download

Prebuilt installs ship on [GitHub Releases](https://github.com/RoderAI/roder-desktop/releases) for tagged builds:

| Platform | Artifact |
| --- | --- |
| macOS Apple Silicon | `Roder-macos-arm64.dmg` (signed + notarized; also `.zip`) |
| Windows x64 | `Roder-windows-x64-installer.exe` |

Tagged releases may also mirror to [dl.roder.sh](https://dl.roder.sh).

## Features

![Subagents panel](https://roder.sh/product/roder-desktop/desktop-subagents-panel.png)

- **Subagents** — parallel agent orchestration with a live Subagents panel and transcript lifecycle chips
- **Models & providers** — full catalog from the embedded app-server (GPT-5.6 Sol/Terra/Luna, Claude Fable 5/Opus/Sonnet, Grok 4.5, Gemini, Composer, DeepSeek, Kimi, and more across ~15 providers), with reasoning efforts up to Ultra
- **Workspace panels** — Terminal, Browser, Canvas, Design, Review, Extensions, Files, Subagents
- **Composer** — `$` skill completion, `@` MCP server targeting, plan mode, agent swarm mode, voice input, sketch/file attachments
- **Local threads** — persistence on disk; MCP, skills, and extensions

The desktop shell talks to the embedded harness over the app-server JSON-RPC protocol. See [`docs/api.md`](docs/api.md).

## Development

Requires **Node 24**, **pnpm 11**, and a **Rust toolchain** (for the embedded harness build).

```sh
pnpm install
pnpm dev
```

`pnpm dev` builds the pinned `roder` debug binary into `resources/bin/`, then starts Electron Forge + Vite.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Bundle debug harness + launch the app |
| `pnpm typecheck` | TypeScript + workspace package checks |
| `pnpm test` | Vitest |
| `pnpm make` | Typecheck, then build distributables via Electron Forge |
| `pnpm lint` | oxlint |
| `pnpm format` | oxfmt |

Forge packages the app as **Roder** (`sc.roder.desktop`), unpacks `node-pty` from asar, and ships `resources/bin` as an extra resource. Local `pnpm make` can also produce Linux deb/rpm; CI release jobs currently publish macOS arm64 and Windows x64.

## Embedded harness

Desktop never compiles Roder from a sibling `~/w/roder` checkout. It embeds a **pinned crates.io release** of the `roder` crate (currently **0.1.14**).

```
roder-distro-config.toml          # pin ([roder].version)
        │
roder-desktop-distro/             # Cargo workspace wrapping roder::run_distribution
        │  cargo build
        ▼
resources/bin/roder               # spawned as app-server over stdio
```

| Goal | Command |
| --- | --- |
| Compare pin vs crates.io latest | `pnpm roder:distro:check` |
| Bump / change pin | `pnpm roder:distro:update <version>` |
| Release binary into `resources/bin` | `pnpm roder:distro:release` |

Details: [`.agents/skills/roder-distro/SKILL.md`](.agents/skills/roder-distro/SKILL.md). Upstream harness: [RoderAI/roder](https://github.com/RoderAI/roder).

## Releasing

Push a tag matching `v*` or `desktop/v*`. GitHub Actions builds:

1. **macOS** — signed + notarized `Roder-macos-arm64.dmg` / `.zip`
2. **Windows** — `Roder-windows-x64-installer.exe`

Artifacts upload to the GitHub release. When R2 credentials are present, the same files also publish to the download mirror.

Manual dispatch of the release workflows is supported for dry runs.

## Links

- Product: https://roder.sh/desktop/
- Releases: https://github.com/RoderAI/roder-desktop/releases
- Upstream harness: https://github.com/RoderAI/roder
- App-server API: [`docs/api.md`](docs/api.md)

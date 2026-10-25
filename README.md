# Roder Desktop

A desktop workbench for coding agents. Open a project, start an agent, and keep the conversation, terminal, browser, files, and code review in one window, scoped to that project.

![Roder Desktop: a new agent in a project](https://dl.roder.sh/desktop/product/desktop-new-agent.png)

> Alpha software. Expect rough edges, and expect things to change between releases.

## Why it exists

Agent work spreads out. The plan lives in a chat window, the code in an editor, the test output in a terminal, and the documentation in a browser tab. Context gets lost between them, and a long run is hard to pick back up.

Roder Desktop keeps those surfaces together. Each thread belongs to a project folder, threads are saved on your machine so you can reopen them, and the panels open beside the conversation instead of in another app.

Roder runs on top of the [Roder agent harness](https://github.com/RoderAI/roder). Your threads, settings, and project state stay on your machine. Model requests go to the providers you connect.

## Features

**Threads in projects.** Pick a project folder, start an agent, and come back to recent threads from the start screen. Each thread keeps its transcript, model, and usage on disk.

**Subagents.** Spawn parallel subagents from one thread. The Subagents panel shows what is running and what has finished, and the transcript marks each subagent's lifecycle inline.

![The Subagents panel next to a thread](https://dl.roder.sh/desktop/product/desktop-subagents-panel.png)

**Models and providers.** Choose from the catalog the local harness reports, set reasoning effort, and pick which models show up in the composer. Connect a provider by signing in (ChatGPT, SuperGrok, or Claude Code through its local CLI) or by pasting an API key.

![The model picker in the composer](https://dl.roder.sh/desktop/product/desktop-model-picker.png)

**Setup that finds what you already have.** First-run setup notices API keys already set in your environment, such as `OPENROUTER_API_KEY`, and the Claude Code CLI on your machine. It marks them as connected and tells you what it found. Keys are never copied into Roder's settings.

**A composer for real work.** Type `$` to complete skills and `@` to target MCP servers. Plan mode and agent swarm mode sit next to the model picker, and voice input, sketches, and file attachments work on any turn.

**Panels beside the chat.** Terminal, Browser, Canvas, Design, Review (changed files), Files, Extensions, and Subagents. They are scoped to the project you opened, so the agent and the evidence stay in one place.

**Settings you can live with.** Appearance includes several built-in themes, including Roder, Plain, and Black. You can also manage providers, models, skills, MCP servers, Git, and usage.

**Plugins.** A plugins marketplace, and an Extensions panel. Support for user-written extensions is in progress.

## Install

**macOS (Apple silicon):** download `Roder-macos-arm64.dmg`, open it, and drag Roder into Applications. Builds are signed and notarized, and updates arrive inside the app.

**Windows (x64):** download `Roder-windows-x64-installer.exe` and run it.

Installers are on [roder.sh/desktop](https://roder.sh/desktop/) and on the [GitHub releases page](https://github.com/RoderAI/roder-desktop/releases). For other platforms, build from source (see [Develop](#develop)).

## First run

1. **Connect a provider.** Sign in with a ChatGPT, SuperGrok, or Claude Code setup you already have, or paste an API key. Each API-key provider links to its key page.
2. **Pick a default model.** New agents start on this model. You can change it at any time.
3. **Add a project.** Choose the folder agents should work in.
4. **Send your first message.** Start the agent and watch it work in the transcript.

## How it fits together

Roder Desktop is an Electron shell around the Roder agent harness. The shell renders the workspace, and it starts the harness as a local process and talks to it over JSON-RPC on stdio. The harness version is pinned in `roder-distro-config.toml` and bundled into the app.

```
Roder Desktop (Electron + React)
        │  JSON-RPC over stdio
        ▼
roder app-server (agent harness)
        │
        ├── threads, transcripts, and usage on disk (~/.roder)
        ├── model providers you connect
        └── tools that run inside the project folder
```

Protocol reference: [`docs/api.md`](docs/api.md). UI conventions: [`docs/design.md`](docs/design.md).

## Develop

You need Node 24 or 25 (the packaging step checks for these), pnpm 11, and a Rust toolchain for the embedded harness build.

```sh
pnpm install
pnpm dev
```

`pnpm dev` builds the pinned `roder` debug binary into `resources/bin/`, then starts Electron Forge with Vite.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Build the debug harness and launch the app |
| `pnpm typecheck` | TypeScript plus workspace package checks |
| `pnpm test` | Vitest |
| `pnpm lint` | oxlint |
| `pnpm format` | oxfmt |
| `pnpm make` | Typecheck, then build distributables with Electron Forge |

Forge packages the app as **Roder** (`sc.roder.desktop`), unpacks `node-pty` from asar, and ships `resources/bin` as an extra resource. Local `pnpm make` can also produce Linux deb and rpm packages, but the release CI currently publishes macOS (Apple silicon) and Windows (x64) only.

### The embedded harness

The desktop never compiles Roder from a sibling checkout. It embeds a pinned crates.io release of the `roder` crate (currently 0.3.2).

| Goal | Command |
| --- | --- |
| Compare the pin with the latest crates.io release | `pnpm roder:distro:check` |
| Change the pinned version | `pnpm roder:distro:update <version>` |
| Build a release binary into `resources/bin` | `pnpm roder:distro:release` |

Details live in [`.agents/skills/roder-distro/SKILL.md`](.agents/skills/roder-distro/SKILL.md). Upstream harness: [RoderAI/roder](https://github.com/RoderAI/roder).

## Releasing

Push a tag that matches `v*` or `desktop/v*`. GitHub Actions builds a signed and notarized macOS DMG and zip, plus a Windows installer, and attaches them to the GitHub release. When R2 credentials are present, the same files also publish to the download mirror. Release workflows can also be run manually for a dry run.

## Links

- Product page: [roder.sh/desktop](https://roder.sh/desktop/)
- Releases: [github.com/RoderAI/roder-desktop/releases](https://github.com/RoderAI/roder-desktop/releases)
- Agent harness: [github.com/RoderAI/roder](https://github.com/RoderAI/roder)
- App-server protocol: [`docs/api.md`](docs/api.md)

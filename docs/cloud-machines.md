# Cloud Machines & Remote Workspaces

Open **Settings > Cloud Machines** to connect a remote runner provider (such as
Blaxel) and save named cloud workspace profiles. Once connected, working in a
remote thread uses the same native desktop panels — **Files**, **`Cmd+P` Quick
Open**, **Terminal**, **Review** (Git diffs), and **Browser** port previews —
directly against the remote workspace.

Cloud machines are currently unavailable on Windows because the embedded
runner validates remote POSIX paths using host path rules. Windows users can
continue using **Local machine** with native Windows tools. Saved cloud profiles
remain visible but cannot be selected or run on Windows.

## Connecting Blaxel

In **Settings > Cloud Machines**, the **Blaxel connection** card supports:

- **Connect from Blaxel CLI**: detects an authenticated `~/.blaxel/config.yaml`
  / `bl` CLI session and imports the active workspace credential into OS
  encrypted storage in one click.
- **Use API key**: paste a Blaxel API key directly (workspace is auto-discovered
  via Blaxel's API or entered manually).

Saving or clearing credentials restarts the embedded `roder app-server`
automatically so the new environment variables take effect immediately without
restarting the desktop app.

With Blaxel connected, you can select an existing Blaxel sandbox from a live
list or create a new sandbox directly from Settings without editing raw JSON.

## Native Remote Workspace Bridge (`remote-roder` Tunnel)

When an active thread is bound to a Blaxel remote runner (or while staging a new
thread with a Blaxel profile selected), Roder Desktop injects the headless
`remote-roder` binary into the sandbox, starts `remote-roder app-server --remote`
on port `17373`, and opens a double-authenticated private Blaxel TLS WebSocket
tunnel (`X-Blaxel-Authorization` + `roder.remote.v1` bearer token) to bridge
native app-server JSON-RPC methods directly to the remote engine:

- **Files & `Cmd+P` Quick Open**: served by the remote `remote-roder` Rust file
  indexer with live `workspace/files/statusChanged` notifications.
- **Review (Branch / Staged / Unstaged)**: served by the remote `remote-roder`
  Git/VCS engine (`vcs/changes/list` and `vcs/changes/read`).
- **Design & Skills**: forwarded directly to the remote `remote-roder` instance.
- **Fallback for musl/Alpine sandboxes**: if an existing sandbox runs Alpine/musl
  where the glibc `remote-roder` artifact cannot execute, Files/Search/Review
  fall back cleanly to Blaxel's sandbox API. New sandboxes created from Settings
  default to Debian glibc (`blaxel/py-app:latest`) so the `remote-roder` tunnel
  runs natively out of the box.
- **Terminal**: opens a persistent interactive ANSI shell over Blaxel's native
  `/terminal/ws` WebSocket endpoint directly inside the remote workspace
  directory (no local `bl` CLI required).
- **Top bar status & Port Preview**: inspect sandbox status and bridge mode,
  wake/pause/resume the runner, or expose a remote port via a Blaxel preview URL
  directly inside Roder's built-in Browser panel.
- **Sidebar grouping**: remote threads group under their remote workspace with a
  cloud indicator, and starting a new agent from that group pre-selects the
  matching remote profile.

## Providers

Desktop discovers providers from the embedded harness's `runners/list` API rather
than maintaining a fixed selectable catalog. The pinned Roder 0.4.14 build
includes Blaxel, Sprites, Docker, unix-local, Cloudflare, Daytona, E2B, Modal,
Runloop, and Vercel.

- **Blaxel** has full native desktop integration (CLI import, sandbox discovery
  and creation, direct remote Files, Search, Review, Terminal, and Preview).
- **Sprites** and gateway providers can store encrypted tokens in Settings and
  bind threads to named remote workspaces.
- **Docker** requires Docker on the app-server host.
- **unix-local** runs on the app-server host, not on a cloud machine.

## Credentials and storage

In **Settings > Cloud Machines**, **Machines** lists saved profiles and hosts the
Add/Edit form. **Connections** contains Blaxel sign-in, SSH discovery, Tailscale,
and runner provider setup.

You can also ask a Desktop agent that has `desktop_config` to save a profile.
For example: “Use `$roder-config` to save my existing Blaxel sandbox `dev-box`
as `Dev`, with `/workspace` as the remote path.” Roder uses the configured
connection, checks that the named Blaxel sandbox exists, and saves the profile
to the same list shown in Settings and the new-thread machine picker. Existing
Sprites can also be added by name. Chat does not provision cloud resources or
accept runner credentials; connect the provider in **Connections** first.

Do not put API keys, tokens, passwords, or credential-bearing URLs in profile
JSON configuration. Roder persists runner configuration with each thread, so
desktop rejects credential-like configuration fields.

Saved credentials are encrypted with Electron `safeStorage` in
`<userData>/cloud-credentials.enc`, and saved machine profiles are encrypted in
`<userData>/cloud-machines.enc`. Both fail closed when OS-backed encryption is
unavailable. Neither raw credentials nor profile configs are stored in renderer
`localStorage` or recorded in diagnostic app-server event logs.

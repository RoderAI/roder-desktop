# Cloud Machines

Open **Settings > Cloud Machines** to add a named execution profile. Choose an
installed runner provider, an absolute workspace path on that runner, and its
non-secret JSON configuration. Provider-specific examples and authentication
environment variables appear below the provider selector.

Cloud machines are currently unavailable on Windows because the embedded
runner validates remote POSIX paths using host path rules. Windows users can
continue using **Local machine** with native Windows tools. Saved cloud profiles
remain visible but cannot be selected or run on Windows.

On a new thread, choose the profile from the execution-machine selector beside
the policy controls. The default is **Local machine**. A thread's native coding
tools use its chosen runner workspace. The binding is fixed when the thread is
created and persists in Roder's thread metadata, including when the thread is
reopened. Changing the new-thread selector does not move existing threads.
Local selections preserve the native host tools, shell, and workspace behavior.
If an upstream global runner destination is configured, local thread creation
fails rather than inheriting that destination. Clear the global runner
configuration and restart the app, or choose a cloud machine. Selecting a
desktop cloud profile does not change the upstream global runner configuration.

The local project remains the thread's desktop workspace context. This feature
does not upload or synchronize a local repository. Prepare the remote directory
and repository before using it. Desktop file, terminal, browser, and host-provided
tools remain desktop-side; this is not a remote desktop connection or a second
app-server connection.

## Providers

Desktop discovers providers from the embedded harness's `runners/list` API rather
than maintaining a fixed selectable catalog. The pinned Roder 0.4.1 build
includes Sprites, Blaxel, Docker, unix-local, Cloudflare, Daytona, E2B, Modal,
Runloop, and Vercel.

- Sprites and Blaxel profiles can name an existing machine or sandbox.
- Docker requires Docker on the app-server host.
- unix-local runs on the app-server host, not on a cloud machine.
- Cloudflare, Daytona, E2B, Modal, Runloop, and Vercel currently use upstream's
  compatible runner-gateway `/sessions` protocol. Their `base_url` must point to
  such a gateway, not the vendor's ordinary API endpoint.
- Upstream does not currently provide an SSH runner. An arbitrary SSH hostname
  cannot be used as a profile.

## Credentials and storage

Supply credentials through the environment inherited by the desktop app's
app-server process. Set the variables listed in the provider help before starting
the app; restart the app after changing them. Credentials are shared per provider
within that process. Desktop does not yet provide per-profile credential entry
or isolated app-server processes.

Do not put API keys, tokens, passwords, or credential-bearing URLs in the JSON
configuration. Roder persists runner configuration with each thread, so desktop
rejects credential-like configuration fields. This validation cannot identify
every possible secret; keep the configuration non-secret.

Saved profiles are encrypted with Electron `safeStorage` in
`<userData>/cloud-machines.enc`. Storage fails closed when OS-backed encryption is
unavailable. The renderer persists only the selected profile ID, not profile
configuration. Invalid or deleted selections fail rather than silently executing
the prompt locally. Removing a profile does not stop or delete cloud resources
or change existing threads.

Adding a profile checks configuration shape and provider availability. It does
not provision infrastructure or verify cloud credentials. The harness validates
the runner binding at thread creation and creates or resumes a runner session
when a native coding tool first needs it.

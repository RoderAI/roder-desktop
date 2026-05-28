# Roder Desktop Extensions

Roder Desktop extensions are local packages that add commands, tools, settings,
themes, and sidebar panels to the desktop app. They use normal npm package
metadata plus a `roder` manifest section, compile to JavaScript, and can be
installed either from a linked development folder or from a packaged `.rdx`
archive.

This document describes the current extension API, how the runtime works, and
how to build and distribute an extension.

## Current Status

The extension platform currently supports:

- Local folder installs for development.
- Packaged `.rdx` archives for distribution.
- Manifest validation with actionable errors.
- Commands registered from extension code.
- Agent-callable tools registered from extension code.
- Extension preferences from manifest configuration.
- Extension-scoped global and workspace storage.
- Static HTML panels rendered in the Extensions right sidebar.
- App-server IPC event streaming into extension panels.
- Theme extensions that contribute colors and fonts to Appearance settings.
- Extension logs and activation state in the Extensions UI.

Current limitations:

- Extension code runs in a forked Node process, not in the renderer.
- Panel HTML is static package content loaded into a sandboxed iframe.
- Panel messaging is currently host-to-panel for app-server events only.
- Secret storage is stubbed and not production-ready.
- Capability prompts and grants are recorded but not yet enforced for every API.
- Rust app-server reverse-RPC for turn-time extension tools is not complete.
- `.rdx` checksums, signatures, and marketplace install are not implemented.

## Repository Layout

Extension-related code lives in these areas:

- `packages/extension-api`: public TypeScript types for extension authors.
- `packages/extension-packager`: `.rdx` packaging library and CLI.
- `electron/extensions`: manifest validation, catalog, archive install, host
  process, theme loading, panel loading, and tool proxy code.
- `src/components/extensions`: renderer UI for the Extensions sidebar, settings
  manager, and sandboxed panels.
- `src/stores/extensions-store.ts`: renderer state for installed extensions.
- `src/hooks/use-extension-themes.ts`: registers installed extension themes with
  the Appearance settings UI.
- `examples/extensions/hello-roder`: command/tool/preference/storage example.
- `examples/extensions/aurora-theme`: theme extension example.
- `~/tmp/event-log`: local POC extension that renders app-server IPC events in a
  custom panel.

## Extension Package Shape

An extension package is a normal npm-style package:

```text
my-extension/
  package.json
  src/
    extension.ts
  dist/
    extension.js
  assets/
    panel.html
  themes/
    my-theme.json
  tsconfig.json
```

The built entry point is declared in `roder.main`. The package can be installed
directly from its folder during development or packaged into `.rdx` for local
distribution.

## Manifest

The root `package.json` must include standard npm metadata and a `roder` object.

```json
{
  "name": "hello-roder-extension",
  "version": "0.1.0",
  "description": "Minimal local extension used to verify Roder Desktop extensions.",
  "type": "module",
  "license": "MIT",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "package": "pnpm build && roder-extension-package . --out dist/hello-roder.rdx"
  },
  "dependencies": {
    "@roderai/extension-api": "workspace:*",
    "@roderai/extension-packager": "workspace:*"
  },
  "roder": {
    "displayName": "Hello Roder",
    "publisher": "roder",
    "engines": {
      "roder": ">=0.0.0"
    },
    "main": "dist/extension.js",
    "activationEvents": ["onStartupFinished", "onCommand:hello-roder.sayHello", "onTool:hello-roder.echo"],
    "capabilities": ["desktop.notification"],
    "categories": ["Other"],
    "contributes": {
      "commands": [],
      "tools": [],
      "configuration": [],
      "themes": [],
      "views": {
        "panels": []
      }
    }
  }
}
```

### Required Fields

`name`: npm package name. Used with `roder.publisher` to derive the extension id.

`version`: semantic version string.

`description`: user-visible package description.

`roder.displayName`: user-visible extension name.

`roder.publisher`: lowercase publisher id. The extension id becomes
`{publisher}.{packageNameWithoutScope}`.

`roder.engines.roder`: supported Roder Desktop version range.

`roder.main`: relative path to the built JavaScript entry point.

`roder.activationEvents`: list of activation triggers.

`roder.contributes`: declarative commands, tools, configuration, themes, and
panels.

### Optional Fields

Standard package metadata such as `repository`, `homepage`, `license`,
`keywords`, and `roder.categories` is preserved for UI and packaging.

`roder.icon` is reserved for extension icons. It must be a package-relative path.

## Activation Events

Supported activation events:

- `onStartupFinished`: activate after app startup or manual activation.
- `onWorkspace`: reserved for workspace activation.
- `onCommand:<id>`: activate when a contributed command is invoked.
- `onTool:<id>`: activate when a contributed tool is invoked.
- `onView:<id>`: activate when a contributed panel is opened.

`onCommand`, `onTool`, and `onView` activation ids must reference contribution ids
declared by the same extension.

## Capabilities

Extensions declare requested capabilities in `roder.capabilities`:

- `fs.read.workspace`
- `fs.write.workspace`
- `process.spawn.shell`
- `network.web`
- `secret.read`
- `desktop.notification`
- `appserver.request`
- `ui.panel`

The catalog records each requested capability as `pending`, `granted`, or
`denied`. Some APIs are still provisional and do not yet enforce every
capability gate. Do not assume undeclared capabilities will keep working.

## Runtime Model

Extension code never runs in the React renderer. Roder Desktop owns a forked
Node host process per active extension.

The lifecycle is:

1. User installs a folder or `.rdx` archive.
2. Electron main validates `package.json`.
3. The extension catalog persists metadata under app `userData`.
4. A command, tool, panel, or manual activation asks the extension host to start.
5. The host imports `roder.main`.
6. The extension exports `activate(context)`.
7. The extension registers commands/tools and can use scoped storage.
8. `deactivate()` is called during reload, disable, uninstall, or app shutdown
   when exported.

The extension process receives a constrained API object through
`activate(context)`. It does not receive Electron objects or renderer globals.

## Public API Package

Extension authors should import types from `@roderai/extension-api`.

```ts
import type { RoderExtensionContext } from "@roderai/extension-api";

export async function activate(context: RoderExtensionContext): Promise<void> {
  // Register contributions here.
}

export async function deactivate(): Promise<void> {
  // Optional cleanup.
}
```

The package currently exports:

- `RoderExtensionContext`
- `RoderCommandRegistration`
- `RoderToolRegistration`
- `RoderToolInvocationContext`
- `RoderThemeContribution`
- `RoderThemeDefinition`
- `RoderExtensionCapability`
- `RoderExtensionActivationEvent`
- `JsonSchema`, `JsonObject`, and `JsonValue`
- Storage, secrets, notifications, workspace, thread, and disposable types

## Extension Context

`activate(context)` receives:

`extensionId`: stable id such as `roder.hello-roder-extension`.

`extensionPath`: package root path. For `.rdx` installs this is copied into app
storage. For dev installs this is the linked source folder.

`subscriptions`: disposables to clean up on deactivate.

`globalStoragePath`: directory for extension-global state.

`workspaceStoragePath`: directory for workspace-scoped state.

`globalState`: async key/value JSON storage.

`workspaceState`: async key/value JSON storage.

`secrets`: provisional secret storage API. This currently throws for writes.

`commands`: command registration and execution API.

`tools`: tool registration API.

`notifications`: host-visible notification/log API.

`env`: app name, app version, extension id, package path, and storage paths.

`workspace`: current workspace context.

`thread`: current thread context.

`preferences`: configured values from `roder.contributes.configuration`.

## Commands

Declare commands in the manifest:

```json
{
  "roder": {
    "activationEvents": ["onCommand:hello-roder.sayHello"],
    "contributes": {
      "commands": [
        {
          "id": "hello-roder.sayHello",
          "title": "Say Hello",
          "category": "Hello Roder"
        }
      ],
      "tools": [],
      "configuration": [],
      "themes": [],
      "views": { "panels": [] }
    }
  }
}
```

Register the handler in `activate`:

```ts
import type { RoderExtensionContext } from "@roderai/extension-api";

export async function activate(context: RoderExtensionContext): Promise<void> {
  context.subscriptions.push(
    context.commands.registerCommand(
      {
        id: "hello-roder.sayHello",
        title: "Say Hello",
        category: "Hello Roder",
      },
      async () => {
        const greeting = String(context.preferences["hello-roder.greeting"] ?? "Hello from an extension");
        await context.globalState.update("lastCommandRunAt", new Date().toISOString());
        await context.notifications.showInformationMessage(greeting);
        return { greeting };
      },
    ),
  );
}
```

Commands appear in the extension manager UI today. A broader command palette can
call the same command execution API later.

## Tools

Tools are agent-callable JSON functions. They are declared in the manifest and
registered in extension code.

Manifest:

```json
{
  "id": "hello-roder.echo",
  "title": "Echo Text",
  "description": "Echoes text from the user.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string",
        "description": "Text to echo back."
      }
    },
    "required": ["text"],
    "additionalProperties": false
  }
}
```

Runtime registration:

```ts
context.subscriptions.push(
  context.tools.registerTool({
    id: "hello-roder.echo",
    title: "Echo Text",
    description: "Echoes text from the user.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
      },
      required: ["text"],
      additionalProperties: false,
    },
    handler: async (input) => {
      const previousRuns = Number((await context.globalState.get("toolRuns", 0)) ?? 0);
      const runCount = previousRuns + 1;
      await context.globalState.update("toolRuns", runCount);
      return {
        text: String(input.text ?? ""),
        runCount,
      };
    },
  }),
);
```

Enabled extension tools are merged into desktop `tools/list` and matching
`tools/call` requests are routed through the extension host. Full Rust
app-server reverse-RPC integration for model turn execution is still pending.

## Preferences

Declare preferences in `roder.contributes.configuration`:

```json
{
  "key": "hello-roder.greeting",
  "title": "Greeting",
  "description": "Greeting used by the command.",
  "type": "text",
  "required": true,
  "default": "Hello from a local extension"
}
```

Supported preference types:

- `text`
- `password`
- `checkbox`
- `dropdown`
- `file`
- `directory`

Preferences are exposed to extension code through `context.preferences`. The
current UI supports editing text and checkbox values. Secret/password handling is
not production-ready yet.

## Storage

Use `globalState` for extension-global JSON data:

```ts
const count = Number((await context.globalState.get("count", 0)) ?? 0) + 1;
await context.globalState.update("count", count);
```

Use `workspaceState` for workspace-specific JSON data:

```ts
await context.workspaceState.update("lastWorkspaceAction", new Date().toISOString());
```

Values must be JSON-serializable. Passing `undefined` deletes a key.

## Panels

Extensions can contribute static HTML panels to the right-side Extensions
sidebar. Panels are sandboxed iframes and do not run with Node or Electron
authority.

Manifest:

```json
{
  "roder": {
    "activationEvents": ["onView:event-log.panel"],
    "capabilities": ["ui.panel"],
    "contributes": {
      "views": {
        "panels": [
          {
            "id": "event-log.panel",
            "title": "Event Log",
            "html": "assets/panel.html"
          }
        ]
      }
    }
  }
}
```

Panel HTML can receive host-delivered messages:

```html
<script>
  window.addEventListener("message", (message) => {
    const data = message.data || {};
    if (data.type === "roder:appServerEvents") {
      console.log("history", data.events);
    }
    if (data.type === "roder:appServerEvent") {
      console.log("live event", data.event);
    }
  });
</script>
```

The event payload shape is:

```ts
type AppServerEvent = {
  id: number;
  at: string;
  kind: "request" | "response" | "error" | "notification" | "status" | "stderr";
  method?: string;
  payload: unknown;
};
```

Current panel restrictions:

- `sandbox="allow-scripts"` only.
- No Node integration.
- No direct filesystem access.
- No direct app-server request API from panel JavaScript.
- Static HTML is read from the installed package.
- Host-to-panel messages currently cover app-server event history and live
  events.

See `~/tmp/event-log` for a POC custom panel extension.

## Themes

Theme extensions add Appearance presets. A theme can affect:

- Accent color.
- App background.
- Foreground text color.
- Sidebar color.
- Sidebar translucency.
- Contrast.
- UI font stack.
- Code font stack.
- UI font size.
- Code font size.

Manifest:

```json
{
  "roder": {
    "displayName": "Aurora Theme",
    "publisher": "roder",
    "main": "dist/extension.js",
    "activationEvents": ["onStartupFinished"],
    "capabilities": [],
    "contributes": {
      "commands": [],
      "tools": [],
      "configuration": [],
      "themes": [
        {
          "id": "aurora-dark",
          "label": "Aurora Dark",
          "scheme": "dark",
          "path": "themes/aurora-dark.json"
        }
      ],
      "views": { "panels": [] }
    }
  }
}
```

Theme file:

```json
{
  "name": "Aurora Dark",
  "scheme": "dark",
  "colors": {
    "accent": "#7dd3fc",
    "background": "#111827",
    "foreground": "#e5edf7",
    "sidebar": "#0b1220"
  },
  "translucentSidebar": true,
  "contrast": 54,
  "uiFont": "Geist, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
  "codeFont": "\"SFMono-Regular\", \"SF Mono\", Consolas, \"Liberation Mono\", monospace",
  "uiFontSize": 14,
  "codeFontSize": 13
}
```

After installation, enabled extension themes appear in Settings, Appearance, in
the light/dark theme dropdowns. Applying one uses the same CSS variable pipeline
as built-in themes.

See `examples/extensions/aurora-theme`.

## Packaging

Install the packager through the workspace or published package:

```sh
pnpm add -D @roderai/extension-packager
```

Add a package script:

```json
{
  "scripts": {
    "package": "pnpm build && roder-extension-package . --out dist/my-extension.rdx"
  }
}
```

Run:

```sh
pnpm package
```

The `.rdx` archive is a zip file. The current packager includes:

- `package.json`
- `README.md`, `README`, `LICENSE`, `LICENSE.md`
- `dist/**`
- `assets/**`
- `themes/**`

It skips dotfiles, source files outside the allowed output folders, and
`node_modules`.

## Installing Extensions

Users can install extensions from:

- Settings, Extensions.
- The right-side Extensions tool panel.

Supported install actions:

- `Install from folder`: links a local folder for development.
- `Install .rdx`: copies and extracts a packaged archive into app storage.

Development folder installs keep `source.type = "dev"` and point to the source
folder. `.rdx` installs keep `source.type = "archive"` and copy files to:

```text
app.getPath("userData")/extensions/installed/{extensionId}
```

Catalog metadata is stored in:

```text
app.getPath("userData")/extensions/catalog.json
```

## Creating A Command And Tool Extension

1. Create a package directory.
2. Add `@roderai/extension-api`.
3. Add a `roder` manifest with commands/tools/configuration.
4. Implement `activate(context)`.
5. Build to `dist/extension.js`.
6. Install the folder during development.
7. Package to `.rdx` for distribution.

Minimal `src/extension.ts`:

```ts
import type { RoderExtensionContext } from "@roderai/extension-api";

export async function activate(context: RoderExtensionContext): Promise<void> {
  context.subscriptions.push(
    context.commands.registerCommand({ id: "sample.hello", title: "Say Hello" }, async () => "Hello from Roder"),
  );
}
```

Build and package:

```sh
pnpm build
pnpm package
```

Reference implementation: `examples/extensions/hello-roder`.

## Creating A Theme Extension

1. Create a package with an empty `activate()` function.
2. Add one or more JSON theme files under `themes/`.
3. Declare them in `roder.contributes.themes`.
4. Build and package.
5. Install the `.rdx`.
6. Open Settings, Appearance, and choose the contributed theme.

Reference implementation: `examples/extensions/aurora-theme`.

## Creating A Panel Extension

1. Create `assets/panel.html`.
2. Declare it under `roder.contributes.views.panels`.
3. Add `ui.panel` to capabilities.
4. Package or install the folder.
5. Open the right-side Extensions panel.

Reference implementation: `~/tmp/event-log`.

## Security Model

Extension security has several layers:

- Renderer isolation: extension code does not run in the React renderer.
- Host process isolation: extension JS runs in a forked Node child process.
- Panel sandboxing: contributed HTML runs in an iframe with `allow-scripts` only.
- Manifest validation: contribution ids, activation targets, capabilities, and
  paths are validated before install.
- Archive extraction safety: `.rdx` rejects absolute paths and path traversal.
- Package storage: `.rdx` packages are copied into app-owned extension storage.

Do not treat the current platform as safe for arbitrary marketplace code yet.
Capability prompts, signatures, checksums, network/process/fs enforcement, and
secret storage still need production hardening.

## Validation Rules

Manifest validation rejects:

- Missing `roder` metadata.
- Missing required strings.
- Unsupported engine ranges.
- Unsupported capabilities.
- Malformed command/tool/panel/theme ids.
- Activation events pointing to undeclared commands/tools/panels.
- Absolute paths or package path traversal.
- Tools without JSON Schema object input.
- Panels or themes with unsafe package-relative paths.

Archive install rejects:

- Non-`.rdx` files.
- Archives without root `package.json`.
- Unsafe archive entries such as `../escape.js`.
- Archives whose extracted manifest differs from the validated manifest.

Theme loading rejects:

- Missing `colors`.
- Invalid `scheme`.
- Non-hex theme colors.
- Theme paths outside the installed extension package.
- A theme file whose `scheme` does not match the manifest contribution.

## Testing Extensions

Useful repo commands:

```sh
pnpm test
pnpm typecheck
pnpm build
```

Build examples:

```sh
pnpm --filter hello-roder-extension package
pnpm --filter aurora-theme-extension package
```

Smoke install an `.rdx` through the UI:

1. Open the Extensions right-side panel.
2. Click `Install .rdx`.
3. Select the packaged archive.
4. Activate the extension or run a contributed command/tool.
5. For theme packages, open Settings, Appearance, and choose the contributed
   preset.

## Versioning And Distribution

Use semantic versions in `package.json`.

Use `roder.engines.roder` to declare compatible Roder Desktop versions.

Use `.rdx` for local package distribution. A future registry can build on the
same package format with checksums, signatures, review metadata, and update
semantics.

## Known Gaps

Planned improvements:

- Extension command palette integration.
- Rich bidirectional panel APIs.
- Panel resource URI rewriting.
- Stronger CSP construction for panel assets.
- Capability approval prompts and full enforcement.
- macOS Keychain-backed secret storage.
- Rust app-server reverse-RPC for turn-time tool calls.
- `.rdx` checksums/signatures.
- Marketplace or curated registry.
- Theme previews and thumbnails.
- More granular app styling tokens for themes.

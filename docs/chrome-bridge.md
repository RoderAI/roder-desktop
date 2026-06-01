# Roder Chrome Bridge

Roder Desktop can start a local authenticated WebSocket bridge for the Roder Browser Bridge Chrome extension.

This is intentionally similar to the Claude Desktop / Claude Code browser connector flow: the desktop app owns the local connector lifecycle, shows the current connection information in Settings, and the browser extension connects to that local endpoint so browser actions stay visible to the user.

## Start the bridge

1. Open Roder Desktop.
2. Go to **Settings -> Browser**.
3. Click **Turn on bridge**.
4. Copy the **Connection URL** and **Bearer token**.

The token is generated each time the bridge starts. Click **Regenerate token** to restart the bridge and invalidate the old token.

## Connect the Chrome extension

1. In this repository, build the extension from `../roder-chrome`:

   ```powershell
   pnpm install
   pnpm build
   ```

2. In Chrome, open `chrome://extensions`, enable Developer mode, and load `../roder-chrome/dist` as an unpacked extension.
3. Open the extension options page.
4. Paste the Roder Desktop **Connection URL** into the endpoint field.
5. Paste the **Bearer token** into the token field.
6. Click **Connect** in the extension.

When connected, the extension side panel becomes the live chat and output view. Roder Desktop continues to own the bridge process and can stop or restart it from Settings.

## Security notes

- The bridge listens on `127.0.0.1` with an OS-selected port.
- The WebSocket requires the bearer token during the handshake.
- Do not expose the bridge to a public network.
- The Chrome extension still gates navigation, clicking, typing, and page inspection with its own settings.

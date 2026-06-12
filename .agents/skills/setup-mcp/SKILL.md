---
name: setup-mcp
description: Set up an MCP (Model Context Protocol) server by writing config and triggering the authentication UI. Use when the user asks to "setup", "add", "configure", or "install" an MCP server.
---

# Setup MCP Skill

When the user asks to set up an MCP server, follow this workflow:

## 1. Determine the MCP server config

Look up the correct MCP server configuration. Common servers and their configs:

**Honeycomb**
```json
{
  "command": "npx",
  "args": ["-y", "@honeycombio/honeycomb-mcp@latest"],
  "env": { "HONEYCOMB_API_KEY": "" }
}
```
Auth type: `apikey`, label: `Honeycomb API Key`, env var: `HONEYCOMB_API_KEY`

**Linear**
```json
{
  "command": "npx",
  "args": ["-y", "linear-mcp@latest"],
  "env": { "LINEAR_API_KEY": "" }
}
```
Auth type: `apikey`, label: `Linear API Key`, env var: `LINEAR_API_KEY`

**GitHub**
```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "" }
}
```
Auth type: `apikey`, label: `GitHub Personal Access Token`, env var: `GITHUB_PERSONAL_ACCESS_TOKEN`

**Slack**
```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-slack"],
  "env": { "SLACK_BOT_TOKEN": "" }
}
```
Auth type: `apikey`, label: `Slack Bot Token`, env var: `SLACK_BOT_TOKEN`

**Filesystem**
```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allow"]
}
```
Auth type: none

For unknown servers, ask the user for the command, args, and whether an API key is needed.

## 2. Write the MCP config

Read the existing `.mcp.json` at the project root (or create it if missing). Add the new server:

```json
{
  "mcpServers": {
    "<service-name>": {
      "command": "...",
      "args": [...],
      "env": { ... }
    }
  }
}
```

Do NOT include the actual API key value in `.mcp.json` — leave it as an empty string `""`. The key is provided through the auth UI and stored separately.

## 3. Trigger the authentication UI

After writing `.mcp.json`, create the auth request file so the Roder desktop shows the authentication card:

```bash
mkdir -p ~/.roder/mcp-auth-pending
```

Write a file at `~/.roder/mcp-auth-pending/<uuid>.json` with this format:

**For API key auth:**
```json
{
  "id": "<uuid>",
  "serviceName": "<service-name>",
  "authType": "apikey",
  "apiKeyLabel": "<label>",
  "status": "pending"
}
```

**For OAuth auth:**
```json
{
  "id": "<uuid>",
  "serviceName": "<service-name>",
  "authType": "oauth",
  "oauthUrl": "<oauth-authorization-url>",
  "status": "pending"
}
```

Use a random UUID for the `id` field (e.g. generate with `python3 -c "import uuid; print(uuid.uuid4())"`).

## 4. Wait for the result (optional)

If you need to verify auth completed before proceeding, poll for the result file at `~/.roder/mcp-auth-results/<uuid>.json`. Once it appears with `"status": "complete"`, authentication succeeded. For `"status": "skipped"`, the user opted out.

## 5. Report to the user

Tell the user:
- Which MCP server was configured
- That an authentication prompt has appeared (or will appear shortly)
- For API key flows: where to get the key (link to the service's API key page if known)

## Notes

- The auth card appears automatically in the Roder timeline once the pending file is written
- For API key flows, the key is securely stored by the Roder desktop — never in `.mcp.json`
- After authentication, the MCP server will be available in the next conversation
- The user can skip authentication if they want to configure the key manually later

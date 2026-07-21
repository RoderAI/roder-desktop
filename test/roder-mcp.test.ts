import { expect, test } from "vitest";
import {
  enabledMcpServersFromConfig,
  matchingMcpServerCompletions,
  mcpServerCompletionToken,
  mergeMcpServerCompletions,
  replaceMcpServerToken,
  type McpServerCompletionItem,
} from "../src/lib/roder-mcp";

test("detects @ MCP server tokens at start, after space, and mid-query", () => {
  expect(mcpServerCompletionToken("@", 1)).toEqual({ start: 0, end: 1, query: "" });
  expect(mcpServerCompletionToken("@vex", 4)).toEqual({ start: 0, end: 4, query: "vex" });
  expect(mcpServerCompletionToken("use @peek", "use @peek".length)).toEqual({
    start: 4,
    end: 9,
    query: "peek",
  });
  expect(mcpServerCompletionToken("(@local", "(@local".length)).toEqual({
    start: 1,
    end: 7,
    query: "local",
  });
});

test("does not treat emails or mid-word @ as MCP server tokens", () => {
  expect(mcpServerCompletionToken("user@vex", "user@vex".length)).toBeNull();
  expect(mcpServerCompletionToken("price@ai", "price@ai".length)).toBeNull();
});

test("excludes disabled servers when building completion items from config", () => {
  const items = enabledMcpServersFromConfig(
    {
      mcpServers: {
        vex: { command: "npx", args: ["vex"] },
        peekaboo: { command: "peekaboo", disabled: true },
        slack: { command: "slack", disabled: false },
      },
    },
    "workspace",
    "Workspace",
  );

  expect(items.map((item) => item.name)).toEqual(["slack", "vex"]);
  expect(items.every((item) => item.scope === "workspace")).toBe(true);
});

test("merges scopes with workspace winning on duplicate names", () => {
  const merged = mergeMcpServerCompletions([
    server({ name: "vex", scope: "workspace", scopeLabel: "Workspace" }),
    server({ name: "slack", scope: "global", scopeLabel: "Global" }),
    server({ name: "vex", scope: "global", scopeLabel: "Global" }),
  ]);

  expect(merged).toEqual([
    server({ name: "slack", scope: "global", scopeLabel: "Global" }),
    server({ name: "vex", scope: "workspace", scopeLabel: "Workspace" }),
  ]);
});

test("filters MCP server completions by query", () => {
  const servers = [
    server({ name: "vex" }),
    server({ name: "peekaboo" }),
    server({ name: "slack" }),
  ];

  expect(matchingMcpServerCompletions(servers, "").map((item) => item.name)).toEqual([
    "peekaboo",
    "slack",
    "vex",
  ]);
  expect(matchingMcpServerCompletions(servers, "pe").map((item) => item.name)).toEqual(["peekaboo"]);
  expect(matchingMcpServerCompletions(servers, "vex").map((item) => item.name)).toEqual(["vex"]);
  expect(matchingMcpServerCompletions(servers, "missing")).toEqual([]);
});

test("replaces the current @ token with the selected server name", () => {
  const text = "Please use @ve";
  const token = mcpServerCompletionToken(text, text.length);

  expect(token).toEqual({ start: 11, end: 14, query: "ve" });
  expect(replaceMcpServerToken(text, token!, "vex")).toEqual({
    text: "Please use @vex ",
    caret: 16,
  });
});

test("replacing an MCP token avoids duplicate spacing before existing boundaries", () => {
  expect(replaceMcpServerToken("Please use @ve today", { start: 11, end: 14, query: "ve" }, "vex")).toEqual({
    text: "Please use @vex today",
    caret: "Please use @vex".length,
  });
  expect(replaceMcpServerToken("Please use @ve, today", { start: 11, end: 14, query: "ve" }, "vex")).toEqual({
    text: "Please use @vex, today",
    caret: "Please use @vex".length,
  });
});

function server(patch: Partial<McpServerCompletionItem>): McpServerCompletionItem {
  return {
    name: patch.name ?? "server",
    scope: patch.scope ?? "global",
    scopeLabel: patch.scopeLabel ?? "Global",
  };
}

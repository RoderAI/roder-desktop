import type { CompletionToken } from "@/lib/composer-completions";

export type McpServerEntry = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
  [key: string]: unknown;
};

export type McpConfig = {
  mcpServers: Record<string, McpServerEntry>;
};

export type McpServerScope = "workspace" | "global";

export type McpConfigScope = {
  scope: McpServerScope;
  label: string;
  path: string;
};

export type McpServerCompletionItem = {
  name: string;
  scope: McpServerScope;
  scopeLabel: string;
};

export type McpServerCompletionToken = CompletionToken;

export function mcpConfigScopes(homeDir: string, cwd: string | null | undefined): McpConfigScope[] {
  const scopes: McpConfigScope[] = [];
  const trimmedCwd = cwd?.trim();
  if (trimmedCwd) {
    scopes.push({
      scope: "workspace",
      label: "Workspace",
      path: `${trimmedCwd}/.mcp.json`,
    });
  }
  scopes.push({
    scope: "global",
    label: "Global",
    path: `${homeDir}/.mcp.json`,
  });
  return scopes;
}

export function parseMcpConfig(raw: unknown): McpConfig {
  if (!raw || typeof raw !== "object") {
    return { mcpServers: {} };
  }
  const obj = raw as Record<string, unknown>;
  const servers = obj.mcpServers;
  if (!servers || typeof servers !== "object") {
    return { mcpServers: {} };
  }

  const result: Record<string, McpServerEntry> = {};
  for (const [key, value] of Object.entries(servers as Record<string, unknown>)) {
    if (value && typeof value === "object") {
      result[key] = value as McpServerEntry;
    }
  }
  return { mcpServers: result };
}

export function enabledMcpServersFromConfig(
  config: unknown,
  scope: McpServerScope,
  scopeLabel: string,
): McpServerCompletionItem[] {
  const parsed = parseMcpConfig(config);
  return Object.entries(parsed.mcpServers)
    .filter(([, entry]) => !entry.disabled)
    .map(([name]) => ({ name, scope, scopeLabel }))
    .toSorted((left, right) => compareServerNames(left.name, right.name));
}

export function mergeMcpServerCompletions(items: McpServerCompletionItem[]): McpServerCompletionItem[] {
  const seen = new Set<string>();
  const merged: McpServerCompletionItem[] = [];
  for (const item of items) {
    if (seen.has(item.name)) {
      continue;
    }
    seen.add(item.name);
    merged.push(item);
  }
  return merged.toSorted((left, right) => compareServerNames(left.name, right.name));
}

export function matchingMcpServerCompletions(
  servers: McpServerCompletionItem[],
  query: string,
  limit?: number,
): McpServerCompletionItem[] {
  const normalizedQuery = normalize(query);
  const matches = normalizedQuery
    ? servers
        .map((server) => ({ server, rank: mcpServerCompletionMatchRank(server.name, normalizedQuery) }))
        .filter((match): match is { server: McpServerCompletionItem; rank: number } => match.rank !== null)
        .sort(
          (left, right) =>
            left.rank - right.rank || compareServerNames(left.server.name, right.server.name),
        )
        .map((match) => match.server)
    : servers.toSorted((left, right) => compareServerNames(left.name, right.name));

  return typeof limit === "number" ? matches.slice(0, limit) : matches;
}

export function mcpServerCompletionToken(text: string, caret: number): McpServerCompletionToken | null {
  const end = Math.max(0, Math.min(caret, text.length));
  const beforeCaret = text.slice(0, end);
  const match = beforeCaret.match(/@([A-Za-z0-9_-]*)$/);
  if (!match || match.index === undefined) {
    return null;
  }

  const start = match.index;
  const query = match[1] ?? "";
  if (start > 0 && !isMcpTokenBoundary(text[start - 1])) {
    return null;
  }

  return { start, end, query };
}

export function replaceMcpServerToken(
  text: string,
  token: McpServerCompletionToken,
  serverName: string,
): { text: string; caret: number } {
  const replacement = `@${serverName}${shouldAppendCompletionSpace(text[token.end]) ? " " : ""}`;
  const nextText = `${text.slice(0, token.start)}${replacement}${text.slice(token.end)}`;
  return {
    text: nextText,
    caret: token.start + replacement.length,
  };
}

function mcpServerCompletionMatchRank(name: string, query: string): number | null {
  const normalizedName = normalize(name);
  if (normalizedName === query) {
    return 0;
  }
  if (normalizedName.startsWith(query)) {
    return 1;
  }
  if (nameParts(name).some((part) => part.startsWith(query))) {
    return 2;
  }
  return normalizedName.includes(query) ? 3 : null;
}

function shouldAppendCompletionSpace(nextCharacter: string | undefined): boolean {
  return !nextCharacter || (!/\s/.test(nextCharacter) && !isMcpTokenEndBoundary(nextCharacter));
}

function nameParts(name: string): string[] {
  return name.split(/[-_\s]+/).flatMap((part) => {
    const normalized = normalize(part);
    return normalized ? [normalized] : [];
  });
}

function compareServerNames(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function isMcpTokenBoundary(character: string): boolean {
  return /\s/.test(character) || "([{,;".includes(character);
}

function isMcpTokenEndBoundary(character: string): boolean {
  return /\s/.test(character) || ")]},;.!?".includes(character);
}

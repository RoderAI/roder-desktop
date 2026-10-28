/** Builtin inference provider ids that must not be overwritten as custom endpoints. */
export const BUILTIN_PROVIDER_IDS = new Set([
  "mock",
  "openai",
  "openai-speech",
  "google-speech",
  "codex",
  "claude-code",
  "anthropic",
  "gemini",
  "vertex",
  "xai",
  "supergrok",
  "opencode",
  "opencode-go",
  "openrouter",
  "fireworks",
  "roder-cloud",
  "poolside",
  "cursor",
  "xiaomi-mimo",
  "xiaomi-mimo-token-plan",
  "kimi-code",
  "synthetic",
]);

export type CustomProviderDraft = {
  id: string;
  baseUrl: string;
  apiKey?: string;
  apiKeyEnv?: string;
  /** Optional model ids to seed when /models discovery is unavailable. */
  modelIds?: string[];
};

export type CustomProviderConfigEntry = {
  id: string;
  baseUrl: string;
  apiKey?: string;
  apiKeyEnv?: string;
};

export type CachedModelDescriptor = {
  id: string;
  name: string;
  context_window?: number | null;
  default_reasoning?: string | null;
  supported_reasoning?: Array<{ effort: string; description: string }>;
};

export type ModelsCacheFile = {
  providers: Record<
    string,
    {
      fetched_at: number;
      base_url: string;
      models: CachedModelDescriptor[];
    }
  >;
};

export function normalizeCustomProviderId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export function parseModelIds(raw: string): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const part of raw.split(/[\n,]+/)) {
    const id = part.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function validateCustomProviderDraft(draft: CustomProviderDraft): string | null {
  const id = normalizeCustomProviderId(draft.id);
  if (!id) {
    return "Provider id is required.";
  }
  if (!/^[a-z][a-z0-9._-]*$/.test(id)) {
    return "Provider id must start with a letter and use only letters, numbers, dots, underscores, or hyphens.";
  }
  if (BUILTIN_PROVIDER_IDS.has(id)) {
    return `"${id}" is a built-in provider. Choose a different id.`;
  }

  const baseUrl = normalizeBaseUrl(draft.baseUrl);
  if (!baseUrl) {
    return "Base URL is required.";
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return "Base URL must be a valid URL.";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Base URL must use http:// or https://.";
  }

  const apiKey = draft.apiKey?.trim() ?? "";
  const apiKeyEnv = draft.apiKeyEnv?.trim() ?? "";
  if (!apiKey && !apiKeyEnv) {
    return "Provide an API key or an environment variable name.";
  }
  if (apiKeyEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) {
    return "API key environment variable must be a valid env name.";
  }

  return null;
}

export function listCustomProviderTables(toml: string): CustomProviderConfigEntry[] {
  const entries: CustomProviderConfigEntry[] = [];
  for (const match of toml.matchAll(/^\[providers\.([^\]]+)\][ \t]*$/gm)) {
    const id = match[1]?.trim() ?? "";
    if (!id || BUILTIN_PROVIDER_IDS.has(id)) {
      continue;
    }
    const body = extractTableBody(toml, match.index ?? 0);
    const baseUrl = readTomlStringValue(body, "base_url");
    if (!baseUrl) {
      continue;
    }
    entries.push({
      id,
      baseUrl: normalizeBaseUrl(baseUrl),
      apiKey: readTomlStringValue(body, "api_key") ?? undefined,
      apiKeyEnv: readTomlStringValue(body, "api_key_env") ?? undefined,
    });
  }
  return entries;
}

/** Upsert a `[providers.<id>]` table while preserving unrelated config text. */
export function upsertCustomProviderTable(toml: string, draft: CustomProviderDraft): string {
  const error = validateCustomProviderDraft(draft);
  if (error) {
    throw new Error(error);
  }

  const id = normalizeCustomProviderId(draft.id);
  const baseUrl = normalizeBaseUrl(draft.baseUrl);
  const apiKey = draft.apiKey?.trim() || undefined;
  const apiKeyEnv = draft.apiKeyEnv?.trim() || undefined;
  const header = `[providers.${id}]`;
  const nextBody = formatProviderTableBody({ baseUrl, apiKey, apiKeyEnv });

  const headerRe = new RegExp(`^\\[providers\\.${escapeRegExp(id)}\\][ \\t]*$`, "m");
  const headerMatch = headerRe.exec(toml);
  if (!headerMatch || headerMatch.index === undefined) {
    const prefix = toml.trimEnd();
    const block = `${header}\n${nextBody}`;
    return prefix ? `${prefix}\n\n${block}\n` : `${block}\n`;
  }

  const start = headerMatch.index;
  const end = findTableEnd(toml, start + headerMatch[0].length);
  const before = toml.slice(0, start).replace(/\s*$/, "");
  const after = toml.slice(end).replace(/^\s*/, "");
  const block = `${header}\n${nextBody}`;
  if (!before && !after) {
    return `${block}\n`;
  }
  if (!before) {
    return `${block}\n\n${after}`;
  }
  if (!after) {
    return `${before}\n\n${block}\n`;
  }
  return `${before}\n\n${block}\n\n${after}`;
}

export function removeCustomProviderTable(toml: string, providerId: string): string {
  const id = normalizeCustomProviderId(providerId);
  if (!id || BUILTIN_PROVIDER_IDS.has(id)) {
    throw new Error("Only custom providers can be removed.");
  }
  const headerRe = new RegExp(`^\\[providers\\.${escapeRegExp(id)}\\][ \\t]*$`, "m");
  const headerMatch = headerRe.exec(toml);
  if (!headerMatch || headerMatch.index === undefined) {
    return toml;
  }
  const start = headerMatch.index;
  const end = findTableEnd(toml, start + headerMatch[0].length);
  const before = toml.slice(0, start).replace(/\s*$/, "");
  const after = toml.slice(end).replace(/^\s*/, "");
  if (!before) {
    return after ? `${after}${after.endsWith("\n") ? "" : "\n"}` : "";
  }
  if (!after) {
    return `${before}\n`;
  }
  return `${before}\n\n${after}`;
}

export function seedModelsCache(
  cache: ModelsCacheFile | null | undefined,
  providerId: string,
  baseUrl: string,
  modelIds: string[],
  nowSecs: number = Math.floor(Date.now() / 1000),
): ModelsCacheFile {
  const id = normalizeCustomProviderId(providerId);
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const next: ModelsCacheFile = {
    providers: { ...(cache?.providers ?? {}) },
  };
  if (modelIds.length === 0) {
    return next;
  }
  next.providers[id] = {
    fetched_at: nowSecs,
    base_url: normalizedBase,
    models: modelIds.map((modelId) => ({
      id: modelId,
      name: modelId,
      context_window: null,
      default_reasoning: null,
      supported_reasoning: [],
    })),
  };
  return next;
}

export function removeModelsCacheProvider(
  cache: ModelsCacheFile | null | undefined,
  providerId: string,
): ModelsCacheFile {
  const id = normalizeCustomProviderId(providerId);
  const providers = { ...(cache?.providers ?? {}) };
  delete providers[id];
  return { providers };
}

function formatProviderTableBody(input: { baseUrl: string; apiKey?: string; apiKeyEnv?: string }): string {
  const lines = [`base_url = ${tomlString(input.baseUrl)}`];
  if (input.apiKey) {
    lines.push(`api_key = ${tomlString(input.apiKey)}`);
  }
  if (input.apiKeyEnv) {
    lines.push(`api_key_env = ${tomlString(input.apiKeyEnv)}`);
  }
  return `${lines.join("\n")}\n`;
}

function extractTableBody(toml: string, headerIndex: number): string {
  const headerLineEnd = toml.indexOf("\n", headerIndex);
  const bodyStart = headerLineEnd === -1 ? toml.length : headerLineEnd + 1;
  const bodyEnd = findTableEnd(toml, bodyStart);
  return toml.slice(bodyStart, bodyEnd);
}

function findTableEnd(toml: string, from: number): number {
  const rest = toml.slice(from);
  const match = /^\[/m.exec(rest);
  if (!match || match.index === undefined) {
    return toml.length;
  }
  return from + match.index;
}

function readTomlStringValue(body: string, key: string): string | null {
  const re = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*(.+)$`, "m");
  const match = re.exec(body);
  if (!match) {
    return null;
  }
  return parseTomlStringLiteral(match[1]?.trim() ?? "");
}

function parseTomlStringLiteral(raw: string): string | null {
  const value = raw.trim();
  if (!value || value === "null") {
    return null;
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    const quote = value[0];
    const inner = value.slice(1, -1);
    if (quote === '"') {
      return inner.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    return inner;
  }
  // Bare tokens (unusual for URLs/keys) — take until comment.
  return value.replace(/\s+#.*$/, "").trim() || null;
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

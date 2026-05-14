import type { ConversationMessage, GodeItem, GodeThread, GodeTurn } from "@/types/gode";

export function sortThreadsByUpdatedAt(threads: GodeThread[]): GodeThread[] {
  return [...threads].sort((left, right) => right.updatedAt - left.updatedAt);
}

export function upsertThread(threads: GodeThread[], incoming: GodeThread): GodeThread[] {
  return sortThreadsByUpdatedAt([incoming, ...threads.filter((thread) => thread.id !== incoming.id && !thread.id.startsWith("demo-"))]);
}

export function messagesFromThread(thread: GodeThread | undefined): ConversationMessage[] {
  if (!thread?.turns) {
    return [];
  }

  return thread.turns.flatMap((turn) => messagesFromTurn(thread.id, turn));
}

export function messagesFromTurn(threadId: string, turn: GodeTurn): ConversationMessage[] {
  return turn.items.reduce<ConversationMessage[]>((messages, item) => {
    for (const message of messagesFromGodeItem(threadId, turn.id, item, turn.status)) {
      upsertConversationMessage(messages, message);
    }
    return messages;
  }, []);
}

export function messagesFromGodeItem(threadId: string, turnId: string, item: GodeItem, turnStatus: string): ConversationMessage[] {
  const toolMessage = toolMessageFromItem(threadId, turnId, item);
  if (toolMessage) {
    return [toolMessage];
  }

  const text = extractItemText(item);
  if (!text) {
    return [];
  }
  if (isLegacyToolLabel(text)) {
    return [];
  }

  if (item.type === "userMessage") {
    return [{ id: item.id, threadId, turnId, role: "user", text, status: "complete" }];
  }
  if (item.type === "agentMessage") {
    return [{ id: item.id, threadId, turnId, role: "assistant", text, status: turnStatus === "inProgress" ? "streaming" : "complete" }];
  }
  if (item.type === "error") {
    return [{ id: item.id, threadId, turnId, role: "system", text, status: "failed" }];
  }
  return [];
}

export function upsertConversationMessage(messages: ConversationMessage[], incoming: ConversationMessage): ConversationMessage[] {
  const key = messageKey(incoming);
  const index = messages.findIndex((message) => messageKey(message) === key);
  if (index === -1) {
    messages.push(incoming);
    return messages;
  }

  messages[index] = mergeMessage(messages[index], incoming);
  return messages;
}

function extractItemText(item: GodeItem): string {
  if (typeof item.text === "string") {
    return item.text;
  }
  if (item.payload && typeof item.payload === "object" && "text" in item.payload) {
    const text = (item.payload as { text?: unknown }).text;
    return typeof text === "string" ? text : "";
  }
  return "";
}

function isLegacyToolLabel(text: string): boolean {
  return /^Tool\s+\S+\s+(result|failed):\s*$/i.test(text.trim());
}

function toolMessageFromItem(threadId: string, turnId: string, item: GodeItem): ConversationMessage | null {
  if (!isToolItem(item)) {
    return null;
  }

  const payload = asRecord(item.payload);
  const raw = asRecord(item.raw);
  const input = firstRecord(payload.input, payload.arguments, raw.arguments);
  const toolName = firstString(item.toolName, payload.tool, payload.name, raw.name, item.type === "toolMessage" ? "tool" : undefined) ?? "tool";
  const toolCallId = firstString(item.toolCallId, payload.tool_call_id, payload.toolCallId, payload.call_id, raw.call_id);
  const toolStatus = toolStatusFromItem(item);
  const output = toolOutputText(item, payload);
  const summary = summarizeTool(toolName, toolStatus, input, output, payload);
  const status = toolStatus === "running" ? "streaming" : toolStatus;

  return {
    id: toolCallId ? `tool:${toolCallId}` : item.id,
    threadId,
    turnId,
    role: "tool",
    text: summary,
    status,
    toolName,
    toolCallId,
    toolStatus,
    toolSummary: summary,
  };
}

function isToolItem(item: GodeItem): boolean {
  return item.type === "toolCall" || item.type === "toolMessage" || item.type.startsWith("tool.");
}

function toolStatusFromItem(item: GodeItem): "running" | "complete" | "failed" {
  const sourceKind = item.sourceKind ?? "";
  if (item.type === "tool.failed" || sourceKind === "tool.failed") {
    return "failed";
  }
  if (item.type === "tool.requested" || item.type === "tool.started" || sourceKind === "tool.requested" || sourceKind === "tool.started") {
    return "running";
  }
  if (item.type === "tool.completed" || sourceKind === "tool.completed" || item.type === "toolMessage") {
    return item.status === "failed" ? "failed" : "complete";
  }
  return "running";
}

function toolOutputText(item: GodeItem, payload: Record<string, unknown>): string {
  if (item.type === "toolCall" || item.type === "tool.requested" || item.type === "tool.started") {
    return firstString(payload.text, payload.output, payload.error) ?? "";
  }
  return firstString(item.text, payload.text, payload.output, payload.error, extractItemText(item)) ?? "";
}

function summarizeTool(
  toolName: string,
  status: "running" | "complete" | "failed",
  input: Record<string, unknown>,
  output: string,
  payload: Record<string, unknown>,
): string {
  if (status === "failed") {
    return compactLine(`failed: ${firstString(payload.error, output) ?? "error"}`);
  }

  if (toolName === "read_file") {
    const path = firstString(input.path, input.file, readFilePathFromOutput(output));
    return path ?? "";
  }

  if (toolName === "list_files") {
    return firstString(input.path, input.dir, input.directory, outputFirstLine(output)) ?? "";
  }

  if (toolName === "grep" || toolName === "search_files") {
    return firstString(input.query, input.pattern, input.regex, outputFirstLine(output)) ?? "";
  }

  if (toolName === "glob") {
    return firstString(input.pattern, input.glob, outputFirstLine(output)) ?? "";
  }

  if (toolName === "apply_patch" || toolName === "edit") {
    return firstString(input.path, input.file, outputFirstLine(output)) ?? "";
  }

  if (status === "running") {
    return compactLine(summarizeInput(input));
  }

  return compactLine(outputFirstLine(output) ?? summarizeInput(input));
}

function mergeMessage(existing: ConversationMessage, incoming: ConversationMessage): ConversationMessage {
  if (existing.role !== "tool" || incoming.role !== "tool") {
    return { ...existing, ...incoming, text: incoming.text || existing.text };
  }

  return {
    ...existing,
    ...incoming,
    text: preferredToolSummary(existing, incoming),
    toolSummary: preferredToolSummary(existing, incoming),
    toolName: incoming.toolName || existing.toolName,
    toolCallId: incoming.toolCallId || existing.toolCallId,
  };
}

function preferredToolSummary(existing: ConversationMessage, incoming: ConversationMessage): string {
  const incomingSummary = incoming.toolSummary || incoming.text;
  const existingSummary = existing.toolSummary || existing.text;
  if (!incomingSummary) {
    return existingSummary;
  }
  if (incoming.status === "complete" && existingSummary && looksLikeResultSummary(incomingSummary)) {
    return existingSummary;
  }
  return incomingSummary;
}

function messageKey(message: ConversationMessage): string {
  if (message.role === "tool" && message.toolCallId) {
    return `tool:${message.toolCallId}`;
  }
  return message.id;
}

function firstRecord(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    if (isRecord(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = parseJSONRecord(value);
      if (parsed) {
        return parsed;
      }
    }
  }
  return {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function summarizeInput(input: Record<string, unknown>): string {
  const path = firstString(input.path, input.file, input.dir, input.directory);
  if (path) {
    return path;
  }
  const query = firstString(input.query, input.pattern, input.regex, input.command, input.cmd);
  if (query) {
    return query;
  }
  return "";
}

function outputFirstLine(output: string): string | undefined {
  const line = output.split(/\r?\n/).find((part) => part.trim());
  if (!line) {
    return undefined;
  }
  const normalized = line.replace(/^success:\s*/i, "").replace(/^requested$/i, "").trim();
  if (isLegacyToolLabel(normalized)) {
    return undefined;
  }
  return normalized || undefined;
}

function readFilePathFromOutput(output: string): string | undefined {
  const line = outputFirstLine(output);
  if (!line) {
    return undefined;
  }
  if (/^read file$/i.test(line)) {
    return undefined;
  }
  const match = /^read\s+(.+)$/i.exec(line);
  return match?.[1]?.trim();
}

function compactLine(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function looksLikeResultSummary(value: string): boolean {
  return isLegacyToolLabel(value) || value.includes("\n") || value.length > 160;
}

function parseJSONRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function threadTitle(thread: GodeThread | undefined): string {
  if (!thread) {
    return "New Agent";
  }
  return thread.name ?? (thread.preview || "Untitled agent");
}

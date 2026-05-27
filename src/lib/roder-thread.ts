import type { ConversationMessage, RoderItem, RoderThread, RoderTurn } from "@/types/roder";
import { isShellToolName } from "@/lib/tool-display";

export function sortThreadsByUpdatedAt(threads: RoderThread[]): RoderThread[] {
  return [...threads].sort((left, right) => right.updatedAt - left.updatedAt);
}

export function upsertThread(threads: RoderThread[], incoming: RoderThread): RoderThread[] {
  const realThreads = threads.filter((thread) => !thread.id.startsWith("demo-"));
  const existingIndex = realThreads.findIndex((thread) => thread.id === incoming.id);
  if (existingIndex === -1) {
    return [incoming, ...realThreads];
  }

  const nextThreads = [...realThreads];
  nextThreads[existingIndex] = incoming;
  return nextThreads;
}

export function markThreadStatus(threads: RoderThread[], threadId: string, status: RoderThread["status"]): RoderThread[] {
  if (!threadId) {
    return threads;
  }
  return threads.map((thread) => (thread.id === threadId ? { ...thread, status } : thread));
}

export function isThreadRunning(thread: RoderThread | undefined): boolean {
  return thread?.status.type === "running";
}

export function activeTurnIdForThread(thread: RoderThread | undefined): string {
  return thread?.status.activeTurnId ?? "";
}

export function messagesFromThread(thread: RoderThread | undefined): ConversationMessage[] {
  if (!thread?.turns) {
    return [];
  }

  return thread.turns.flatMap((turn) => messagesFromTurn(thread.id, turn));
}

export function messagesFromTurn(threadId: string, turn: RoderTurn): ConversationMessage[] {
  return turn.items.reduce<ConversationMessage[]>((messages, item) => {
    for (const message of messagesFromRoderItem(threadId, turn.id, item, turn.status)) {
      upsertConversationMessage(messages, message);
    }
    return messages;
  }, []);
}

export function messagesFromRoderItem(threadId: string, turnId: string, item: RoderItem, turnStatus: string): ConversationMessage[] {
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
    const phase = normalizeAssistantPhase(item.phase);
    return [{
      id: assistantMessageId(item.id, phase),
      threadId,
      turnId,
      role: "assistant",
      text,
      phase,
      status: turnStatus === "inProgress" ? "streaming" : "complete",
    }];
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

export function assistantMessageId(itemId: string, phase?: string): string {
  const normalized = normalizeAssistantPhase(phase);
  if (!normalized || normalized === "final_answer") {
    return itemId;
  }
  return `${itemId}:${normalized}`;
}

export function normalizeAssistantPhase(phase?: string): string | undefined {
  const normalized = phase?.trim();
  return normalized || undefined;
}

function extractItemText(item: RoderItem): string {
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

function toolMessageFromItem(threadId: string, turnId: string, item: RoderItem): ConversationMessage | null {
  if (!isToolItem(item)) {
    return null;
  }

  const payload = asRecord(item.payload);
  const raw = asRecord(item.raw);
  const input = inputFromToolItem(item, payload);
  const toolName = firstString(item.toolName, payload.tool, payload.name, raw.name, item.type === "toolMessage" ? "tool" : undefined) ?? "tool";
  const toolCallId = firstString(item.toolCallId, payload.tool_call_id, payload.toolCallId, payload.call_id, raw.call_id);
  const toolStatus = toolStatusFromItem(item);
  const output = toolOutputText(item, payload);
  const detailOutput = toolDetailOutputText(item, payload);
  const summary = summarizeTool(toolName, toolStatus, input, output, payload);
  const command = shellCommand(input, payload);
  if (isShellToolName(toolName) && toolStatus === "running" && !command) {
    return null;
  }
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
    toolInput: isShellToolName(toolName) ? command : undefined,
    toolOutput: toolDetailOutput(toolName, detailOutput),
    toolSubject: toolSubject(toolName, input, payload),
    toolSummary: summary,
  };
}

function toolDetailOutput(toolName: string, detailOutput: string): string | undefined {
  if (!detailOutput || (!isShellToolName(toolName) && toolName !== "tool")) {
    return undefined;
  }
  return isShellToolName(toolName) ? stripShellHarnessMetadata(detailOutput) : detailOutput;
}

function isToolItem(item: RoderItem): boolean {
  return item.type === "toolCall" || item.type === "toolMessage" || item.type.startsWith("tool.");
}

function toolStatusFromItem(item: RoderItem): "running" | "complete" | "failed" {
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

function toolOutputText(item: RoderItem, payload: Record<string, unknown>): string {
  if (item.type === "toolCall" || item.type === "tool.requested" || item.type === "tool.started") {
    return firstString(payload.text, payload.output, payload.error) ?? "";
  }
  return firstString(item.text, payload.text, payload.output, payload.error, extractItemText(item)) ?? "";
}

function toolDetailOutputText(item: RoderItem, payload: Record<string, unknown>): string {
  if (item.type === "toolCall" || item.type === "tool.requested" || item.type === "tool.started") {
    return rawString(payload.text, payload.output, payload.error) ?? "";
  }
  return rawString(item.text, payload.text, payload.output, payload.error, extractItemText(item)) ?? "";
}

function summarizeTool(
  toolName: string,
  status: "running" | "complete" | "failed",
  input: Record<string, unknown>,
  output: string,
  payload: Record<string, unknown>,
): string {
  if (toolName === "read_file") {
    const path = firstString(payload.path, payload.file, input.path, input.file);
    return path ? toolActionSummary(status, "Read", "Reading", "Failed to read", basename(path)) : "";
  }

  if (toolName === "read_skill") {
    const name = toolSkillName(input, payload);
    return toolActionSummary(status, "Read", "Reading", "Failed to read", name ? `${name} Skill` : "Skill");
  }

  if (toolName === "read_skill_file") {
    const skill = toolSkillName(input, payload);
    const fileName = firstString(payload.path, payload.file, input.path, input.file);
    const subject = [skill, fileName ? basename(fileName) : "file"].filter(Boolean).join(" ");
    return toolActionSummary(status, "Read", "Reading", "Failed to read", subject);
  }

  if (toolName === "list_files") {
    const path = toolPath(input, payload);
    const suffix = path ? ` in ${path}` : "";
    if (status === "failed") {
      return `Failed to list files${suffix}`;
    }
    return status === "running" ? `Listing files${suffix}` : `Listed files${suffix}`;
  }

  if (toolName === "grep" || toolName === "search_files") {
    const query = firstString(payload.query, payload.pattern, payload.regex, input.query, input.pattern, input.regex);
    const path = toolPath(input, payload);
    return query ? searchSummary(status, query, path) : "";
  }

  if (toolName === "glob") {
    const pattern = firstString(payload.pattern, payload.glob, input.pattern, input.glob);
    const path = toolPath(input, payload);
    return pattern ? searchSummary(status, pattern, path) : "";
  }

  if (toolName === "write_file") {
    const path = toolPath(input, payload);
    return path ? toolActionSummary(status, "Wrote", "Writing", "Failed to write", basename(path)) : "";
  }

  if (toolName === "edit" || toolName === "multi_edit") {
    const path = toolPath(input, payload);
    return path ? toolActionSummary(status, "Edited", "Editing", "Failed to edit", basename(path)) : "";
  }

  if (toolName === "apply_patch") {
    const path = toolPath(input, payload);
    const suffix = path ? ` to ${basename(path)}` : "";
    if (status === "failed") {
      return `Failed to apply patch${suffix}`;
    }
    return status === "running" ? `Applying patch${suffix}` : `Applied patch${suffix}`;
  }

  if (isShellToolName(toolName)) {
    const command = shellCommand(input, payload);
    return command ? toolActionSummary(status, "Ran", "Running", "Failed to run", command) : "";
  }

  if (status === "failed") {
    return compactLine(`failed: ${firstString(payload.error, output) ?? "error"}`);
  }

  if (status === "running") {
    return compactLine(summarizeInput(input));
  }

  return compactLine(summarizeInput(input) || output);
}

function mergeMessage(existing: ConversationMessage, incoming: ConversationMessage): ConversationMessage {
  if (existing.role !== "tool" || incoming.role !== "tool") {
    return { ...existing, ...incoming, text: incoming.text || existing.text, phase: incoming.phase || existing.phase };
  }

  return {
    ...existing,
    ...incoming,
    text: preferredToolSummary(existing, incoming),
    toolSummary: preferredToolSummary(existing, incoming),
    toolInput: incoming.toolInput || existing.toolInput,
    toolOutput: mergedToolOutput(existing, incoming),
    toolName: mergedToolName(existing, incoming),
    toolSubject: incoming.toolSubject || existing.toolSubject,
    toolCallId: incoming.toolCallId || existing.toolCallId,
  };
}

function mergedToolName(existing: ConversationMessage, incoming: ConversationMessage): string | undefined {
  return incoming.toolName === "tool" ? existing.toolName : incoming.toolName || existing.toolName;
}

function mergedToolOutput(existing: ConversationMessage, incoming: ConversationMessage): string | undefined {
  const output = incoming.toolOutput || existing.toolOutput;
  if (!output || !isShellToolName(mergedToolName(existing, incoming))) {
    return output;
  }
  return stripShellHarnessMetadata(output);
}

function preferredToolSummary(existing: ConversationMessage, incoming: ConversationMessage): string {
  const incomingSummary = incoming.toolSummary || incoming.text;
  const existingSummary = existing.toolSummary || existing.text;
  if (incoming.status === "complete" && incoming.toolName === "tool" && existingSummary) {
    return completedToolSummary(existingSummary, incoming.status);
  }
  if (!incomingSummary) {
    return completedToolSummary(existingSummary, incoming.status);
  }
  if (incoming.status === "complete" && existingSummary && looksLikeResultSummary(incomingSummary)) {
    return completedToolSummary(existingSummary, incoming.status);
  }
  return completedToolSummary(incomingSummary, incoming.status);
}

function completedToolSummary(summary: string, status: ConversationMessage["status"]): string {
  if (status !== "complete") {
    return summary;
  }

  return summary
    .replace(/^Reading\s+/, "Read ")
    .replace(/^Searching for\s+/, "Searched for ")
    .replace(/^Running\s+/, "Ran ");
}

function messageKey(message: ConversationMessage): string {
  if (message.role === "tool" && message.toolCallId) {
    return `tool:${message.toolCallId}`;
  }
  return message.id;
}

function inputFromToolItem(item: RoderItem, payload: Record<string, unknown>): Record<string, unknown> {
  return item.type === "toolCall" ? payload : {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function rawString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
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

function shellCommand(input: Record<string, unknown>, payload: Record<string, unknown>): string | undefined {
  return firstString(
    payload.command,
    payload.cmd,
    payload.shell_command,
    input.command,
    input.cmd,
    input.shell_command,
  );
}

function toolSubject(toolName: string, input: Record<string, unknown>, payload: Record<string, unknown>): string | undefined {
  if (toolName === "read_file") {
    const path = firstString(payload.path, payload.file, input.path, input.file);
    return path ? basename(path) : undefined;
  }
  if (toolName === "read_skill") {
    const name = toolSkillName(input, payload);
    return name ? `${name} Skill` : "Skill";
  }
  if (toolName === "read_skill_file") {
    const skill = toolSkillName(input, payload);
    const fileName = firstString(payload.path, payload.file, input.path, input.file);
    return [skill, fileName ? basename(fileName) : "file"].filter(Boolean).join(" ") || undefined;
  }
  if (toolName === "list_files") {
    return toolPath(input, payload);
  }
  if (toolName === "grep" || toolName === "search_files" || toolName === "glob") {
    const query = firstString(payload.query, payload.pattern, payload.regex, payload.glob, input.query, input.pattern, input.regex, input.glob);
    const path = toolPath(input, payload);
    if (!query) {
      return undefined;
    }
    return path ? `${query} in ${path}` : query;
  }
  if (toolName === "write_file" || toolName === "edit" || toolName === "multi_edit" || toolName === "apply_patch") {
    const path = toolPath(input, payload);
    return path ? basename(path) : undefined;
  }
  if (isShellToolName(toolName)) {
    return shellCommand(input, payload);
  }
  return undefined;
}

function stripShellHarnessMetadata(output: string): string {
  const runnerMatch = /^(?:Exit code:\s*[^\r\n]*\r?\n)?Wall time:\s*[^\r\n]*\r?\nOutput:\r?\n([\s\S]*)$/i.exec(output);
  if (runnerMatch) {
    return runnerMatch[1];
  }

  return output.replace(/(?:\r?\n)?Status:\s*\w+\s*\r?\nWall time:\s*[^\r\n]+\s*$/i, (match) => {
    return match.startsWith("\n") || match.startsWith("\r\n") ? "\n" : "";
  });
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function toolSkillName(input: Record<string, unknown>, payload: Record<string, unknown>): string | undefined {
  return firstString(payload.displayName, payload.name, payload.skill, input.displayName, input.name, input.skill);
}

function toolPath(input: Record<string, unknown>, payload: Record<string, unknown>): string | undefined {
  return firstString(payload.path, payload.dir, payload.directory, input.path, input.dir, input.directory);
}

function searchSummary(status: "running" | "complete" | "failed", query: string, path: string | undefined): string {
  const verb = status === "failed" ? "Failed to search for" : status === "running" ? "Searching for" : "Searched for";
  return path ? `${verb} "${query}" in ${path}` : `${verb} "${query}"`;
}

function toolActionSummary(status: "running" | "complete" | "failed", completed: string, running: string, failed: string, subject: string): string {
  const verb = status === "failed" ? failed : status === "running" ? running : completed;
  return `${verb} ${subject}`;
}

function compactLine(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function looksLikeResultSummary(value: string): boolean {
  return isLegacyToolLabel(value) || value.includes("\n") || value.length > 160;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function threadTitle(thread: RoderThread | undefined): string {
  if (!thread) {
    return "New Agent";
  }
  return thread.name ?? (thread.preview || "Untitled agent");
}

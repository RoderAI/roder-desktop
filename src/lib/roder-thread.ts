import type {
  ConversationMessage,
  RoderItem,
  RoderThread,
  RoderThreadItemDelta,
  RoderThreadItemEvent,
  RoderThreadItemEventKind,
  RoderTurn,
} from "@/types/roder";
import { isShellToolName } from "@/lib/tool-display";

const emptyMessages: ConversationMessage[] = [];
const messagesByThread = new WeakMap<RoderThread, ConversationMessage[]>();
const duplicateItemIdMarker = "::duplicate-";

export function sortThreadsByUpdatedAt(threads: RoderThread[]): RoderThread[] {
  return threads.toSorted((left, right) => right.updatedAt - left.updatedAt);
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

export function patchThread(threads: RoderThread[], threadId: string, patch: Partial<RoderThread>): RoderThread[] {
  if (!threadId) {
    return threads;
  }
  return threads.map((thread) => (thread.id === threadId ? { ...thread, ...patch } : thread));
}

export function markThreadStatus(
  threads: RoderThread[],
  threadId: string,
  status: RoderThread["status"],
): RoderThread[] {
  if (!threadId) {
    return threads;
  }
  return threads.map((thread) => (thread.id === threadId ? { ...thread, status } : thread));
}

export function isThreadRunning(thread: RoderThread | undefined): boolean {
  return thread?.status.type === "running";
}

export function shouldShowThreadWorkingIndicator(
  thread: RoderThread | undefined,
  waitRequestCount: number,
  messages: ConversationMessage[],
): boolean {
  if (!isThreadRunning(thread) || waitRequestCount > 0) {
    return false;
  }
  if (hasCurrentAssistantStream(messages)) {
    return false;
  }
  return !thread?.status.activeFlags.some(
    (flag) => flag === "approvalRequired" || flag === "userInputRequired" || flag === "planExitRequired",
  );
}

export function activeTurnIdForThread(thread: RoderThread | undefined): string {
  return thread?.status.activeTurnId ?? "";
}

export function applyThreadItemEvent(
  thread: RoderThread | undefined,
  event: RoderThreadItemEvent,
): RoderThread | undefined {
  if (!thread) {
    return thread;
  }
  const turns = thread.turns ? [...thread.turns] : [];
  const turnIndex = turns.findIndex((turn) => turn.id === event.turnId);
  const turn =
    turnIndex === -1
      ? {
          id: event.turnId,
          items: [],
          itemsView: "default",
          status: "inProgress" as const,
          error: null,
        }
      : turns[turnIndex];
  const nextTurn = {
    ...turn,
    items: applyThreadItemEventToItems(turn.items, event.event),
  };
  if (turnIndex === -1) {
    turns.push(nextTurn);
  } else {
    turns[turnIndex] = nextTurn;
  }
  return { ...thread, turns };
}

export function applyThreadItemEventToItems(items: RoderItem[], event: RoderThreadItemEventKind): RoderItem[] {
  if (event.type === "itemStarted") {
    return upsertRoderItem(items, event.item, mergeStartedItem);
  }
  if (event.type === "itemCompleted") {
    return completeRoderItem(items, event.item);
  }
  const index = activeRoderItemIndex(items, event.itemId);
  if (index === -1) {
    const item = itemFromDelta(nextLocalItemId(items, event.itemId), event.delta);
    return [...items, applyThreadItemDelta(item, event.delta)];
  }
  const nextItems = [...items];
  nextItems[index] = applyThreadItemDelta(nextItems[index], event.delta);
  return nextItems;
}

function completeRoderItem(items: RoderItem[], incoming: RoderItem): RoderItem[] {
  const activeIndex = activeRoderItemIndex(items, incoming.id);
  if (activeIndex !== -1) {
    const nextItems = [...items];
    const existing = nextItems[activeIndex];
    nextItems[activeIndex] = mergeCompletedItem(existing, { ...incoming, id: existing.id });
    return nextItems;
  }

  const exactIndex = items.findIndex((item) => item.id === incoming.id);
  if (exactIndex === -1) {
    return [...items, incoming];
  }

  if (hasMeaningfulItemDifference(items[exactIndex], incoming)) {
    return [...items, { ...incoming, id: nextLocalItemId(items, incoming.id) }];
  }

  return upsertRoderItem(items, incoming, mergeCompletedItem);
}

function upsertRoderItem(
  items: RoderItem[],
  incoming: RoderItem,
  merge: (existing: RoderItem, incoming: RoderItem) => RoderItem,
): RoderItem[] {
  const index = items.findIndex((item) => item.id === incoming.id);
  if (index === -1) {
    return [...items, incoming];
  }
  const nextItems = [...items];
  nextItems[index] = merge(nextItems[index], incoming);
  return nextItems;
}

function mergeStartedItem(existing: RoderItem, incoming: RoderItem): RoderItem {
  return mergeCompletedItem(existing, incoming);
}

function mergeCompletedItem(existing: RoderItem, incoming: RoderItem): RoderItem {
  if (existing.type === "reasoning" && incoming.type === "reasoning") {
    return {
      ...existing,
      summary: incoming.summary?.length ? incoming.summary : existing.summary,
      content: incoming.content?.length ? incoming.content : existing.content,
      status: incoming.status ?? "completed",
    };
  }
  if (existing.type === "toolExecution" && incoming.type === "toolExecution") {
    return {
      ...existing,
      status: incoming.status,
      input: incoming.input ?? existing.input,
      output: incoming.output ?? existing.output,
      error: incoming.error ?? existing.error,
      toolName: incoming.toolName || existing.toolName,
      toolCallId: incoming.toolCallId || existing.toolCallId,
    };
  }
  if (existing.type === "agentMessage" && incoming.type === "agentMessage" && !incoming.text) {
    return { ...existing, phase: incoming.phase ?? existing.phase, status: incoming.status ?? existing.status };
  }
  return incoming;
}

function activeRoderItemIndex(items: RoderItem[], itemId: string): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (protocolItemId(item.id) === itemId && item.status === "inProgress") {
      return index;
    }
  }
  return -1;
}

function nextLocalItemId(items: RoderItem[], itemId: string): string {
  return items.some((item) => protocolItemId(item.id) === itemId)
    ? `${itemId}${duplicateItemIdMarker}${duplicateItemCount(items, itemId) + 1}`
    : itemId;
}

function duplicateItemCount(items: RoderItem[], itemId: string): number {
  return items.filter((item) => protocolItemId(item.id) === itemId).length;
}

function protocolItemId(itemId: string): string {
  const markerIndex = itemId.lastIndexOf(duplicateItemIdMarker);
  return markerIndex === -1 ? itemId : itemId.slice(0, markerIndex);
}

function hasMeaningfulItemDifference(existing: RoderItem, incoming: RoderItem): boolean {
  if (existing.type !== incoming.type) {
    return true;
  }
  if (existing.type === "userMessage" && incoming.type === "userMessage") {
    return existing.text !== incoming.text;
  }
  if (existing.type === "agentMessage" && incoming.type === "agentMessage") {
    return existing.text !== incoming.text || existing.phase !== incoming.phase;
  }
  if (existing.type === "reasoning" && incoming.type === "reasoning") {
    return (
      reasoningBlocksText(existing.content) !== reasoningBlocksText(incoming.content) ||
      reasoningBlocksText(existing.summary) !== reasoningBlocksText(incoming.summary)
    );
  }
  if (existing.type === "error" && incoming.type === "error") {
    return existing.message !== incoming.message;
  }
  if (existing.type === "compaction" && incoming.type === "compaction") {
    return existing.summary !== incoming.summary;
  }
  return false;
}

function itemFromDelta(itemId: string, delta: RoderThreadItemDelta): RoderItem {
  if (delta.type === "agentMessageText") {
    return { id: itemId, type: "agentMessage", text: "", phase: delta.phase, status: "inProgress" };
  }
  if (delta.type === "reasoningText") {
    return {
      id: itemId,
      type: "reasoning",
      content: emptyStringSlots(delta.contentIndex),
      summary: [],
      status: "inProgress",
    };
  }
  return {
    id: itemId,
    type: "reasoning",
    summary: emptyStringSlots(delta.summaryIndex),
    content: [],
    status: "inProgress",
  };
}

function applyThreadItemDelta(item: RoderItem, delta: RoderThreadItemDelta): RoderItem {
  if (item.type === "agentMessage" && delta.type === "agentMessageText") {
    return {
      ...item,
      text: item.text + delta.delta,
      phase: item.phase ?? delta.phase,
      status: "inProgress",
    };
  }
  if (item.type === "reasoning" && delta.type === "reasoningText") {
    const content = item.content ? [...item.content] : [];
    ensureStringSlot(content, delta.contentIndex);
    content[delta.contentIndex] += delta.delta;
    return { ...item, content, status: "inProgress" };
  }
  if (item.type === "reasoning" && delta.type === "reasoningSummaryPartAdded") {
    const summary = item.summary ? [...item.summary] : [];
    ensureStringSlot(summary, delta.summaryIndex);
    return { ...item, summary, status: "inProgress" };
  }
  if (item.type === "reasoning" && delta.type === "reasoningSummaryText") {
    const summary = item.summary ? [...item.summary] : [];
    ensureStringSlot(summary, delta.summaryIndex);
    summary[delta.summaryIndex] += delta.delta;
    return { ...item, summary, status: "inProgress" };
  }
  return applyThreadItemDelta(itemFromDelta(item.id, delta), delta);
}

function emptyStringSlots(index: number): string[] {
  return Array.from({ length: index + 1 }, () => "");
}

function ensureStringSlot(values: string[], index: number): void {
  while (values.length <= index) {
    values.push("");
  }
}

export function messagesFromThread(thread: RoderThread | undefined): ConversationMessage[] {
  if (!thread?.turns || thread.turns.length === 0) {
    return emptyMessages;
  }

  const cachedMessages = messagesByThread.get(thread);
  if (cachedMessages) {
    return cachedMessages;
  }

  const messages = thread.turns.flatMap((turn) => messagesFromTurn(thread.id, turn));
  messagesByThread.set(thread, messages);
  return messages;
}

export function messagesFromTurn(threadId: string, turn: RoderTurn): ConversationMessage[] {
  const messages = localizeDuplicateItemIds(turn.items).reduce<ConversationMessage[]>((messages, item) => {
    for (const message of messagesFromRoderItem(threadId, turn.id, item, turn.status)) {
      upsertConversationMessage(messages, message);
    }
    return messages;
  }, []);
  if (turn.error?.message) {
    upsertConversationMessage(messages, {
      id: `${turn.id}:error`,
      threadId,
      turnId: turn.id,
      role: "system",
      text: turn.error.message,
      status: "failed",
    });
  }
  return completeAssistantStreamsBeforeLaterTools(messages);
}

function localizeDuplicateItemIds(items: RoderItem[]): RoderItem[] {
  const seen: RoderItem[] = [];
  return items.map((item) => {
    const baseId = protocolItemId(item.id);
    const duplicateCount = seen.filter((seenItem) => protocolItemId(seenItem.id) === baseId).length;
    const exactDuplicate = seen.find((seenItem) => seenItem.id === item.id);
    seen.push(item);

    if (
      item.id.includes(duplicateItemIdMarker) ||
      !exactDuplicate ||
      !hasMeaningfulItemDifference(exactDuplicate, item)
    ) {
      return item;
    }

    return { ...item, id: `${baseId}${duplicateItemIdMarker}${duplicateCount + 1}` };
  });
}

export function completeAssistantStreamsBeforeLaterTools(messages: ConversationMessage[]): ConversationMessage[] {
  let sawLaterToolByTurn = new Set<string>();
  const nextMessages = [...messages];
  for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
    const message = nextMessages[index];
    const turnId = message.turnId ?? "";
    if (message.role === "tool") {
      sawLaterToolByTurn = new Set(sawLaterToolByTurn).add(turnId);
      continue;
    }
    if (message.role === "assistant" && message.status === "streaming" && sawLaterToolByTurn.has(turnId)) {
      nextMessages[index] = { ...message, status: "complete" };
    }
  }
  return nextMessages;
}

function hasCurrentAssistantStream(messages: ConversationMessage[]): boolean {
  const lastActiveMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" || message.role === "tool");
  return lastActiveMessage?.role === "assistant" && lastActiveMessage.status === "streaming";
}

export function messagesFromRoderItem(
  threadId: string,
  turnId: string,
  item: RoderItem,
  turnStatus: string,
): ConversationMessage[] {
  const toolMessage = toolMessageFromItem(threadId, turnId, item);
  if (toolMessage) {
    return [toolMessage];
  }

  const text = extractItemText(item);
  if (!text) {
    return [];
  }

  if (item.type === "userMessage") {
    const images = userMessageImages(item);
    return [
      {
        id: item.id,
        threadId,
        turnId,
        role: "user",
        text,
        ...(images.length > 0 ? { images } : {}),
        status: "complete",
      },
    ];
  }
  if (item.type === "agentMessage") {
    const phase = normalizeAssistantPhase(item.phase);
    return [
      {
        id: assistantMessageId(item.id, phase),
        threadId,
        turnId,
        role: "assistant",
        text,
        phase,
        status: itemMessageStatus(item, turnStatus),
      },
    ];
  }
  if (item.type === "reasoning") {
    const phase = "reasoning";
    return [
      {
        id: item.id,
        threadId,
        turnId,
        role: "assistant",
        text,
        phase,
        status: itemMessageStatus(item, turnStatus),
      },
    ];
  }
  if (item.type === "error") {
    return [{ id: item.id, threadId, turnId, role: "system", text, status: "failed" }];
  }
  return [];
}

export function upsertConversationMessage(
  messages: ConversationMessage[],
  incoming: ConversationMessage,
): ConversationMessage[] {
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

function itemMessageStatus(item: RoderItem, turnStatus: string): ConversationMessage["status"] {
  return messageStatusFromProtocolStatus(item.status) ?? messageStatusFromTurnStatus(turnStatus);
}

function messageStatusFromProtocolStatus(status: RoderItem["status"]): ConversationMessage["status"] | undefined {
  if (status === "failed") {
    return "failed";
  }
  if (status === "completed") {
    return "complete";
  }
  if (status === "inProgress") {
    return "streaming";
  }
  return undefined;
}

function messageStatusFromTurnStatus(turnStatus: string): ConversationMessage["status"] {
  if (turnStatus === "failed") {
    return "failed";
  }
  return turnStatus === "inProgress" ? "streaming" : "complete";
}

function extractItemText(item: RoderItem): string {
  if (item.type === "userMessage" || item.type === "agentMessage") {
    return item.text;
  }
  if (item.type === "reasoning") {
    return reasoningBlocksText(item.content) || reasoningBlocksText(item.summary) || "";
  }
  if (item.type === "error") {
    return item.message;
  }
  if (item.type === "compaction") {
    return item.summary;
  }
  return "";
}

function userMessageImages(item: RoderItem): Array<{ imageUrl: string }> {
  if (item.type !== "userMessage") {
    return [];
  }
  return (item.images ?? [])
    .map((image) => image.imageUrl ?? image.image_url ?? "")
    .filter((imageUrl) => imageUrl.trim().length > 0)
    .map((imageUrl) => ({ imageUrl }));
}

function reasoningBlocksText(blocks: string[] | undefined): string {
  return blocks?.filter((block) => block.length > 0).join("\n\n") ?? "";
}

function toolMessageFromItem(threadId: string, turnId: string, item: RoderItem): ConversationMessage | null {
  if (item.type !== "toolExecution") {
    return null;
  }

  const payload: Record<string, unknown> = {};
  const input = asRecord(item.input);
  const toolName = item.toolName || "tool";
  const toolCallId = item.toolCallId || item.id;
  const toolStatus = toolStatusFromItem(item);
  const output = item.error ?? item.output ?? "";
  const detailOutput = rawString(item.output, item.error) ?? "";
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
    toolOutput: toolDetailOutput(toolName, detailOutput) ?? (detailOutput || undefined),
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

function toolStatusFromItem(item: Extract<RoderItem, { type: "toolExecution" }>): "running" | "complete" | "failed" {
  if (item.status === "failed") {
    return "failed";
  }
  if (item.status === "completed") {
    return "complete";
  }
  return "running";
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

function toolSubject(
  toolName: string,
  input: Record<string, unknown>,
  payload: Record<string, unknown>,
): string | undefined {
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
    const query = firstString(
      payload.query,
      payload.pattern,
      payload.regex,
      payload.glob,
      input.query,
      input.pattern,
      input.regex,
      input.glob,
    );
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
  const compactRunnerMatch = /^exit_code=[^\r\n]*\r?\noutput_bytes=[^\r\n]*\r?\n([\s\S]*)$/i.exec(output);
  if (compactRunnerMatch) {
    return compactRunnerMatch[1];
  }

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

function toolActionSummary(
  status: "running" | "complete" | "failed",
  completed: string,
  running: string,
  failed: string,
  subject: string,
): string {
  const verb = status === "failed" ? failed : status === "running" ? running : completed;
  return `${verb} ${subject}`;
}

function compactLine(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function looksLikeResultSummary(value: string): boolean {
  return value.includes("\n") || value.length > 160;
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

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
  return turn.items.flatMap((item) => messageFromItem(threadId, turn.id, item, turn.status));
}

function messageFromItem(threadId: string, turnId: string, item: GodeItem, turnStatus: string): ConversationMessage[] {
  const text = extractItemText(item);
  if (!text) {
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

export function threadTitle(thread: GodeThread | undefined): string {
  if (!thread) {
    return "New Agent";
  }
  return thread.name ?? (thread.preview || "Untitled agent");
}

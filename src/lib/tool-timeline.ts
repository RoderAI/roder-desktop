import type { ConversationMessage } from "@/types/roder";
import { canonicalToolName, usesSummaryAsToolTitle } from "@/lib/tool-display";

export function groupStatus(messages: ConversationMessage[]): "running" | "complete" | "failed" {
  if (messages.some((message) => message.toolStatus === "failed" || message.status === "failed")) {
    return "failed";
  }
  if (messages.some((message) => message.toolStatus === "running" || message.status === "streaming")) {
    return "running";
  }
  return "complete";
}

export function groupStatusLabel(messages: ConversationMessage[]): string {
  return groupStatus(messages) === "failed" ? "Failed" : "Running";
}

export function humanizeToolName(toolName: string | undefined): string {
  const canonicalName = canonicalToolName(toolName);
  if (!canonicalName) {
    return "tool";
  }
  return canonicalName.replace(/[_-]+/g, " ");
}

export function toolStatus(message: ConversationMessage): "running" | "complete" | "failed" {
  return message.toolStatus ?? (message.status === "failed" ? "failed" : "complete");
}

export function toolTextClass(): string {
  return "text-muted-foreground";
}

export function toolTitle(message: ConversationMessage, summary: string): string {
  if (usesSummaryAsToolTitle(message.toolName)) {
    return summary || humanizeToolName(message.toolName);
  }
  return humanizeToolName(message.toolName);
}

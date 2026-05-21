import type { HTMLAttributes } from "react";
import type { ConversationMessage } from "@/types/roder";
import { ChevronRight } from "lucide-react";
import { usesSummaryAsToolTitle } from "@/lib/tool-display";
import { cn } from "@/lib/utils";

export function DisclosureChevron({ groupName }: { groupName: string }): React.JSX.Element {
  return (
    <ChevronRight
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0 text-muted-foreground transition-transform duration-150",
        groupName === "shell-tool" && "group-data-[open]/shell-tool:rotate-90",
        groupName === "tool-group" && "group-data-[open]/tool-group:rotate-90",
        groupName === "tool-activity" && "group-data-[open]/tool-activity:rotate-90",
      )}
    />
  );
}

export function ShimmerText({ className, ...props }: HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  return <span className={cn("ai-shimmer-text", className)} {...props} />;
}

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
  if (!toolName) {
    return "tool";
  }
  return toolName.replace(/[_-]+/g, " ");
}

export function toolStatus(message: ConversationMessage): "running" | "complete" | "failed" {
  return message.toolStatus ?? (message.status === "failed" ? "failed" : "complete");
}

export function toolTextClass(status: ConversationMessage["toolStatus"]): string {
  if (status === "failed") {
    return "text-destructive";
  }
  return "text-muted-foreground";
}

export function toolTitle(message: ConversationMessage, summary: string): string {
  if (usesSummaryAsToolTitle(message.toolName)) {
    return summary || humanizeToolName(message.toolName);
  }
  return humanizeToolName(message.toolName);
}

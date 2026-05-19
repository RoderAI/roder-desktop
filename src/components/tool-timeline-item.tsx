import type { ConversationMessage } from "@/types/roder";
import { cn } from "@/lib/utils";

type ToolTimelineItemProps = {
  message: ConversationMessage;
};

export function ToolTimelineItem({ message }: ToolTimelineItemProps): React.JSX.Element {
  const tone = toolTone(message.toolStatus ?? (message.status === "failed" ? "failed" : "complete"));
  const summary = message.toolSummary || message.text;

  return (
    <div className="flex min-h-7 items-center gap-2 font-mono text-[14px] leading-7">
      <span className="select-none text-[var(--tool-rail)]">└</span>
      <span className={cn("size-2 rounded-full", tone.dot)} />
      <span className={cn("font-semibold", tone.text)}>{message.toolName || "tool"}</span>
      {summary ? (
        <span className="min-w-0 truncate text-muted-foreground" title={summary}>
          {summary}
        </span>
      ) : null}
    </div>
  );
}

function toolTone(status: ConversationMessage["toolStatus"]): { dot: string; text: string } {
  if (status === "failed") {
    return {
      dot: "bg-[var(--tool-error)]",
      text: "text-[var(--tool-error)]",
    };
  }
  if (status === "running") {
    return {
      dot: "bg-[var(--tool-running)]",
      text: "text-[var(--tool-running)]",
    };
  }
  return {
    dot: "bg-[var(--tool-success)]",
    text: "text-[var(--tool-success)]",
  };
}

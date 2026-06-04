import type { ConversationMessage } from "@/types/roder";
import { isShellToolName } from "@/lib/tool-display";
import { toolStatus, toolTextClass, toolTitle } from "@/lib/tool-timeline";
import { cn } from "@/lib/utils";
import type { ToolDisclosureControlProps } from "./tool-disclosure-control";
import { ToolShellItem } from "./tool-shell-item";
import { ShimmerText } from "./tool-timeline-shared";

type ToolTimelineItemProps = ToolDisclosureControlProps & {
  message: ConversationMessage;
};

export function ToolTimelineItem({ message, onOpenChange, open }: ToolTimelineItemProps): React.JSX.Element {
  const status = toolStatus(message);
  const summary = message.toolSummary || message.text;
  const title = toolTitle(message, summary);
  const Title = status === "running" ? ShimmerText : "span";

  if (isShellToolName(message.toolName) && (message.toolInput || message.toolOutput)) {
    return (
      <ToolShellItem message={message} onOpenChange={onOpenChange} open={open} status={status} summary={summary} />
    );
  }

  return (
    <div className="flex min-h-7 min-w-0 items-center gap-2 text-base leading-7">
      <Title className={cn("min-w-0 truncate font-medium", toolTextClass(status))}>{title}</Title>
      {summary && summary !== title ? (
        <span className="min-w-0 truncate text-muted-foreground" title={summary}>
          {summary}
        </span>
      ) : null}
    </div>
  );
}

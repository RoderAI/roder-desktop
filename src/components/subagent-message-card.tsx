import { useId } from "react";
import { ArrowDownToLine, ChevronDown, ChevronRight, ClipboardList, FileText, MessageSquare } from "lucide-react";
import { MessageContent } from "@/components/message-content";
import { SubagentAvatar } from "@/components/subagent-avatar";
import { subagentDisplayName, subagentMessageResult, type SubagentMessage } from "@/lib/subagent-messages";
import { cn } from "@/lib/utils";
import type { SkillDescriptor } from "@/types/roder";

type SubagentMessageCardProps = {
  message: SubagentMessage;
  skills?: SkillDescriptor[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const messageKind = {
  MESSAGE: { label: "Update", Icon: MessageSquare },
  NEW_TASK: { label: "Task", Icon: ClipboardList },
  FINAL_ANSWER: { label: "Result", Icon: FileText },
};

export function SubagentMessageCard({
  message,
  skills,
  open,
  onOpenChange,
}: SubagentMessageCardProps): React.JSX.Element {
  const bodyId = useId();
  const { body, status } = subagentMessageResult(message);
  const { label, Icon } = messageKind[message.kind];
  const agent = subagentDisplayName(message.kind === "NEW_TASK" ? message.recipient : message.sender);
  const expandable = body.length > 420 || body.split("\n").length > 6;
  const expanded = !expandable || open;
  const failed = status === "Failed" || status === "Cancelled" || status === "Interrupted";
  const preview = body
    .trim()
    .split(/\n\s*\n/u)
    .slice(0, 2)
    .join("\n\n")
    .slice(0, 280);

  return (
    <section
      aria-label={`${label} ${message.kind === "NEW_TASK" ? "for" : "from"} ${agent}`}
      className="overflow-hidden rounded-xl bg-card ring-1 ring-border/70"
    >
      <header className="flex min-w-0 items-center gap-2.5 px-3 py-2.5">
        <SubagentAvatar seed={message.kind === "NEW_TASK" ? message.recipient : message.sender} />
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-base font-medium"
            title={message.kind === "NEW_TASK" ? message.recipient : message.sender}
          >
            {agent}
          </p>
          <p className="text-sm text-muted-foreground">Subagent {label.toLowerCase()}</p>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1 text-sm font-medium text-muted-foreground",
            failed && "bg-destructive/10 text-destructive",
          )}
        >
          <Icon aria-hidden="true" className="size-3.5" />
          {status || label}
        </span>
      </header>
      <div id={bodyId} className="border-t border-border/60 px-3 py-3">
        {expanded ? (
          body.trim() ? (
            <MessageContent skills={skills} text={body} />
          ) : (
            <p className="text-base text-muted-foreground">No message content.</p>
          )
        ) : (
          <div className="line-clamp-3 max-h-24 break-words text-foreground/80">
            <MessageContent skills={skills} text={preview || "Open the full message to read this update."} />
          </div>
        )}
        {expandable && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={`${open ? "Collapse" : "Show full"} ${label.toLowerCase()} from ${agent}`}
            onClick={() => onOpenChange(!open)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-sm font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {open ? <ChevronDown className="size-3.5" /> : <ArrowDownToLine className="size-3.5" />}
            {open ? "Show less" : "Show full message"}
          </button>
        )}
      </div>
      <details className="group/details border-t border-border/60 px-3 py-2 text-sm text-muted-foreground">
        <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-md py-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronRight aria-hidden="true" className="size-3 group-open/details:rotate-90" />
          Routing details
        </summary>
        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 pb-1">
          <dt>From</dt>
          <dd className="break-all font-mono">{message.sender}</dd>
          <dt>To</dt>
          <dd className="break-all font-mono">{message.recipient}</dd>
          <dt>Type</dt>
          <dd className="font-mono">{message.kind}</dd>
        </dl>
      </details>
    </section>
  );
}

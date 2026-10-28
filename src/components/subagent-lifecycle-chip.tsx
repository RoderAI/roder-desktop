import { Check, CircleDot, X } from "lucide-react";
import { SubagentAvatar } from "@/components/subagent-avatar";
import { subagentLifecycleLabel } from "@/lib/subagent-traces";
import { cn } from "@/lib/utils";
import type { SubagentLifecycleEvent } from "@/types/roder";

export function SubagentLifecycleChip({ event }: { event: SubagentLifecycleEvent }): React.JSX.Element {
  const finished = event.verb === "finished" || event.verb === "failed";
  return (
    <div className="flex min-h-8 min-w-0 items-center gap-2.5 px-3 text-base">
      <SubagentAvatar seed={`${event.role}:${event.title}`} className="size-5" />
      <span className={cn("min-w-0 truncate font-medium", finished ? "text-muted-foreground" : "text-foreground")}>
        {event.title}
      </span>
      <span className="shrink-0 font-normal text-muted-foreground" title={subagentLifecycleLabel(event)}>
        <span className={cn("inline-flex items-center gap-1.5 text-sm", event.verb === "failed" && "text-destructive")}>
          {event.verb === "failed" ? (
            <X className="size-3" />
          ) : finished ? (
            <Check className="size-3" />
          ) : (
            <CircleDot className="size-3" />
          )}
          {event.verb === "started working"
            ? "Working"
            : event.verb === "finished"
              ? "Finished"
              : event.verb === "failed"
                ? "Failed"
                : "Updated"}
        </span>
      </span>
    </div>
  );
}

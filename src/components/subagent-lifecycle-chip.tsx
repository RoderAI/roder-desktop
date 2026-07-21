import { SubagentAvatar } from "@/components/subagents-panel";
import { subagentLifecycleLabel } from "@/lib/subagent-traces";
import { cn } from "@/lib/utils";
import type { SubagentLifecycleEvent } from "@/types/roder";

export function SubagentLifecycleChip({ event }: { event: SubagentLifecycleEvent }): React.JSX.Element {
  const finished = event.verb === "finished" || event.verb === "failed";
  return (
    <div className="flex min-h-7 min-w-0 items-center gap-2 pl-5 text-base leading-7">
      <SubagentAvatar seed={`${event.role}:${event.title}`} className="size-5" />
      <span className={cn("min-w-0 truncate font-medium", finished ? "text-muted-foreground" : "text-foreground")}>
        {event.title}
      </span>
      <span className="min-w-0 truncate font-normal text-muted-foreground" title={subagentLifecycleLabel(event)}>
        — {event.verb}
      </span>
    </div>
  );
}

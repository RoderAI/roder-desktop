import type { HTMLAttributes } from "react";
import { ChevronRight } from "lucide-react";
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

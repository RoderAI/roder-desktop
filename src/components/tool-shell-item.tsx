import type { ConversationMessage } from "@/types/roder";
import { Collapsible } from "@base-ui/react/collapsible";
import { cn } from "@/lib/utils";
import { toolTextClass, toolTitle } from "@/lib/tool-timeline";
import type { ToolDisclosureControlProps } from "./tool-disclosure-control";
import { DisclosureChevron, ShimmerText, ToolFailureDot } from "./tool-timeline-shared";

type ToolShellItemProps = ToolDisclosureControlProps & {
  message: ConversationMessage;
  status: "running" | "complete" | "failed";
  summary: string;
};

export function ToolShellItem({ message, onOpenChange, open, status, summary }: ToolShellItemProps): React.JSX.Element {
  const title = toolTitle(message, summary);
  const Title = status === "running" ? ShimmerText : "span";

  return (
    <Collapsible.Root className="group/shell-tool pl-5 text-base leading-7" onOpenChange={onOpenChange} open={open}>
      <Collapsible.Trigger
        className="flex min-h-7 w-full min-w-0 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        type="button"
      >
        <ToolFailureDot failed={status === "failed"} />
        <Title className={cn("min-w-0 truncate font-medium", toolTextClass())}>{title}</Title>
        <DisclosureChevron groupName="shell-tool" />
      </Collapsible.Trigger>
      <Collapsible.Panel keepMounted className="tool-disclosure-panel pl-5 text-base leading-7 text-muted-foreground">
        <div className="tool-shell-output py-1 font-mono text-base leading-7">
          {message.toolInput ? (
            <pre className="m-0 whitespace-pre-wrap break-words text-foreground">{`$ ${message.toolInput}`}</pre>
          ) : null}
          {message.toolOutput ? (
            <pre className="m-0 mt-1 whitespace-pre-wrap break-words text-muted-foreground">{message.toolOutput}</pre>
          ) : null}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

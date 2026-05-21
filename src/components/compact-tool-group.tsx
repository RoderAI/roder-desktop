import type { ConversationMessage } from "@/types/roder";
import type { ToolGroupKind } from "@/lib/tool-display";
import { Collapsible } from "@base-ui/react/collapsible";
import { cn } from "@/lib/utils";
import { DisclosureChevron, groupStatus, groupStatusLabel, ShimmerText, toolTextClass } from "./tool-timeline-shared";

export function CompactToolGroup({ kind, messages }: { kind: ToolGroupKind; messages: ConversationMessage[] }): React.JSX.Element {
  const status = groupStatus(messages);
  const title = groupTitle(kind, messages);
  const Title = status === "running" ? ShimmerText : "span";

  return (
    <Collapsible.Root className="group/tool-group text-base leading-7">
      <Collapsible.Trigger
        className="flex min-h-7 w-full min-w-0 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        type="button"
      >
        <Title className={cn("min-w-0 truncate font-medium", toolTextClass(status))}>{title}</Title>
        <DisclosureChevron groupName="tool-group" />
        {status !== "complete" ? (
          <span className="shrink-0 text-muted-foreground">{groupStatusLabel(messages)}</span>
        ) : null}
      </Collapsible.Trigger>
      <Collapsible.Panel keepMounted className="tool-disclosure-panel pl-5 text-base leading-7 text-muted-foreground">
        <ul className="space-y-0.5 py-1">
          {messages.map((message) => (
            <li className="min-w-0 truncate" key={message.toolCallId || message.id} title={message.toolSubject || message.toolSummary || message.text}>
              {groupItemLabel(kind, message)}
            </li>
          ))}
        </ul>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

function groupTitle(kind: ToolGroupKind, messages: ConversationMessage[]): string {
  const status = groupStatus(messages);
  if (kind === "search") {
    const verb = status === "failed" ? "Failed to search" : status === "running" ? "Searching" : "Searched";
    return `${verb} ${messages.length} ${messages.length === 1 ? "Pattern" : "Patterns"}`;
  }

  const verb = status === "failed" ? "Failed to read" : status === "running" ? "Reading" : "Read";
  const noun = kind === "readFile" ? "File" : "Skill";
  return `${verb} ${messages.length} ${messages.length === 1 ? noun : `${noun}s`}`;
}

function groupItemLabel(kind: ToolGroupKind, message: ConversationMessage): string {
  if (message.toolSubject) {
    return message.toolSubject;
  }
  return kind === "search" ? "pattern" : kind === "readFile" ? "file" : "Skill";
}

import type { ActivitySummary, TranscriptToolEntry } from "@/lib/tool-message-groups";
import { Collapsible } from "@base-ui/react/collapsible";
import { Search, TerminalSquare } from "lucide-react";
import { CompactToolGroup } from "./compact-tool-group";
import { ToolTimelineItem } from "./tool-timeline-item";
import { DisclosureChevron } from "./tool-timeline-shared";

export function ToolActivityGroup({
  entries,
  summary,
}: {
  entries: TranscriptToolEntry[];
  summary: ActivitySummary;
}): React.JSX.Element {
  const Icon = summary.commands > 0 ? TerminalSquare : Search;

  return (
    <Collapsible.Root className="group/tool-activity text-base leading-7">
      <Collapsible.Trigger
        className="flex min-h-8 w-full min-w-0 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        type="button"
      >
        <Icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-medium text-muted-foreground">{summary.label}</span>
        <DisclosureChevron groupName="tool-activity" />
      </Collapsible.Trigger>
      <Collapsible.Panel keepMounted className="tool-disclosure-panel pl-8 text-base leading-7 text-muted-foreground">
        <div className="py-1">
          {entries.map((entry) => (
            <ToolEntryDetail entry={entry} key={toolEntryKey(entry)} />
          ))}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

function ToolEntryDetail({ entry }: { entry: TranscriptToolEntry }): React.JSX.Element {
  if (entry.kind === "readFileGroup") {
    return <CompactToolGroup kind="readFile" messages={entry.messages} />;
  }
  if (entry.kind === "readSkillGroup") {
    return <CompactToolGroup kind="readSkill" messages={entry.messages} />;
  }
  if (entry.kind === "searchGroup") {
    return <CompactToolGroup kind="search" messages={entry.messages} />;
  }
  if (entry.message.role === "tool") {
    return <ToolTimelineItem message={entry.message} />;
  }
  return <div className="min-w-0 truncate">{entry.message.text}</div>;
}

function toolEntryKey(entry: TranscriptToolEntry): string {
  if (entry.kind === "message") {
    return entry.message.id;
  }
  return entry.id;
}

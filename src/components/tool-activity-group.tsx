import type { ActivitySummary, TranscriptToolEntry } from "@/lib/tool-message-groups";
import { Collapsible } from "@base-ui/react/collapsible";
import { CompactToolGroup } from "./compact-tool-group";
import type { ToolDisclosureControlProps } from "./tool-disclosure-control";
import { ToolTimelineItem } from "./tool-timeline-item";
import { DisclosureChevron } from "./tool-timeline-shared";

const emptyDisclosureControl: ToolDisclosureControlProps = {};

export function ToolActivityGroup({
  getEntryDisclosureControl,
  onOpenChange,
  open,
  entries,
  summary,
}: {
  entries: TranscriptToolEntry[];
  getEntryDisclosureControl?: (entry: TranscriptToolEntry) => ToolDisclosureControlProps;
  summary: ActivitySummary;
} & ToolDisclosureControlProps): React.JSX.Element {
  return (
    <Collapsible.Root className="group/tool-activity text-base leading-7" onOpenChange={onOpenChange} open={open}>
      <Collapsible.Trigger
        className="flex min-h-8 w-full min-w-0 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        type="button"
      >
        <span className="min-w-0 truncate font-medium text-muted-foreground">{summary.label}</span>
        <DisclosureChevron groupName="tool-activity" />
      </Collapsible.Trigger>
      <Collapsible.Panel keepMounted className="tool-disclosure-panel pl-5 text-base leading-7 text-muted-foreground">
        <div className="py-1">
          {entries.map((entry) => (
            <ToolEntryDetail
              disclosureControl={getEntryDisclosureControl?.(entry)}
              entry={entry}
              key={toolEntryKey(entry)}
            />
          ))}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

function ToolEntryDetail({
  disclosureControl = emptyDisclosureControl,
  entry,
}: {
  disclosureControl?: ToolDisclosureControlProps;
  entry: TranscriptToolEntry;
}): React.JSX.Element {
  if (entry.kind === "readFileGroup") {
    return <CompactToolGroup kind="readFile" messages={entry.messages} {...disclosureControl} />;
  }
  if (entry.kind === "readSkillGroup") {
    return <CompactToolGroup kind="readSkill" messages={entry.messages} {...disclosureControl} />;
  }
  if (entry.kind === "searchGroup") {
    return <CompactToolGroup kind="search" messages={entry.messages} {...disclosureControl} />;
  }
  if (entry.message.role === "tool") {
    return <ToolTimelineItem message={entry.message} {...disclosureControl} />;
  }
  return <div className="min-w-0 truncate">{entry.message.text}</div>;
}

function toolEntryKey(entry: TranscriptToolEntry): string {
  if (entry.kind === "message") {
    return entry.message.id;
  }
  return entry.id;
}

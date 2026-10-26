import type { ActivitySummary, TranscriptToolEntry } from "@/lib/tool-message-groups";
import { Collapsible } from "@base-ui/react/collapsible";
import { useRef } from "react";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { followToolActivity, visibleToolActivityCount } from "@/lib/tool-activity-scroll";
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
  live = false,
  summary,
}: {
  entries: TranscriptToolEntry[];
  live?: boolean;
  getEntryDisclosureControl?: (entry: TranscriptToolEntry) => ToolDisclosureControlProps;
  summary: ActivitySummary;
} & ToolDisclosureControlProps): React.JSX.Element {
  return (
    <Collapsible.Root
      className="group/tool-activity text-base leading-5"
      onOpenChange={onOpenChange}
      open={open ?? live}
    >
      <Collapsible.Trigger
        className="flex min-h-6 w-full min-w-0 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        type="button"
      >
        <span className="min-w-0 truncate font-medium text-muted-foreground">
          {live ? `Recent tools (${entries.length})` : summary.label}
        </span>
        <DisclosureChevron groupName="tool-activity" />
      </Collapsible.Trigger>
      <Collapsible.Panel className="tool-disclosure-panel text-base leading-5 text-muted-foreground">
        <ToolActivityList
          key={live ? "live" : "history"}
          entries={entries}
          getEntryDisclosureControl={getEntryDisclosureControl}
          live={live}
        />
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

function ToolActivityList({
  entries,
  getEntryDisclosureControl,
  live,
}: {
  entries: TranscriptToolEntry[];
  getEntryDisclosureControl?: (entry: TranscriptToolEntry) => ToolDisclosureControlProps;
  live: boolean;
}): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  useMountEffect(() => {
    if (!live || !viewportRef.current || !contentRef.current) return;
    return followToolActivity(viewportRef.current, contentRef.current);
  });
  // The bounded scroll region needs its own keyboard focus target.
  /* oxlint-disable jsx-a11y/no-noninteractive-tabindex */
  return (
    <div
      ref={viewportRef}
      className="overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ maxHeight: `${visibleToolActivityCount * 1.5}rem` }}
      role="region"
      aria-label={live ? "Recent tools" : "Earlier tools"}
      tabIndex={0}
    >
      <div ref={contentRef}>
        {entries.map((entry) => (
          <ToolEntryDetail
            disclosureControl={getEntryDisclosureControl?.(entry)}
            entry={entry}
            key={toolEntryKey(entry)}
          />
        ))}
      </div>
    </div>
  );
  /* oxlint-enable jsx-a11y/no-noninteractive-tabindex */
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

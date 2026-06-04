import type { ConversationMessage } from "@/types/roder";
import {
  compactToolGroup,
  isCommandActivityTool,
  isExplorationActivityTool,
  isFileActivityTool,
  isHiddenTranscriptTool,
  isSearchActivityTool,
  type ToolGroupDescriptor,
} from "@/lib/tool-display";

export type ActivitySummary = {
  commands: number;
  files: number;
  label: string;
  searches: number;
};

export type TranscriptToolEntry =
  | {
      kind: "message";
      message: ConversationMessage;
    }
  | {
      id: string;
      kind: "readFileGroup";
      messages: ConversationMessage[];
    }
  | {
      id: string;
      kind: "readSkillGroup";
      messages: ConversationMessage[];
    }
  | {
      id: string;
      kind: "searchGroup";
      messages: ConversationMessage[];
    };

export type TranscriptMessageEntry =
  | TranscriptToolEntry
  | {
      id: string;
      kind: "activityGroup";
      entries: TranscriptToolEntry[];
      summary: ActivitySummary;
    };

export type ToolMessageGroupingOptions = {
  activeTurnId?: string;
};

export function groupToolMessagesForTranscript(
  messages: ConversationMessage[],
  options: ToolMessageGroupingOptions = {},
): TranscriptMessageEntry[] {
  const visibleMessages = messages.filter(
    (message) => !(message.role === "tool" && isHiddenTranscriptTool(message.toolName)),
  );
  return groupCompletedActivityRuns(groupAdjacentToolMessages(visibleMessages), options);
}

function groupAdjacentToolMessages(messages: ConversationMessage[]): TranscriptToolEntry[] {
  const entries: TranscriptToolEntry[] = [];
  let pendingGroup: {
    kind: "readFileGroup" | "readSkillGroup" | "searchGroup";
    messages: ConversationMessage[];
    toolFamily: ToolGroupDescriptor["family"];
  } | null = null;

  const flushGroup = () => {
    if (!pendingGroup) {
      return;
    }
    if (pendingGroup.messages.length === 1) {
      entries.push({ kind: "message", message: pendingGroup.messages[0] });
      pendingGroup = null;
      return;
    }
    entries.push({
      id: toolGroupId(pendingGroup.toolFamily, pendingGroup.messages),
      kind: pendingGroup.kind,
      messages: pendingGroup.messages,
    });
    pendingGroup = null;
  };

  for (const message of messages) {
    const groupKind = message.role === "tool" ? compactToolGroup(message.toolName) : null;
    if (groupKind) {
      if (pendingGroup && pendingGroup.kind !== groupKind.entryKind) {
        flushGroup();
      }
      pendingGroup ??= { kind: groupKind.entryKind, messages: [], toolFamily: groupKind.family };
      pendingGroup.messages.push(message);
      continue;
    }

    flushGroup();
    entries.push({ kind: "message", message });
  }

  flushGroup();
  return entries;
}

function groupCompletedActivityRuns(
  entries: TranscriptToolEntry[],
  options: ToolMessageGroupingOptions,
): TranscriptMessageEntry[] {
  const grouped: TranscriptMessageEntry[] = [];
  let pendingEntries: TranscriptToolEntry[] = [];

  const flushActivity = () => {
    if (pendingEntries.length === 0) {
      return;
    }

    const summary = summarizeActivity(pendingEntries);
    if (shouldCollapseActivity(pendingEntries, summary)) {
      const messages = pendingEntries.flatMap(toolMessagesFromEntry);
      grouped.push({
        id: activityGroupId(messages),
        kind: "activityGroup",
        summary,
        entries: pendingEntries,
      });
    } else {
      grouped.push(...pendingEntries);
    }

    pendingEntries = [];
  };

  for (const entry of entries) {
    if (isCompletedToolEntry(entry, options)) {
      pendingEntries.push(entry);
      continue;
    }

    flushActivity();
    grouped.push(entry);
  }

  flushActivity();
  return grouped;
}

function toolGroupId(toolFamily: ToolGroupDescriptor["family"], messages: ConversationMessage[]): string {
  const firstId = toolMessageStableId(messages[0]);
  const lastId = toolMessageStableId(messages[messages.length - 1]);
  return `tool-group:${toolFamily}:${firstId}:${lastId}`;
}

function activityGroupId(messages: ConversationMessage[]): string {
  const firstId = toolMessageStableId(messages[0]);
  const lastId = toolMessageStableId(messages[messages.length - 1]);
  return `activity-group:${firstId}:${lastId}`;
}

function toolMessageStableId(message: ConversationMessage): string {
  return message.toolCallId || message.id;
}

function isCompletedToolEntry(entry: TranscriptToolEntry, options: ToolMessageGroupingOptions): boolean {
  const messages = toolMessagesFromEntry(entry);
  return (
    messages.length > 0 &&
    messages.every(
      (message) =>
        isExplorationActivity(message) &&
        !(options.activeTurnId && message.turnId === options.activeTurnId) &&
        message.toolStatus !== "running" &&
        message.status !== "streaming",
    )
  );
}

function shouldCollapseActivity(entries: TranscriptToolEntry[], summary: ActivitySummary): boolean {
  const toolCount = entries.flatMap(toolMessagesFromEntry).length;
  return toolCount > 1 && (summary.files > 0 || summary.searches > 0 || summary.commands > 0);
}

function summarizeActivity(entries: TranscriptToolEntry[]): ActivitySummary {
  const messages = entries.flatMap(toolMessagesFromEntry);
  const files = messages.filter((message) => isFileActivityTool(message.toolName)).length;
  const searches = messages.filter((message) => isSearchActivityTool(message.toolName)).length;
  const commands = messages.filter((message) => isCommandActivityTool(message.toolName)).length;
  return {
    commands,
    files,
    label: activityLabel({ commands, files, searches }),
    searches,
  };
}

function activityLabel(summary: Pick<ActivitySummary, "commands" | "files" | "searches">): string {
  const explored = [
    summary.files > 0 ? `${summary.files} ${plural(summary.files, "file")}` : "",
    summary.searches > 0 ? `${summary.searches} ${plural(summary.searches, "search", "searches")}` : "",
  ].filter(Boolean);
  const ran = summary.commands > 0 ? `ran ${summary.commands} ${plural(summary.commands, "command")}` : "";

  if (explored.length > 0) {
    return `Explored ${[...explored, ran].filter(Boolean).join(", ")}`;
  }
  if (ran) {
    return capitalize(ran);
  }
  return "Used tools";
}

function plural(count: number, singular: string, pluralValue = `${singular}s`): string {
  return count === 1 ? singular : pluralValue;
}

function capitalize(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function toolMessagesFromEntry(entry: TranscriptToolEntry): ConversationMessage[] {
  if (entry.kind === "message") {
    return entry.message.role === "tool" ? [entry.message] : [];
  }
  return entry.messages;
}

function isExplorationActivity(message: ConversationMessage): boolean {
  return isExplorationActivityTool(message.toolName);
}

import type { ConversationMessage } from "@/types/roder";
import {
  compactToolGroup,
  isCommandActivityTool,
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
      live?: boolean;
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
  return groupToolActivityRuns(groupAdjacentToolMessages(visibleMessages), options);
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
      if (
        pendingGroup &&
        (pendingGroup.kind !== groupKind.entryKind || pendingGroup.messages[0].turnId !== message.turnId)
      ) {
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

function groupToolActivityRuns(
  entries: TranscriptToolEntry[],
  options: ToolMessageGroupingOptions,
): TranscriptMessageEntry[] {
  const grouped: TranscriptMessageEntry[] = [];
  let pendingEntries: TranscriptToolEntry[] = [];

  const flushActivity = (atTail = false) => {
    if (pendingEntries.length === 0) {
      return;
    }

    const toolEntries = pendingEntries.filter((entry) => toolMessagesFromEntry(entry).length > 0);
    const summary = summarizeActivity(toolEntries);
    const messages = toolEntries.flatMap(toolMessagesFromEntry);
    const live =
      atTail &&
      messages.some(
        (message) =>
          message.toolStatus === "running" ||
          message.status === "streaming" ||
          Boolean(options.activeTurnId && message.turnId === options.activeTurnId),
      );
    const activity: TranscriptMessageEntry | undefined =
      live || messages.length > 1
        ? {
            id: live ? `live-activity-group:${toolMessageStableId(messages[0])}` : activityGroupId(messages),
            kind: "activityGroup",
            ...(live ? { live: true } : {}),
            summary,
            entries: live ? messages.map((message) => ({ kind: "message" as const, message })) : toolEntries,
          }
        : toolEntries[0];
    // Keep assistant text visible; put the shared activity at the last tool's position.
    const lastTool = toolEntries.at(-1);
    for (const entry of pendingEntries) {
      if (toolMessagesFromEntry(entry).length === 0) grouped.push(entry);
      else if (entry === lastTool && activity) grouped.push(activity);
    }

    pendingEntries = [];
  };

  for (const entry of entries) {
    if (entry.kind === "message" && entry.message.role === "user") {
      flushActivity();
      grouped.push(entry);
      continue;
    }
    pendingEntries.push(entry);
  }

  flushActivity(true);
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

function summarizeActivity(entries: TranscriptToolEntry[]): ActivitySummary {
  let files = 0;
  let searches = 0;
  let commands = 0;
  for (const entry of entries) {
    for (const message of toolMessagesFromEntry(entry)) {
      if (isFileActivityTool(message.toolName)) {
        files += 1;
      }
      if (isSearchActivityTool(message.toolName)) {
        searches += 1;
      }
      if (isCommandActivityTool(message.toolName)) {
        commands += 1;
      }
    }
  }
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

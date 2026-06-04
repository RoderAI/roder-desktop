import type { ConversationMessage } from "@/types/roder";
import { reviewTurnChangeLabel, type ReviewTurnChangeSummary } from "@/lib/review-changes";
import { groupToolMessagesForTranscript, type TranscriptMessageEntry } from "@/lib/tool-message-groups";

export type TranscriptRow =
  | TranscriptEntryRow
  | {
      key: string;
      summary: ReviewTurnChangeSummary;
      kind: "turnReviewChanges";
      turnId: string;
    }
  | {
      key: "thread-working-indicator";
      kind: "working";
    };

export type TranscriptEntryRow = {
  disclosureKey?: string;
  entry: TranscriptMessageEntry;
  entryIsTool: boolean;
  key: string;
  kind: "entry";
  nextIsTool: boolean;
  previousIsTool: boolean;
  turnId?: string;
};

export type TranscriptRowsOptions = {
  activeTurnId?: string;
  messages: ConversationMessage[];
  showWorkingIndicator?: boolean;
  turnChangeSummaries?: Record<string, ReviewTurnChangeSummary>;
};

export type TranscriptRowsSearchTextOptions = {
  excludedRowKeys?: ReadonlySet<string>;
};

export function buildTranscriptRows({
  activeTurnId,
  messages,
  showWorkingIndicator = false,
  turnChangeSummaries = {},
}: TranscriptRowsOptions): TranscriptRow[] {
  const entries = groupToolMessagesForTranscript(messages, { activeTurnId });
  const turnBoundaryIndexes = findTurnBoundaryIndexes(entries);
  const rows: TranscriptRow[] = [];

  entries.forEach((entry, index) => {
    const turnId = transcriptEntryTurnId(entry);
    const key = transcriptEntryKey(entry);
    const disclosureKey = transcriptEntryDisclosureKey(entry, key);
    const entryRow: TranscriptEntryRow = {
      ...(disclosureKey ? { disclosureKey } : {}),
      entry,
      entryIsTool: isTranscriptToolEntry(entry),
      key,
      kind: "entry",
      nextIsTool: isTranscriptToolEntry(entries[index + 1]),
      previousIsTool: isTranscriptToolEntry(entries[index - 1]),
      ...(turnId ? { turnId } : {}),
    };

    rows.push(entryRow);

    const turnChangeSummary = turnId ? turnChangeSummaries[turnId] : undefined;
    if (turnId && turnChangeSummary && turnChangeSummary.files.length > 0 && turnBoundaryIndexes.has(index)) {
      rows.push({
        key: `turn-review-changes:${turnId}`,
        kind: "turnReviewChanges",
        summary: turnChangeSummary,
        turnId,
      });
    }
  });

  if (showWorkingIndicator) {
    rows.push({
      key: "thread-working-indicator",
      kind: "working",
    });
  }

  return rows;
}

export function transcriptEntryKey(entry: TranscriptMessageEntry): string {
  if (entry.kind === "message") {
    return `message:${entry.message.id}`;
  }
  return entry.id;
}

export function transcriptEntryDisclosureKey(entry: TranscriptMessageEntry, key: string): string | undefined {
  if (
    entry.kind === "activityGroup" ||
    entry.kind === "readFileGroup" ||
    entry.kind === "readSkillGroup" ||
    entry.kind === "searchGroup" ||
    (entry.kind === "message" && entry.message.role === "tool")
  ) {
    return `disclosure:${key}`;
  }
  return undefined;
}

export function transcriptNestedDisclosureKey(
  parentDisclosureKey: string,
  entry: TranscriptMessageEntry,
): string | undefined {
  const entryKey = transcriptEntryKey(entry);
  const disclosureKey = transcriptEntryDisclosureKey(entry, entryKey);
  return disclosureKey ? `${parentDisclosureKey}:nested:${disclosureKey}` : undefined;
}

export function transcriptRowDisclosureKeys(row: TranscriptRow): string[] {
  if (row.kind !== "entry" || !row.disclosureKey) {
    return [];
  }
  if (row.entry.kind !== "activityGroup") {
    return [row.disclosureKey];
  }
  const parentDisclosureKey = row.disclosureKey;
  return [
    parentDisclosureKey,
    ...row.entry.entries.flatMap((entry) => {
      const nestedKey = transcriptNestedDisclosureKey(parentDisclosureKey, entry);
      return nestedKey ? [nestedKey] : [];
    }),
  ];
}

export function transcriptRowsSearchText(rows: TranscriptRow[], options: TranscriptRowsSearchTextOptions = {}): string {
  return rows
    .flatMap((row) => {
      if (options.excludedRowKeys?.has(row.key)) {
        return [];
      }
      const searchText = transcriptRowSearchText(row);
      return searchText ? [searchText] : [];
    })
    .join("\n\n");
}

export function isTranscriptToolEntry(entry: TranscriptMessageEntry | undefined): boolean {
  return (
    entry?.kind === "activityGroup" ||
    entry?.kind === "readFileGroup" ||
    entry?.kind === "readSkillGroup" ||
    entry?.kind === "searchGroup" ||
    entry?.message.role === "tool"
  );
}

export function transcriptEntryTurnId(entry: TranscriptMessageEntry): string | undefined {
  if (entry.kind === "message") {
    return entry.message.turnId;
  }
  if (entry.kind === "activityGroup") {
    return entry.entries.flatMap(transcriptEntryMessages).find((message) => message.turnId)?.turnId;
  }
  return entry.messages.find((message) => message.turnId)?.turnId;
}

function findTurnBoundaryIndexes(entries: TranscriptMessageEntry[]): Set<number> {
  const boundaries = new Set<number>();
  let nextTurnId: string | undefined;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const turnId = transcriptEntryTurnId(entries[index]);
    if (!turnId) {
      continue;
    }
    if (!nextTurnId || nextTurnId !== turnId) {
      boundaries.add(index);
    }
    nextTurnId = turnId;
  }

  return boundaries;
}

function transcriptEntryMessages(entry: TranscriptMessageEntry | undefined): ConversationMessage[] {
  if (!entry) {
    return [];
  }
  if (entry.kind === "message") {
    return [entry.message];
  }
  if (entry.kind === "activityGroup") {
    return entry.entries.flatMap(transcriptEntryMessages);
  }
  return entry.messages;
}

function transcriptRowSearchText(row: TranscriptRow): string {
  if (row.kind === "turnReviewChanges") {
    return [reviewTurnChangeLabel(row.summary), `+${row.summary.additions} -${row.summary.deletions}`].join("\n");
  }
  if (row.kind === "working") {
    return "Agent is working";
  }
  return transcriptEntrySearchText(row.entry);
}

function transcriptEntrySearchText(entry: TranscriptMessageEntry): string {
  if (entry.kind === "activityGroup") {
    return [entry.summary.label, ...entry.entries.map(transcriptEntrySearchText)].filter(Boolean).join("\n");
  }
  if (entry.kind === "message") {
    return messageSearchText(entry.message);
  }
  return entry.messages
    .flatMap((message) => {
      const searchText = messageSearchText(message);
      return searchText ? [searchText] : [];
    })
    .join("\n");
}

function messageSearchText(message: ConversationMessage): string {
  return [
    message.toolSummary,
    message.toolSubject,
    message.toolInput ? `$ ${message.toolInput}` : "",
    message.toolOutput,
    message.text,
  ]
    .filter(Boolean)
    .join("\n");
}

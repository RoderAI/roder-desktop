import type { ConversationMessage, SubagentLifecycleEvent } from "@/types/roder";
import { reviewTurnChangeLabel, type ReviewTurnChangeSummary } from "@/lib/review-changes";
import { groupToolMessagesForTranscript, type TranscriptMessageEntry } from "@/lib/tool-message-groups";

export type TranscriptRow =
  | TranscriptEntryRow
  | {
      key: string;
      event: SubagentLifecycleEvent;
      kind: "subagentLifecycle";
    }
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
  subagentLifecycleEvents?: readonly SubagentLifecycleEvent[];
  turnChangeSummaries?: Record<string, ReviewTurnChangeSummary>;
};

export type TranscriptRowsSearchTextOptions = {
  excludedRowKeys?: ReadonlySet<string>;
};

export function buildTranscriptRows({
  activeTurnId,
  messages,
  showWorkingIndicator = false,
  subagentLifecycleEvents = [],
  turnChangeSummaries = {},
}: TranscriptRowsOptions): TranscriptRow[] {
  const entries = groupToolMessagesForTranscript(messages, { activeTurnId });
  const turnBoundaryIndexes = findTurnBoundaryIndexes(entries);
  const lifecycleByAfterMessageId = groupLifecycleEventsByAnchor(subagentLifecycleEvents);
  const rows: TranscriptRow[] = [];

  for (const event of lifecycleByAfterMessageId.get(null) ?? []) {
    rows.push(subagentLifecycleRow(event));
  }

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

    for (const messageId of transcriptEntryMessageIds(entry)) {
      for (const event of lifecycleByAfterMessageId.get(messageId) ?? []) {
        rows.push(subagentLifecycleRow(event));
      }
    }

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

  // Events anchored to messages that are no longer present (e.g. local
  // transcript offsets) still need to appear at the end of the transcript.
  for (const event of orphanLifecycleEvents(subagentLifecycleEvents, messages)) {
    rows.push(subagentLifecycleRow(event));
  }

  if (showWorkingIndicator) {
    rows.push({
      key: "thread-working-indicator",
      kind: "working",
    });
  }

  return rows;
}

function subagentLifecycleRow(event: SubagentLifecycleEvent): TranscriptRow {
  return {
    key: `subagent-lifecycle:${event.id}`,
    kind: "subagentLifecycle",
    event,
  };
}

function groupLifecycleEventsByAnchor(
  events: readonly SubagentLifecycleEvent[],
): Map<string | null, SubagentLifecycleEvent[]> {
  const grouped = new Map<string | null, SubagentLifecycleEvent[]>();
  for (const event of events) {
    const key = event.afterMessageId;
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(event);
    } else {
      grouped.set(key, [event]);
    }
  }
  return grouped;
}

function transcriptEntryMessageIds(entry: TranscriptMessageEntry): string[] {
  if (entry.kind === "message") {
    return [entry.message.id];
  }
  if (entry.kind === "activityGroup") {
    return entry.entries.flatMap(transcriptEntryMessageIds);
  }
  return entry.messages.map((message) => message.id);
}

function orphanLifecycleEvents(
  events: readonly SubagentLifecycleEvent[],
  messages: readonly ConversationMessage[],
): SubagentLifecycleEvent[] {
  const messageIds = new Set(messages.map((message) => message.id));
  return events.filter((event) => event.afterMessageId != null && !messageIds.has(event.afterMessageId));
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
      const searchText = cachedTranscriptRowSearchText(row);
      return searchText ? [searchText] : [];
    })
    .join("\n\n");
}

// Row identity is preserved across streaming deltas (see reconcileTranscriptRows),
// so search text can be cached per row object instead of re-deriving it from
// every message on each call.
const searchTextByRow = new WeakMap<TranscriptRow, string>();

function cachedTranscriptRowSearchText(row: TranscriptRow): string {
  const cached = searchTextByRow.get(row);
  if (cached !== undefined) {
    return cached;
  }
  const searchText = transcriptRowSearchText(row);
  searchTextByRow.set(row, searchText);
  return searchText;
}

/**
 * Reuses prior row objects when a rebuilt row is structurally equivalent, so
 * memoized row components can bail out and per-row caches stay warm. Relies on
 * message objects keeping identity for untouched turns.
 */
export function reconcileTranscriptRows(previousRows: TranscriptRow[], nextRows: TranscriptRow[]): TranscriptRow[] {
  if (previousRows.length === 0) {
    return nextRows;
  }
  const previousByKey = new Map<string, TranscriptRow>();
  for (const row of previousRows) {
    previousByKey.set(row.key, row);
  }
  let reusedAll = nextRows.length === previousRows.length;
  const reconciled = nextRows.map((row) => {
    const previous = previousByKey.get(row.key);
    if (previous && transcriptRowsEquivalent(previous, row)) {
      return previous;
    }
    reusedAll = false;
    return row;
  });
  return reusedAll ? previousRows : reconciled;
}

function transcriptRowsEquivalent(left: TranscriptRow, right: TranscriptRow): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "working" || right.kind === "working") {
    return true;
  }
  if (left.kind === "subagentLifecycle" && right.kind === "subagentLifecycle") {
    return left.event === right.event;
  }
  if (left.kind === "turnReviewChanges" && right.kind === "turnReviewChanges") {
    return left.turnId === right.turnId && left.summary === right.summary;
  }
  if (left.kind !== "entry" || right.kind !== "entry") {
    return false;
  }
  return (
    left.disclosureKey === right.disclosureKey &&
    left.entryIsTool === right.entryIsTool &&
    left.nextIsTool === right.nextIsTool &&
    left.previousIsTool === right.previousIsTool &&
    left.turnId === right.turnId &&
    transcriptEntriesEquivalent(left.entry, right.entry)
  );
}

function transcriptEntriesEquivalent(left: TranscriptMessageEntry, right: TranscriptMessageEntry): boolean {
  if (left === right) {
    return true;
  }
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "message" || right.kind === "message") {
    return left.kind === "message" && right.kind === "message" && left.message === right.message;
  }
  if (left.id !== right.id) {
    return false;
  }
  if (left.kind === "activityGroup" && right.kind === "activityGroup") {
    return (
      sameActivitySummary(left.summary, right.summary) &&
      left.entries.length === right.entries.length &&
      left.entries.every((entry, index) => transcriptEntriesEquivalent(entry, right.entries[index]))
    );
  }
  if (left.kind === "activityGroup" || right.kind === "activityGroup") {
    return false;
  }
  return left.messages.length === right.messages.length &&
    left.messages.every((message, index) => message === right.messages[index]);
}

function sameActivitySummary(
  left: { commands: number; files: number; label: string; searches: number },
  right: { commands: number; files: number; label: string; searches: number },
): boolean {
  return (
    left.commands === right.commands &&
    left.files === right.files &&
    left.label === right.label &&
    left.searches === right.searches
  );
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
    return [reviewTurnChangeLabel(row.summary), reviewChangeDeltaText(row.summary)].filter(Boolean).join("\n");
  }
  if (row.kind === "subagentLifecycle") {
    return `${row.event.title} — ${row.event.verb}`;
  }
  if (row.kind === "working") {
    return "Agent is working";
  }
  return transcriptEntrySearchText(row.entry);
}

function reviewChangeDeltaText(summary: ReviewTurnChangeSummary): string | undefined {
  if (summary.additions === 0 && summary.deletions === 0) {
    return undefined;
  }
  return `+${summary.additions} -${summary.deletions}`;
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
    message.toolPreview,
    message.text,
  ]
    .filter(Boolean)
    .join("\n");
}

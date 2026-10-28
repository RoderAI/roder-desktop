import { messagesFromThread } from "@/lib/roder-thread";
import { subagentMessagesForMessage } from "@/lib/subagent-messages";
import type { TranscriptNavigationItem } from "@/lib/transcript-navigation";
import type { RoderThread } from "@/types/roder";

export type TranscriptNavigationHistoryPage = {
  thread: RoderThread | null;
  before: string | null;
  hasMore: boolean;
};

export type TranscriptNavigationHistoryOptions = {
  threadId: string;
  before: string | null;
  readPage: (
    threadId: string,
    options: { before: string; limit: number; maxBytes: number },
  ) => Promise<TranscriptNavigationHistoryPage>;
  isCancelled: () => boolean;
  onPage: (items: TranscriptNavigationItem[]) => void;
};

export async function scanTranscriptNavigationHistory({
  threadId,
  before,
  readPage,
  isCancelled,
  onPage,
}: TranscriptNavigationHistoryOptions): Promise<void> {
  const seenCursors = new Set<string>();
  let cursor = before;
  while (cursor !== null && !isCancelled()) {
    seenCursors.add(cursor);
    // Page objects stay local to this iteration; callers receive only summaries.
    const page = await readPage(threadId, { before: cursor, limit: 200, maxBytes: 2_097_152 });
    if (isCancelled()) return;
    if (!page.thread) {
      throw new Error(`Cannot index navigation history for thread ${threadId}: page has no thread.`);
    }
    if (page.thread.id !== threadId) {
      throw new Error(`Cannot index navigation history for thread ${threadId}: received thread ${page.thread.id}.`);
    }
    if (page.hasMore && (page.before === null || seenCursors.has(page.before))) {
      throw new Error(`Cannot index navigation history for thread ${threadId}: pagination cursor did not advance.`);
    }
    const items: TranscriptNavigationItem[] = [];
    for (const message of messagesFromThread(page.thread)) {
      if (message.role !== "user" || subagentMessagesForMessage(message)) continue;
      const preview = message.text.trim() || (message.images?.length ? "Image attachment" : "");
      if (preview) items.push({ id: message.id, role: "user", preview: preview.slice(0, 640), rowIndex: -1 });
    }
    onPage(items);
    cursor = page.hasMore ? page.before : null;
  }
}

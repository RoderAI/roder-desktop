import type { TranscriptRow } from "@/lib/transcript-rows";
import { subagentDisplayName, subagentMessageResult, subagentMessagesForMessage } from "@/lib/subagent-messages";

export type TranscriptNavigationItem = {
  id: string;
  role: "user" | "assistant" | "system";
  preview: string;
  rowIndex: number;
};

export function buildTranscriptNavigation(rows: readonly TranscriptRow[]): TranscriptNavigationItem[] {
  const items: TranscriptNavigationItem[] = [];
  rows.forEach((row, rowIndex) => {
    if (row.kind !== "entry" || row.entry.kind !== "message") return;
    const message = row.entry.message;
    if (message.role === "tool") return;
    const subagentMessages = subagentMessagesForMessage(message);
    if (subagentMessages) {
      const preview = subagentMessages
        .map((delivery) => {
          const agent = subagentDisplayName(delivery.kind === "NEW_TASK" ? delivery.recipient : delivery.sender);
          return `${agent}: ${subagentMessageResult(delivery).body}`;
        })
        .join("\n\n")
        .replace(/\s+/gu, " ")
        .slice(0, 320);
      items.push({ id: message.id, role: "system", preview, rowIndex });
      return;
    }
    const preview = message.text.trim().replace(/\s+/gu, " ") || (message.images?.length ? "Image attachment" : "");
    if (!preview) return;
    items.push({ id: message.id, role: message.role, preview: preview.slice(0, 320), rowIndex });
  });
  return items;
}

export function activeTranscriptNavigationId(
  items: readonly TranscriptNavigationItem[],
  firstVisibleRow: number,
  pinnedToEnd: boolean,
  selectedId?: string | null,
): string | null {
  if (selectedId && items.some((item) => item.id === selectedId)) return selectedId;
  if (pinnedToEnd) return items.at(-1)?.id ?? null;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].rowIndex <= firstVisibleRow) return items[index].id;
  }
  return items[0]?.id ?? null;
}

export function transcriptNavigationTarget(items: readonly TranscriptNavigationItem[], id: string): number | null {
  return items.find((item) => item.id === id)?.rowIndex ?? null;
}

export function transcriptNavigationPreview(text: string): { title: string; body: string } {
  const [title, ...lines] = text.trim().slice(0, 640).split(/\r?\n/u);
  return { title, body: lines.join("\n").trim() };
}

export function transcriptNavigationKeyIndex(key: string, index: number, count: number): number | null {
  if (!count) return null;
  if (key === "ArrowUp") return Math.max(0, index - 1);
  if (key === "ArrowDown") return Math.min(count - 1, index + 1);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

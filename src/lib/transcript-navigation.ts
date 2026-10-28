import type { TranscriptRow } from "@/lib/transcript-rows";
import { subagentMessagesForMessage } from "@/lib/subagent-messages";

export type TranscriptNavigationItem = {
  id: string;
  role: "user";
  preview: string;
  rowIndex: number;
};

export function buildTranscriptNavigation(rows: readonly TranscriptRow[]): TranscriptNavigationItem[] {
  const items: TranscriptNavigationItem[] = [];
  rows.forEach((row, rowIndex) => {
    if (row.kind !== "entry" || row.entry.kind !== "message") return;
    const message = row.entry.message;
    if (message.role !== "user" || subagentMessagesForMessage(message)) return;
    const preview = message.text.trim().replace(/\s+/gu, " ") || (message.images?.length ? "Image attachment" : "");
    if (!preview) return;
    items.push({ id: message.id, role: message.role, preview: preview.slice(0, 320), rowIndex });
  });
  return items;
}

export function mergeTranscriptNavigation(
  older: readonly TranscriptNavigationItem[],
  loaded: readonly TranscriptNavigationItem[],
): TranscriptNavigationItem[] {
  const loadedById = new Map(loaded.map((item) => [item.id, item]));
  const olderById = new Map(older.filter((item) => !loadedById.has(item.id)).map((item) => [item.id, item]));
  return [...olderById.values(), ...loadedById.values()];
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
    if (items[index].rowIndex >= 0 && items[index].rowIndex <= firstVisibleRow) return items[index].id;
  }
  return items.find((item) => item.rowIndex >= 0)?.id ?? items[0]?.id ?? null;
}

export function transcriptNavigationTarget(items: readonly TranscriptNavigationItem[], id: string): number | null {
  const rowIndex = items.find((item) => item.id === id)?.rowIndex;
  return rowIndex !== undefined && rowIndex >= 0 ? rowIndex : null;
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

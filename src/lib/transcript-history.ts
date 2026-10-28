export function shouldLoadOlderHistory({
  hasMore,
  loading,
  error,
  userIntent,
  movingUp,
  scrollTop,
}: {
  hasMore: boolean;
  loading: boolean;
  error?: string | null;
  userIntent: boolean;
  movingUp: boolean;
  scrollTop: number;
}): boolean {
  return hasMore && !loading && !error && userIntent && movingUp && scrollTop <= 200;
}

export type HistoryScrollAnchor = {
  candidates: Array<{ key: string; offset: number }>;
  scrollOffset: number;
  totalSize: number;
};

type ScrollNode = { scrollTop: number; scrollHeight: number; clientHeight: number; parentElement: ScrollNode | null };

export function nestedScrollConsumesUpwardGesture(target: ScrollNode | null, viewport: ScrollNode): boolean {
  for (let node = target; node && node !== viewport; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight && node.scrollTop > 0) return true;
  }
  return false;
}

export function captureHistoryScrollAnchor(
  items: Array<{ key: string | number | bigint; start: number; end: number }>,
  scrollOffset: number,
  totalSize: number,
): HistoryScrollAnchor {
  const visible = items.filter((item) => item.end >= scrollOffset);
  return {
    candidates: visible.map((item) => ({ key: String(item.key), offset: scrollOffset - item.start })),
    scrollOffset,
    totalSize,
  };
}

export function restoreHistoryScrollAnchor(
  anchor: HistoryScrollAnchor,
  keys: readonly string[],
  offsetForIndex: (index: number) => number | undefined,
  totalSize: number,
): number {
  for (const candidate of anchor.candidates) {
    const index = keys.indexOf(candidate.key);
    if (index < 0) continue;
    const offset = offsetForIndex(index);
    if (offset !== undefined) return Math.max(0, offset + candidate.offset);
  }
  return Math.max(0, anchor.scrollOffset + totalSize - anchor.totalSize);
}

import type { RoderThread } from "../types/roder";

export type IndexedTranscriptHistory = {
  supported: true;
  threadId: string;
  before: string | null;
  olderCount: number;
  totalCount: number;
};
export type IndexedTranscriptPage = { thread: RoderThread; start: number; end: number };
export type HistoryRange = { start: number; end: number };
export const HISTORY_BLOCK_ITEMS = 32;
export const HISTORY_CACHE_PAGES = 6;

type Snapshot = {
  windows: IndexedTranscriptPage[];
  pending: HistoryRange[];
  errors: Record<string, string>;
};
type Reader = (
  params: HistoryRange & Pick<IndexedTranscriptHistory, "threadId" | "before" | "olderCount">,
) => Promise<IndexedTranscriptPage>;

const key = ({ start, end }: HistoryRange) => `${start}:${end}`;

export function historyBlockRange(blockIndex: number, olderCount: number): HistoryRange {
  const count = Math.max(0, Math.floor(olderCount));
  const start = Math.min(count, Math.max(0, Math.floor(blockIndex)) * HISTORY_BLOCK_ITEMS);
  return { start, end: Math.min(count, start + HISTORY_BLOCK_ITEMS) };
}

export function sparseHistorySegments(
  range: HistoryRange,
  windows: IndexedTranscriptPage[],
): (HistoryRange & { page?: IndexedTranscriptPage })[] {
  const segments: (HistoryRange & { page?: IndexedTranscriptPage })[] = [];
  let cursor = range.start;
  for (const page of [...windows].sort((a, b) => a.start - b.start)) {
    if (page.end <= cursor || page.start >= range.end) continue;
    if (page.start > cursor) segments.push({ start: cursor, end: page.start });
    const end = Math.min(page.end, range.end);
    segments.push({ start: Math.max(cursor, page.start), end, page });
    cursor = end;
    if (cursor === range.end) break;
  }
  if (cursor < range.end) segments.push({ start: cursor, end: range.end });
  return segments;
}

function missingRanges(range: HistoryRange, covered: HistoryRange[]): HistoryRange[] {
  let gaps = [range];
  for (const cover of covered) {
    gaps = gaps.flatMap((gap) => {
      if (cover.end <= gap.start || cover.start >= gap.end) return [gap];
      return [
        ...(gap.start < cover.start ? [{ start: gap.start, end: cover.start }] : []),
        ...(cover.end < gap.end ? [{ start: cover.end, end: gap.end }] : []),
      ];
    });
  }
  return gaps;
}

export class SparseTranscriptHistory {
  private windows: IndexedTranscriptPage[] = [];
  private active: HistoryRange[] = [];
  private queue: HistoryRange[] = [];
  private errors: Record<string, string> = {};
  private listeners = new Set<() => void>();
  private disposed = false;
  private retained: HistoryRange[] = [];
  private visibleRequests: HistoryRange[] = [];
  private snapshot: Snapshot;

  constructor(
    private readonly index: IndexedTranscriptHistory,
    private readonly read: Reader,
  ) {
    this.snapshot = this.makeSnapshot();
  }

  subscribe = (listener: () => void): (() => void) => {
    if (!this.disposed) this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Snapshot => this.snapshot;

  watchRange(start: number, end: number): () => void {
    if (
      this.disposed ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end <= start ||
      end > this.index.olderCount
    )
      return () => {};
    const range = { start, end };
    this.visibleRequests.push(range);
    this.loadRange(start, end);
    return () => {
      this.visibleRequests = this.visibleRequests.filter((entry) => entry !== range);
      this.trimWindows();
      this.cancelRange(start, end);
      this.pump();
      this.publish();
    };
  }

  // A byte-limited section may require several short pages. Never evict payloads
  // belonging to mounted virtual sections, or their visible placeholders loop.
  // Only six additional offscreen pages are kept.
  retainRange(start: number, end: number): () => void {
    const range = { start, end };
    this.retained.push(range);
    return () => {
      this.retained = this.retained.filter((entry) => entry !== range);
      this.trimWindows();
      this.publish();
    };
  }

  loadRange(start: number, end: number): void {
    if (this.disposed || !Number.isFinite(start) || !Number.isFinite(end)) return;
    const range = {
      start: Math.max(0, Math.floor(start)),
      end: Math.min(this.index.olderCount, Math.ceil(end)),
    };
    if (range.start >= range.end) return;
    // Recently viewed pages survive the next cache eviction.
    this.windows = [
      ...this.windows.filter((page) => page.end <= range.start || page.start >= range.end),
      ...this.windows.filter((page) => page.end > range.start && page.start < range.end),
    ];
    const gaps = missingRanges(range, [...this.windows, ...this.active, ...this.queue]);
    const additions: HistoryRange[] = [];
    for (const gap of gaps) {
      // Only keep bounded work near the requested end, even for enormous input ranges.
      for (let right = gap.end; right > gap.start && additions.length < 4; right -= 64) {
        const request = { start: Math.max(gap.start, right - 64), end: right };
        if (!this.errors[key(request)]) additions.push(request);
      }
    }
    this.queue = [...additions, ...this.queue].slice(0, 4);
    this.pump();
    this.publish();
  }

  cancelRange(start: number, end: number): void {
    this.queue = this.queue.filter((range) => range.end <= start || range.start >= end);
    this.publish();
  }

  retry(start: number, end: number): void {
    if (this.disposed) return;
    const errors = { ...this.errors };
    for (const id of Object.keys(errors)) {
      const [left, right] = id.split(":").map(Number);
      if (left < end && right > start) delete errors[id];
    }
    this.errors = errors;
    this.loadRange(start, end);
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.windows = [];
    this.queue = [];
    this.active = [];
    this.errors = {};
    this.retained = [];
    this.visibleRequests = [];
    this.snapshot = this.makeSnapshot();
  }

  private pump(): void {
    this.refillVisibleRequests();
    while (!this.disposed && this.active.length < 2 && this.queue.length) {
      const range = this.queue.shift()!;
      this.active.push(range);
      this.refillVisibleRequests();
      void Promise.resolve()
        .then(() => {
          if (this.disposed) throw new Error("History cache disposed");
          return this.read({
            ...range,
            threadId: this.index.threadId,
            before: this.index.before,
            olderCount: this.index.olderCount,
          });
        })
        .then((page) => {
          if (this.disposed) return;
          const count = page.thread.turns?.reduce((sum, turn) => sum + turn.items.length, 0) ?? 0;
          if (
            !Number.isInteger(page.start) ||
            page.start < range.start ||
            page.start >= page.end ||
            page.end !== range.end ||
            page.thread.id !== this.index.threadId ||
            count !== page.end - page.start
          )
            throw new Error("History page does not match the requested range");
          this.windows = [...this.windows, Object.freeze({ ...page })];
          this.trimWindows();
        })
        .catch((error: unknown) => {
          if (this.disposed) return;
          this.errors = Object.fromEntries(
            [
              ...Object.entries(this.errors),
              [key(range), error instanceof Error ? error.message : String(error)],
            ].slice(-24),
          );
        })
        .finally(() => {
          if (this.disposed) return;
          this.active = this.active.filter((entry) => entry !== range);
          this.pump();
          this.publish();
        });
    }
  }

  private refillVisibleRequests(): void {
    if (this.disposed) return;
    for (const range of [...this.visibleRequests].reverse()) {
      if (this.queue.length >= 4) return;
      for (const gap of missingRanges(range, [...this.windows, ...this.active, ...this.queue])) {
        for (let end = gap.end; end > gap.start && this.queue.length < 4; end -= 64) {
          const request = { start: Math.max(gap.start, end - 64), end };
          if (!this.errors[key(request)]) this.queue.push(request);
        }
      }
    }
  }

  private trimWindows(): void {
    const visible = (page: IndexedTranscriptPage) =>
      [...this.retained, ...this.visibleRequests].some((range) => range.start < page.end && range.end > page.start);
    const offscreen = new Set(this.windows.filter((page) => !visible(page)).slice(-HISTORY_CACHE_PAGES));
    this.windows = this.windows.filter((page) => visible(page) || offscreen.has(page));
  }

  private makeSnapshot(): Snapshot {
    return Object.freeze({
      windows: Object.freeze([...this.windows]) as IndexedTranscriptPage[],
      pending: Object.freeze(
        [...this.active, ...this.queue].map((range) => Object.freeze({ ...range })),
      ) as HistoryRange[],
      errors: Object.freeze({ ...this.errors }),
    });
  }

  private publish(): void {
    if (this.disposed) return;
    const pending = [...this.active, ...this.queue];
    if (
      this.snapshot.windows.length === this.windows.length &&
      this.windows.every((page, i) => page === this.snapshot.windows[i]) &&
      this.snapshot.pending.length === pending.length &&
      pending.every((range, i) => key(range) === key(this.snapshot.pending[i])) &&
      Object.keys(this.snapshot.errors).length === Object.keys(this.errors).length &&
      Object.entries(this.errors).every(([id, message]) => this.snapshot.errors[id] === message)
    )
      return;
    this.snapshot = this.makeSnapshot();
    for (const listener of this.listeners) listener();
  }
}

import type { RoderItem, RoderThread, RoderTurn } from "@/types/roder";

export type ThreadHistoryState = {
  before: string | null;
  hasMore: boolean;
  loading: boolean;
  loadingOlder: boolean;
  loaded: boolean;
  error: string | null;
  requestId: number;
};

export const emptyThreadHistoryState: ThreadHistoryState = {
  before: null,
  hasMore: false,
  loading: false,
  loadingOlder: false,
  loaded: false,
  error: null,
  requestId: 0,
};

export function recentThreadItems(thread: RoderThread, limit = 160): RoderThread {
  const turns = thread.turns ?? [];
  const count = turns.reduce((total, turn) => total + turn.items.length, 0);
  const bound = Math.max(0, Math.floor(limit));
  if (count <= bound) return thread;
  let remaining = bound;
  const selected: RoderTurn[] = [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.items.length <= remaining) {
      selected.push(turn);
      remaining -= turn.items.length;
    } else {
      if (remaining > 0) selected.push({ ...turn, items: turn.items.slice(-remaining) });
      break;
    }
  }
  return { ...thread, turns: selected.reverse() };
}

function mergeOrdered<T extends { id: string }>(current: T[], older: T[], merge: (current: T, older: T) => T): T[] {
  const positions = new Map(current.map((entry, index) => [entry.id, index]));
  const result: T[] = [];
  const seen = new Set<string>();
  let cursor = 0;
  for (const entry of older) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const position = positions.get(entry.id);
    if (position === undefined) {
      result.push(entry);
    } else if (position >= cursor) {
      result.push(...current.slice(cursor, position), merge(current[position], entry));
      cursor = position + 1;
    }
  }
  result.push(...current.slice(cursor));
  return result.length === current.length && result.every((entry, index) => entry === current[index])
    ? current
    : result;
}

export function mergeOlderThreadHistory(current: RoderThread | undefined, older: RoderThread): RoderThread {
  if (!current) return older;
  const turns = mergeOrdered(current.turns ?? [], older.turns ?? [], (live, previous) => {
    const items = mergeOrdered(live.items, previous.items, (item) => item);
    return items === live.items ? live : { ...live, items };
  });
  return turns === current.turns ? current : { ...current, turns };
}

function changedFields<T extends object>(current: T, baseline: T | undefined): Partial<T> {
  return Object.fromEntries(
    Object.entries(current).filter(([key, value]) => !baseline || value !== baseline[key as keyof T]),
  ) as Partial<T>;
}

function preserveTerminal<T extends string | undefined>(current: T, incoming: T): T {
  return current === undefined || current === "inProgress" ? (incoming ?? current) : current;
}

function mergeLiveItem(current: RoderItem, incoming: RoderItem): RoderItem {
  let result = current;
  // A load can finish with more complete text than the notification delta accumulated so far.
  for (const field of ["text", "output"] as const) {
    if (field in current && field in incoming) {
      const partial: unknown = (current as unknown as Record<string, unknown>)[field];
      const complete: unknown = (incoming as unknown as Record<string, unknown>)[field];
      if (
        typeof partial === "string" &&
        typeof complete === "string" &&
        complete.length > partial.length &&
        complete.startsWith(partial)
      ) {
        result = { ...result, [field]: complete };
      }
    }
  }
  const status = preserveTerminal(current.status, incoming.status);
  return status === undefined || status === result.status ? result : { ...result, status };
}

export function mergeInitialThreadHistory(
  incoming: RoderThread,
  current: RoderThread | undefined,
  baseline: RoderThread | undefined,
): RoderThread {
  if (!current || current === baseline) return incoming;
  const baselineTurns = new Map((baseline?.turns ?? []).map((turn) => [turn.id, turn]));
  const incomingIds = new Set((incoming.turns ?? []).map((turn) => turn.id));
  const eligibleTurns = (current.turns ?? []).filter(
    (turn) => turn !== baselineTurns.get(turn.id) || incomingIds.has(turn.id),
  );
  const turns = mergeOrdered(eligibleTurns, incoming.turns ?? [], (live, snapshot) => {
    const previous = baselineTurns.get(live.id);
    if (live === previous) return snapshot;
    const baselineItems = new Map((previous?.items ?? []).map((item) => [item.id, item]));
    const incomingItemIds = new Set(snapshot.items.map((item) => item.id));
    const eligibleItems = live.items.filter(
      (item) => item !== baselineItems.get(item.id) || incomingItemIds.has(item.id),
    );
    const items = mergeOrdered(eligibleItems, snapshot.items, (item, saved) =>
      item === baselineItems.get(item.id) ? saved : mergeLiveItem(item, saved),
    );
    return {
      ...snapshot,
      ...changedFields(live, previous),
      items,
      status: preserveTerminal(live.status, snapshot.status),
    };
  });
  // Missing turns must also shed unchanged cached items rather than restoring an old page.
  const filteredTurns = turns.map((turn) => {
    if (incomingIds.has(turn.id)) return turn;
    const previous = baselineTurns.get(turn.id);
    if (!previous) return turn;
    const baselineItems = new Map(previous.items.map((item) => [item.id, item]));
    return { ...turn, items: turn.items.filter((item) => item !== baselineItems.get(item.id)) };
  });
  return { ...incoming, ...changedFields(current, baseline), turns: filteredTurns };
}

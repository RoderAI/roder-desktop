import type { RoderThread } from "@/types/roder";

export const DEFAULT_STALE_EMPTY_THREAD_MIN_AGE_SECONDS = 60 * 60;
export const DEFAULT_THREAD_CLEANUP_PAGE_SIZE = 100;
export const DEFAULT_THREAD_CLEANUP_MAX_PAGES = 20;

const DEFAULT_UNTITLED_PREVIEWS = new Set(["untitled thread", "untitled agent"]);

export type StaleEmptyThreadOptions = {
  minAgeSeconds?: number;
};

export type ThreadListPage = {
  data: RoderThread[];
  nextCursor: string | null;
};

export type CollectStaleEmptyThreadIdsOptions = {
  listThreads: (limit: number, cursor?: string | null) => Promise<ThreadListPage>;
  nowSeconds?: number;
  minAgeSeconds?: number;
  pageSize?: number;
  maxPages?: number;
  activeThreadId?: string | null;
  protectedThreadIds?: Iterable<string>;
};

export type RunStaleEmptyThreadCleanupOptions = {
  listThreads: CollectStaleEmptyThreadIdsOptions["listThreads"];
  archiveThread: (threadId: string) => Promise<unknown>;
  refreshThreads: () => Promise<void>;
  getActiveThreadId: () => string | null | undefined;
  nowSeconds?: number;
  minAgeSeconds?: number;
  pageSize?: number;
  maxPages?: number;
  protectedThreadIds?: Iterable<string>;
};

let staleEmptyThreadCleanupStarted = false;

export function resetStaleEmptyThreadCleanupForTests(): void {
  staleEmptyThreadCleanupStarted = false;
}

function isDefaultUntitledPreview(preview: string | null | undefined): boolean {
  const label = (preview ?? "").trim().toLowerCase();
  return DEFAULT_UNTITLED_PREVIEWS.has(label);
}

function threadAgeSeconds(thread: Pick<RoderThread, "createdAt" | "updatedAt">): number {
  return Math.max(thread.createdAt || 0, thread.updatedAt || 0);
}

export function isStaleEmptyThread(
  thread: Pick<RoderThread, "messageCount" | "status" | "preview" | "createdAt" | "updatedAt">,
  nowSeconds: number,
  opts: StaleEmptyThreadOptions = {},
): boolean {
  const minAgeSeconds = opts.minAgeSeconds ?? DEFAULT_STALE_EMPTY_THREAD_MIN_AGE_SECONDS;
  if (thread.messageCount !== 0) {
    return false;
  }
  if (thread.status.type !== "idle" || thread.status.activeTurnId) {
    return false;
  }
  if (!isDefaultUntitledPreview(thread.preview)) {
    return false;
  }
  const ageSeconds = nowSeconds - threadAgeSeconds(thread);
  return ageSeconds >= minAgeSeconds;
}

export async function collectStaleEmptyThreadIds(
  options: CollectStaleEmptyThreadIdsOptions,
): Promise<string[]> {
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const minAgeSeconds = options.minAgeSeconds ?? DEFAULT_STALE_EMPTY_THREAD_MIN_AGE_SECONDS;
  const pageSize = options.pageSize ?? DEFAULT_THREAD_CLEANUP_PAGE_SIZE;
  const maxPages = options.maxPages ?? DEFAULT_THREAD_CLEANUP_MAX_PAGES;
  const excluded = new Set<string>();
  if (options.activeThreadId) {
    excluded.add(options.activeThreadId);
  }
  for (const id of options.protectedThreadIds ?? []) {
    if (id) {
      excluded.add(id);
    }
  }

  const staleIds: string[] = [];
  let cursor: string | null | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await options.listThreads(pageSize, cursor || undefined);
    for (const item of result.data ?? []) {
      if (excluded.has(item.id)) {
        continue;
      }
      if (isStaleEmptyThread(item, nowSeconds, { minAgeSeconds })) {
        staleIds.push(item.id);
      }
    }
    if (!result.nextCursor) {
      break;
    }
    cursor = result.nextCursor;
  }
  return staleIds;
}

export async function runStaleEmptyThreadCleanup(
  options: RunStaleEmptyThreadCleanupOptions,
): Promise<{ archivedIds: string[] }> {
  if (staleEmptyThreadCleanupStarted) {
    return { archivedIds: [] };
  }
  staleEmptyThreadCleanupStarted = true;

  try {
    const candidateIds = await collectStaleEmptyThreadIds({
      listThreads: options.listThreads,
      nowSeconds: options.nowSeconds,
      minAgeSeconds: options.minAgeSeconds,
      pageSize: options.pageSize,
      maxPages: options.maxPages,
      activeThreadId: options.getActiveThreadId(),
      protectedThreadIds: options.protectedThreadIds,
    });

    const archivedIds: string[] = [];
    for (const threadId of candidateIds) {
      const activeThreadId = options.getActiveThreadId();
      if (activeThreadId && threadId === activeThreadId) {
        continue;
      }
      await options.archiveThread(threadId);
      archivedIds.push(threadId);
    }

    if (archivedIds.length > 0) {
      await options.refreshThreads();
    }

    return { archivedIds };
  } catch (error) {
    console.warn("[thread-cleanup] stale empty thread sweep failed", error);
    return { archivedIds: [] };
  }
}

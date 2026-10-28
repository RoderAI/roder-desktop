import type { RoderThread } from "../../src/types/roder";

export const THREAD_HISTORY_INITIAL_ITEMS = 160;
export const THREAD_HISTORY_OLDER_ITEMS = 120;
export const THREAD_HISTORY_MAX_ITEMS = 200;
export const THREAD_HISTORY_MAX_PAGE_BYTES = 2 * 1024 * 1024;

export type ThreadHistoryParams = {
  threadId: string;
  before?: string;
  limit?: number;
  maxBytes?: number;
};

export type ThreadHistoryPage = {
  thread: RoderThread | null;
  before: string | null;
  hasMore: boolean;
};

// The harness owns indexing, cursor validation, and item/byte budgets. Never
// fall back to thread/read: that would reload the entire persisted transcript.
export function createThreadHistoryService(options: {
  request: (method: string, params: ThreadHistoryParams) => Promise<ThreadHistoryPage>;
}) {
  return {
    read(params: ThreadHistoryParams): Promise<ThreadHistoryPage> {
      return options.request("thread/history/read", params);
    },
  };
}

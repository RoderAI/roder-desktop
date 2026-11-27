import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import {
  IndexedTranscript,
  clearTranscriptHistoryIndexCache,
  evictHistoryIndexForThread,
  indexedHistoryCacheKey,
  indexedHistoryProbeKey,
  readCachedHistoryIndex,
  writeCachedIndexedHistory,
  writeCachedUnsupportedHistory,
  type TranscriptHistoryIndex,
} from "../src/components/indexed-transcript";
import { SparseTranscriptHistory, type IndexedTranscriptHistory } from "../src/lib/sparse-transcript-history";
import { roderIpc } from "../src/lib/roder-ipc";
import type { ConversationMessage } from "../src/types/roder";

const sampleMessages: ConversationMessage[] = [
  { id: "user-1", role: "user", text: "Can you explain the deployment pipeline?", status: "complete" },
  { id: "assistant-1", role: "assistant", text: "Sure — tags trigger signed builds.", status: "complete" },
];

function makeIndexedHistory(threadId: string, before: string, olderCount = 120): TranscriptHistoryIndex {
  const index: IndexedTranscriptHistory = {
    supported: true,
    threadId,
    before,
    olderCount,
    totalCount: olderCount + sampleMessages.length,
  };
  return {
    index,
    cache: new SparseTranscriptHistory(index, async () => {
      throw new Error("unexpected read");
    }),
    estimatedItemSize: 48,
  };
}

afterEach(() => {
  clearTranscriptHistoryIndexCache();
});

test("keeps the transcript rendered without flashing 'Indexing conversation' while history index is pending", () => {
  const readIndexSpy = vi.spyOn(roderIpc, "readThreadHistoryIndex");
  const loadOlder = vi.fn<() => Promise<void>>(async () => {});
  try {
    const html = renderToStaticMarkup(
      createElement(IndexedTranscript, {
        messages: sampleMessages,
        followSignal: 0,
        scrollStateKey: "thread-1:3",
        navigationThreadId: "thread-1",
        historyCursor: "cursor-1",
        historyLoading: false,
        hasOlderHistory: true,
        onLoadOlderHistory: loadOlder,
      }),
    );

    expect(html).not.toContain("Indexing conversation");
    expect(html).not.toContain("Load older messages");
    expect(html).toContain("Can you explain the deployment pipeline?");
    expect(html).toContain("Sure — tags trigger signed builds.");
    expect(readIndexSpy).not.toHaveBeenCalled();
    expect(loadOlder).not.toHaveBeenCalled();
  } finally {
    readIndexSpy.mockRestore();
  }
});

test("uses cached history index synchronously on remount without flashing or showing unsupported banner", () => {
  const cacheKey = indexedHistoryCacheKey("thread-2", "cursor-2");
  const probeKey = indexedHistoryProbeKey("thread-2:4", "thread-2", "cursor-2");
  const entry = makeIndexedHistory("thread-2", "cursor-2", 64);
  writeCachedIndexedHistory(cacheKey, entry);

  expect(readCachedHistoryIndex(cacheKey, probeKey)).toEqual({ kind: "indexed", value: entry });

  const html = renderToStaticMarkup(
    createElement(IndexedTranscript, {
      messages: sampleMessages,
      followSignal: 0,
      scrollStateKey: "thread-2:4",
      navigationThreadId: "thread-2",
      historyCursor: "cursor-2",
      historyLoading: false,
      hasOlderHistory: true,
    }),
  );

  expect(html).not.toContain("Indexing conversation");
  expect(html).not.toContain("Full-history seeking is unavailable");
  expect(html).not.toContain("Load older messages");
  expect(html).toContain("Can you explain the deployment pipeline?");
});

test("renders fallback paging banner when probe is cached as unsupported for the current snapshot", () => {
  const cacheKey = indexedHistoryCacheKey("thread-remote", "cursor-r");
  const probeKey = indexedHistoryProbeKey("thread-remote:1", "thread-remote", "cursor-r");
  writeCachedUnsupportedHistory(probeKey);

  expect(readCachedHistoryIndex(cacheKey, probeKey)).toEqual({ kind: "unsupported" });
  // A refreshed requestId gets a new probeKey so transient failures can retry cleanly.
  expect(
    readCachedHistoryIndex(cacheKey, indexedHistoryProbeKey("thread-remote:2", "thread-remote", "cursor-r")),
  ).toBeNull();

  const html = renderToStaticMarkup(
    createElement(IndexedTranscript, {
      messages: sampleMessages,
      followSignal: 0,
      scrollStateKey: "thread-remote:1",
      navigationThreadId: "thread-remote",
      historyCursor: "cursor-r",
      historyLoading: false,
      hasOlderHistory: true,
      onRetryHistory: async () => {},
    }),
  );

  expect(html).not.toContain("Indexing conversation");
  expect(html).toContain("Full-history seeking is unavailable");
  expect(html).toContain("Load older messages");
  expect(html).toContain("Retry index");
});

test("bounded LRU cache disposes evicted history caches and evictHistoryIndexForThread clears thread entries", () => {
  const entries: TranscriptHistoryIndex[] = [];
  const disposeSpies: Array<ReturnType<typeof vi.spyOn>> = [];

  for (let i = 0; i < 8; i += 1) {
    const entry = makeIndexedHistory(`thread-${i}`, `cursor-${i}`);
    entries.push(entry);
    disposeSpies.push(vi.spyOn(entry.cache, "dispose"));
    writeCachedIndexedHistory(indexedHistoryCacheKey(`thread-${i}`, `cursor-${i}`), entry);
  }

  // Entries 0 and 1 should be evicted and disposed (max size 6).
  expect(disposeSpies[0]).toHaveBeenCalledTimes(1);
  expect(disposeSpies[1]).toHaveBeenCalledTimes(1);
  expect(
    readCachedHistoryIndex(
      indexedHistoryCacheKey("thread-0", "cursor-0"),
      indexedHistoryProbeKey("thread-0:1", "thread-0", "cursor-0"),
    ),
  ).toBeNull();

  // Entry 7 should still be cached until evicted for its thread.
  expect(
    readCachedHistoryIndex(
      indexedHistoryCacheKey("thread-7", "cursor-7"),
      indexedHistoryProbeKey("thread-7:1", "thread-7", "cursor-7"),
    ),
  ).toEqual({ kind: "indexed", value: entries[7] });

  evictHistoryIndexForThread("thread-7");
  expect(disposeSpies[7]).toHaveBeenCalledTimes(1);
  expect(
    readCachedHistoryIndex(
      indexedHistoryCacheKey("thread-7", "cursor-7"),
      indexedHistoryProbeKey("thread-7:1", "thread-7", "cursor-7"),
    ),
  ).toBeNull();
});

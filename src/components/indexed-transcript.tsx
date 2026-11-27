import { useState } from "react";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { roderIpc } from "@/lib/roder-ipc";
import { SparseTranscriptHistory, type IndexedTranscriptHistory } from "@/lib/sparse-transcript-history";
import { buildTranscriptRows } from "@/lib/transcript-rows";
import { Transcript, estimateTranscriptRowSize, type TranscriptProps } from "./transcript";

export type TranscriptHistoryIndex = {
  index: IndexedTranscriptHistory;
  cache: SparseTranscriptHistory;
  estimatedItemSize: number;
};

export type HistoryIndexState = { kind: "indexed"; value: TranscriptHistoryIndex } | { kind: "unsupported" };

const MAX_CACHED_INDEXED_HISTORIES = 6;
const MAX_CACHED_UNSUPPORTED_PROBES = 24;

const indexedHistoryCache = new Map<string, TranscriptHistoryIndex>();
const unsupportedProbeCache = new Set<string>();

export function indexedHistoryCacheKey(threadId: string, cursor: string): string {
  return `${threadId}\0${cursor}`;
}

export function indexedHistoryProbeKey(scrollStateKey: string | undefined, threadId: string, cursor: string): string {
  return `${scrollStateKey ?? ""}\0${threadId}\0${cursor}`;
}

export function readCachedHistoryIndex(cacheKey: string, probeKey: string): HistoryIndexState | null {
  const existing = indexedHistoryCache.get(cacheKey);
  if (existing) {
    // Refresh LRU recency so active threads stay warm across view switches.
    indexedHistoryCache.delete(cacheKey);
    indexedHistoryCache.set(cacheKey, existing);
    return { kind: "indexed", value: existing };
  }
  if (unsupportedProbeCache.has(probeKey)) {
    return { kind: "unsupported" };
  }
  return null;
}

export function writeCachedIndexedHistory(cacheKey: string, entry: TranscriptHistoryIndex): void {
  const previous = indexedHistoryCache.get(cacheKey);
  if (previous && previous !== entry) {
    previous.cache.dispose();
    indexedHistoryCache.delete(cacheKey);
  }
  indexedHistoryCache.set(cacheKey, entry);
  while (indexedHistoryCache.size > MAX_CACHED_INDEXED_HISTORIES) {
    const oldestKey = indexedHistoryCache.keys().next().value;
    if (oldestKey === undefined) break;
    const evicted = indexedHistoryCache.get(oldestKey);
    indexedHistoryCache.delete(oldestKey);
    evicted?.cache.dispose();
  }
}

export function writeCachedUnsupportedHistory(probeKey: string): void {
  unsupportedProbeCache.delete(probeKey);
  unsupportedProbeCache.add(probeKey);
  while (unsupportedProbeCache.size > MAX_CACHED_UNSUPPORTED_PROBES) {
    const oldestKey = unsupportedProbeCache.values().next().value;
    if (oldestKey === undefined) break;
    unsupportedProbeCache.delete(oldestKey);
  }
}

export function evictHistoryIndexForThread(threadId: string): void {
  const prefix = `${threadId}\0`;
  for (const [key, entry] of indexedHistoryCache.entries()) {
    if (key.startsWith(prefix)) {
      indexedHistoryCache.delete(key);
      entry.cache.dispose();
    }
  }
  const probeNeedle = `\0${threadId}\0`;
  for (const key of unsupportedProbeCache) {
    if (key.includes(probeNeedle)) {
      unsupportedProbeCache.delete(key);
    }
  }
}

export function clearTranscriptHistoryIndexCache(): void {
  for (const entry of indexedHistoryCache.values()) {
    entry.cache.dispose();
  }
  indexedHistoryCache.clear();
  unsupportedProbeCache.clear();
}

export function IndexedTranscript(props: TranscriptProps): React.JSX.Element {
  const threadId = props.navigationThreadId;
  const cursor = props.historyCursor;
  const needsIndex = Boolean(!props.historyLoading && props.hasOlderHistory && threadId && cursor);
  const cacheKey = needsIndex ? indexedHistoryCacheKey(threadId!, cursor!) : null;
  const probeKey = needsIndex ? indexedHistoryProbeKey(props.scrollStateKey, threadId!, cursor!) : null;

  const cached = cacheKey && probeKey ? readCachedHistoryIndex(cacheKey, probeKey) : null;
  const [probeResult, setProbeResult] = useState<{ probeKey: string; state: HistoryIndexState } | null>(null);

  const activeState: HistoryIndexState | null = !needsIndex
    ? null
    : (cached ?? (probeResult?.probeKey === probeKey ? probeResult.state : null));

  const isIndexing = needsIndex && activeState === null;
  const isUnsupported = activeState?.kind === "unsupported";
  const indexedHistory = activeState?.kind === "indexed" ? activeState.value : undefined;

  const handleRetryHistory = props.onRetryHistory
    ? () => {
        if (threadId) evictHistoryIndexForThread(threadId);
        setProbeResult(null);
        return props.onRetryHistory!();
      }
    : undefined;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {probeKey && !cached ? (
        <HistoryIndexProbe
          key={probeKey}
          cacheKey={cacheKey!}
          probeKey={probeKey}
          threadId={threadId!}
          before={cursor!}
          messages={props.messages}
          onResolved={(state) => setProbeResult({ probeKey, state })}
        />
      ) : null}
      {isUnsupported ? (
        <p className="px-4 py-1 text-xs text-muted-foreground">
          Full-history seeking is unavailable. Older history loads in pages.{" "}
          {handleRetryHistory ? (
            <button type="button" className="underline" onClick={() => void handleRetryHistory()}>
              Retry index
            </button>
          ) : null}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">
        <Transcript
          {...props}
          indexedHistory={indexedHistory}
          onRetryHistory={handleRetryHistory}
          hasOlderHistory={indexedHistory || isIndexing ? false : props.hasOlderHistory}
          loadingOlderHistory={indexedHistory || isIndexing ? false : props.loadingOlderHistory}
          onLoadOlderHistory={indexedHistory || isIndexing ? undefined : props.onLoadOlderHistory}
          navigationThreadId={indexedHistory || isIndexing || isUnsupported ? undefined : props.navigationThreadId}
        />
      </div>
    </div>
  );
}

function HistoryIndexProbe({
  cacheKey,
  probeKey,
  threadId,
  before,
  messages,
  onResolved,
}: {
  cacheKey: string;
  probeKey: string;
  threadId: string;
  before: string;
  messages: TranscriptProps["messages"];
  onResolved: (state: HistoryIndexState) => void;
}): null {
  useMountEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const index = await roderIpc.readThreadHistoryIndex(threadId, before);
        if (cancelled) return;
        if (!index.supported) {
          writeCachedUnsupportedHistory(probeKey);
          onResolved({ kind: "unsupported" });
          return;
        }
        const cache = new SparseTranscriptHistory(index, roderIpc.readThreadHistoryRange);
        const rows = buildTranscriptRows({ messages });
        const estimate = rows.reduce((sum, row) => sum + estimateTranscriptRowSize(row), 0);
        const value: TranscriptHistoryIndex = {
          index,
          cache,
          // Freeze estimates for this history snapshot, not on every streamed token.
          estimatedItemSize: Math.max(2, Math.min(200, estimate / Math.max(1, messages.length))),
        };
        writeCachedIndexedHistory(cacheKey, value);
        onResolved({ kind: "indexed", value });
      } catch {
        if (cancelled) return;
        writeCachedUnsupportedHistory(probeKey);
        onResolved({ kind: "unsupported" });
      }
    })();
    return () => {
      cancelled = true;
    };
  });
  return null;
}

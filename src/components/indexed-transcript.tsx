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

export function IndexedTranscript(props: TranscriptProps): React.JSX.Element {
  if (props.historyLoading || !props.hasOlderHistory || !props.navigationThreadId || !props.historyCursor)
    return <Transcript {...props} />;
  return <HistoryIndexLoader key={props.scrollStateKey} {...props} />;
}

function HistoryIndexLoader(props: TranscriptProps): React.JSX.Element {
  const [history, setHistory] = useState<TranscriptHistoryIndex | "unsupported" | null>(null);
  useMountEffect(() => {
    let cancelled = false;
    let cache: SparseTranscriptHistory | undefined;
    void (async () => {
      try {
        const index = await roderIpc.readThreadHistoryIndex(props.navigationThreadId!, props.historyCursor!);
        if (cancelled) return;
        if (!index.supported) {
          setHistory("unsupported");
          return;
        }
        cache = new SparseTranscriptHistory(index, roderIpc.readThreadHistoryRange);
        const rows = buildTranscriptRows({ messages: props.messages });
        const estimate = rows.reduce((sum, row) => sum + estimateTranscriptRowSize(row), 0);
        setHistory({
          index,
          cache,
          // Freeze estimates for this history snapshot, not on every streamed token.
          estimatedItemSize: Math.max(2, Math.min(200, estimate / Math.max(1, props.messages.length))),
        });
      } catch {
        if (!cancelled) setHistory("unsupported");
      }
    })();
    return () => {
      cancelled = true;
      cache?.dispose();
    };
  });
  if (!history)
    return (
      <div role="status" className="p-4 text-sm text-muted-foreground">
        Indexing conversation…
      </div>
    );
  if (history === "unsupported")
    return (
      <div className="flex h-full min-h-0 flex-col">
        <p className="px-4 py-1 text-xs text-muted-foreground">
          Full-history seeking is unavailable. Older history loads in pages.{" "}
          {props.onRetryHistory ? (
            <button type="button" className="underline" onClick={() => void props.onRetryHistory?.()}>
              Retry index
            </button>
          ) : null}
        </p>
        <div className="min-h-0 flex-1">
          <Transcript {...props} navigationThreadId={undefined} />
        </div>
      </div>
    );
  return (
    <Transcript
      {...props}
      indexedHistory={history}
      hasOlderHistory={false}
      loadingOlderHistory={false}
      onLoadOlderHistory={undefined}
      navigationThreadId={undefined}
    />
  );
}

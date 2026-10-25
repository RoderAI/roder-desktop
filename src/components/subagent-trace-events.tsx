import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { roderIpc } from "@/lib/roder-ipc";
import type { SubagentTraceDelta, SubagentTraceSummary } from "@/types/roder";

export function TraceEvents({ trace }: { trace: SubagentTraceSummary }): React.JSX.Element {
  const [events, setEvents] = useState<{ position: number; event: SubagentTraceDelta }[]>([]);
  const [offset, setOffset] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function load(): Promise<void> {
    if (offset === null) return;
    setLoading(true);
    setError(null);
    try {
      const page = await roderIpc.readSubagentTrace(trace.parent.threadId, trace.traceId, { offset, limit: 100 });
      const entries = page.events.map((event, index) => ({ position: offset + index, event }));
      setEvents((current) => [...current, ...entries]);
      setOffset(page.nextOffset ?? null);
    } catch (cause) {
      setError(String(cause));
    }
    setLoading(false);
  }
  useMountEffect(() => {
    void load();
  });
  return (
    <div className="mx-2 mt-2 max-h-80 overflow-auto rounded-lg bg-muted/30 p-3">
      {events.map(({ event, position }) => (
        <div key={`${event.traceId}:${position}`} className="border-b border-border py-2 last:border-0">
          <span className="text-sm font-medium text-muted-foreground">{event.item.type}</span>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-sm font-normal">
            {traceEventText(event)}
          </pre>
        </div>
      ))}
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading trace…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!loading && !error && !events.length ? (
        <p className="text-sm text-muted-foreground">No trace events recorded.</p>
      ) : null}
      {offset !== null && !loading ? (
        <Button size="sm" onClick={() => void load()}>
          {error ? "Retry" : "Load more events"}
        </Button>
      ) : null}
    </div>
  );
}

function traceEventText(event: SubagentTraceDelta): string {
  const item = event.item;
  if (item.type === "message" || item.type === "reasoning") return item.content.text;
  if (item.type === "toolResult") return item.output.text;
  if (item.type === "toolCall") return item.toolName;
  return item.detail || statusLabel(item.status);
}

function statusLabel(status: string): string {
  return status.replace(/_/gu, " ").replace(/^./u, (value) => value.toUpperCase());
}

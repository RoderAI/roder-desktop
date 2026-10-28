import { useState } from "react";
import { CircleDot, MessageSquare, Terminal, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageContent } from "@/components/message-content";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { roderIpc } from "@/lib/roder-ipc";
import { cn } from "@/lib/utils";
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
    <div className="mx-2 mt-2 max-h-80 overflow-auto rounded-lg bg-background px-3 py-1 ring-1 ring-border/70">
      {events.map(({ event, position }) => (
        <TraceEventContent key={`${event.traceId}:${position}`} event={event} />
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

export function TraceEventContent({ event }: { event: SubagentTraceDelta }): React.JSX.Element {
  const { Icon, label, text, markdown, failed, truncated } = traceEventPresentation(event.item);

  return (
    <div className="min-w-0 border-b border-border/60 py-3 last:border-0">
      <div
        className={cn(
          "mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground",
          failed && "text-destructive",
        )}
      >
        <Icon aria-hidden="true" className="size-3.5" />
        {label}
      </div>
      {markdown ? (
        <MessageContent text={text} />
      ) : (
        <pre className="whitespace-pre-wrap break-words font-mono text-sm font-normal">{text}</pre>
      )}
      {truncated && <p className="mt-2 text-sm text-muted-foreground">Content truncated by the runtime.</p>}
    </div>
  );
}

function traceEventPresentation(item: SubagentTraceDelta["item"]) {
  const base = { Icon: Terminal, markdown: false, failed: false, truncated: false };
  switch (item.type) {
    case "message":
    case "reasoning":
      return {
        ...base,
        Icon: MessageSquare,
        markdown: true,
        label: item.type === "message" ? `${statusLabel(item.role)} message` : "Reasoning",
        text: item.content.text,
        truncated: Boolean(item.content.truncated),
      };
    case "toolResult":
      return {
        ...base,
        Icon: item.isError ? XCircle : Terminal,
        failed: item.isError,
        label: item.isError ? "Tool error" : "Tool output",
        text: item.output.text,
        truncated: Boolean(item.output.truncated),
      };
    case "toolCall":
      return { ...base, label: "Tool call", text: item.toolName };
    case "status":
      return { ...base, Icon: CircleDot, label: "Status", text: item.detail || statusLabel(item.status) };
  }
}

function statusLabel(status: string): string {
  return status.replace(/_/gu, " ").replace(/^./u, (value) => value.toUpperCase());
}

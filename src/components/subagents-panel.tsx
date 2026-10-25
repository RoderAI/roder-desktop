import { useState } from "react";
import { Bot, ChevronDown, ChevronRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { TraceEvents } from "@/components/subagent-trace-events";
import { relativeAge } from "@/lib/relative-age";
import { activeSubagentTraces, doneSubagentTraces, subagentTraceBlurb } from "@/lib/subagent-traces";
import { cn } from "@/lib/utils";
import { useRoderStore } from "@/stores/roder-store";
import type { SubagentTraceView } from "@/types/roder";

const donePageSize = 10;

const avatarPalette = [
  { bg: "oklch(0.92 0.06 20)", fg: "oklch(0.45 0.14 20)" },
  { bg: "oklch(0.93 0.07 95)", fg: "oklch(0.48 0.12 95)" },
  { bg: "oklch(0.92 0.05 250)", fg: "oklch(0.42 0.12 250)" },
  { bg: "oklch(0.93 0.06 150)", fg: "oklch(0.42 0.11 150)" },
  { bg: "oklch(0.92 0.06 310)", fg: "oklch(0.45 0.12 310)" },
  { bg: "oklch(0.93 0.05 60)", fg: "oklch(0.48 0.1 60)" },
] as const;

type SubagentsPanelProps = {
  threadId: string;
};

export function SubagentsPanel({ threadId }: SubagentsPanelProps): React.JSX.Element {
  const traces = useRoderStore((state) => state.subagentTracesByThread[threadId] ?? emptyTraces);
  const [expanded, setExpanded] = useState(true);
  const [doneVisibleCount, setDoneVisibleCount] = useState(donePageSize);
  const active = activeSubagentTraces(traces);
  const done = doneSubagentTraces(traces);
  const visibleDone = done.slice(0, doneVisibleCount);
  const remainingDone = Math.max(0, done.length - visibleDone.length);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-4 py-4">
        <h2 className="text-base font-semibold text-foreground">Overview</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={expanded}
          aria-controls="overview-subagents"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
          <span className="text-base font-medium">Subagents</span>
          <span className="rounded-md bg-muted/40 px-1.5 text-sm text-muted-foreground">{traces.length}</span>
          {active.length ? <span className="ml-auto text-sm text-muted-foreground">{active.length} active</span> : null}
        </button>
        <div id="overview-subagents" hidden={!expanded}>
          {!traces.length ? (
            <p className="px-3 py-5 text-sm font-normal text-muted-foreground">
              {threadId
                ? "Subagents will appear here when this thread delegates work."
                : "Open a thread to see its subagents."}
            </p>
          ) : null}
          <ul className="mt-1 space-y-0.5">
            {active.map((trace) => (
              <SubagentTraceRow key={trace.traceId} trace={trace} />
            ))}
            {visibleDone.map((trace) => (
              <SubagentTraceRow key={trace.traceId} trace={trace} />
            ))}
          </ul>
          {remainingDone > 0 ? (
            <button
              type="button"
              className="mt-2 rounded-md px-3 py-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setDoneVisibleCount((count) => count + donePageSize)}
            >
              Show {Math.min(donePageSize, remainingDone)} more completed
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const emptyTraces: SubagentTraceView[] = [];

function SubagentTraceRow({ trace }: { trace: SubagentTraceView }): React.JSX.Element {
  const [showTrace, setShowTrace] = useState(false);
  const child = useRoderStore(
    (state) =>
      state.threadDetails[trace.childThreadId] ?? state.threads.find((thread) => thread.id === trace.childThreadId),
  );
  const blurb = subagentTraceBlurb(trace);
  const age = relativeAge(trace.updatedAt);
  const model = trace.model || child?.model;
  const status = trace.status.replace(/_/gu, " ");

  return (
    <li className="rounded-xl px-2 py-2.5 hover:bg-accent/60">
      <div className="flex items-start gap-2.5">
        <SubagentAvatar seed={`${trace.role}:${trace.title}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="min-w-0 truncate">{trace.role || "Subagent"}</span>
            <span className="ml-auto shrink-0">{status}</span>
          </div>
          {trace.childThreadId ? (
            <Link
              to="/threads/$threadId"
              params={{ threadId: trace.childThreadId }}
              search={true}
              className="mt-0.5 block truncate rounded-md text-base font-medium text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {trace.title}
            </Link>
          ) : (
            <button
              type="button"
              className="mt-0.5 block w-full truncate rounded-md text-left text-base font-medium focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setShowTrace(!showTrace)}
            >
              {trace.title}
            </button>
          )}
          <p className="mt-0.5 truncate text-sm font-normal text-muted-foreground">{model || "Model not reported"}</p>
          <p className="mt-1 line-clamp-2 text-sm font-normal text-muted-foreground">{blurb}</p>
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              className="rounded-md text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={showTrace}
              onClick={() => setShowTrace(!showTrace)}
            >
              {showTrace ? "Hide trace" : "Show trace"}
            </button>
            {age ? <span className="ml-auto text-sm text-muted-foreground">{age}</span> : null}
          </div>
        </div>
      </div>
      {showTrace ? <TraceEvents trace={trace} /> : null}
    </li>
  );
}

export function SubagentAvatar({ seed, className }: { seed: string; className?: string }): React.JSX.Element {
  const color = avatarPalette[hashSeed(seed) % avatarPalette.length];
  return (
    <span
      className={cn("grid size-7 shrink-0 place-items-center rounded-full", className)}
      style={{ backgroundColor: color.bg, color: color.fg }}
      aria-hidden="true"
    >
      <Bot className="size-3.5" />
    </span>
  );
}

function hashSeed(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

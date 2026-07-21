import { useState } from "react";
import { Bot } from "lucide-react";
import { relativeAge } from "@/lib/relative-age";
import {
  activeSubagentTraces,
  doneSubagentTraces,
  subagentTraceBlurb,
} from "@/lib/subagent-traces";
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
  const [doneVisibleCount, setDoneVisibleCount] = useState(donePageSize);
  const active = activeSubagentTraces(traces);
  const done = doneSubagentTraces(traces);
  const visibleDone = done.slice(0, doneVisibleCount);
  const remainingDone = Math.max(0, done.length - visibleDone.length);

  if (traces.length === 0) {
    return (
      <div className="flex h-full flex-col px-4 py-5">
        <h2 className="text-base font-semibold text-foreground">Subagents</h2>
        <div className="mt-8 flex flex-1 flex-col items-center justify-center rounded-lg bg-muted/30 px-6 py-10 text-center">
          <p className="text-base font-medium text-foreground">No subagents yet</p>
          <p className="mt-1 max-w-xs text-sm font-normal text-muted-foreground">
            When this thread spawns subagents, active and completed work will show up here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-4 py-4">
        <h2 className="text-base font-semibold text-foreground">Subagents</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {active.length > 0 ? (
          <section className="mb-4">
            <h3 className="px-2 pb-2 text-sm font-semibold text-foreground">Active</h3>
            <ul className="space-y-0.5">
              {active.map((trace) => (
                <SubagentTraceRow key={trace.traceId} trace={trace} />
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <h3 className="px-2 pb-2 text-sm font-semibold text-foreground">
            Done{done.length > 0 ? ` · ${done.length}` : ""}
          </h3>
          {done.length === 0 ? (
            <p className="px-2 text-sm font-normal text-muted-foreground">No completed subagents yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {visibleDone.map((trace) => (
                <SubagentTraceRow key={trace.traceId} trace={trace} />
              ))}
            </ul>
          )}
          {remainingDone > 0 ? (
            <button
              type="button"
              className="mt-2 px-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setDoneVisibleCount((count) => count + donePageSize)}
            >
              Show {Math.min(donePageSize, remainingDone)} more
            </button>
          ) : null}
        </section>
      </div>
    </div>
  );
}

const emptyTraces: SubagentTraceView[] = [];

function SubagentTraceRow({ trace }: { trace: SubagentTraceView }): React.JSX.Element {
  const blurb = subagentTraceBlurb(trace);
  const age = relativeAge(trace.updatedAt);

  return (
    <li className="flex items-start gap-2.5 rounded-xl px-2 py-2.5 hover:bg-accent/60">
      <SubagentAvatar seed={`${trace.role}:${trace.title}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-medium text-foreground">{trace.title}</div>
        <p className="mt-0.5 line-clamp-2 text-sm font-normal text-muted-foreground">{blurb}</p>
      </div>
      {age ? <span className="shrink-0 pt-0.5 text-sm font-normal text-muted-foreground">{age}</span> : null}
    </li>
  );
}

export function SubagentAvatar({
  seed,
  className,
}: {
  seed: string;
  className?: string;
}): React.JSX.Element {
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

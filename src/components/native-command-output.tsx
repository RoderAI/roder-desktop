import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import type { NativeCommandOutput as NativeCommandOutputModel } from "@/lib/native-command-formatters";
import { cn } from "@/lib/utils";

export function NativeCommandOutput({ output }: { output: NativeCommandOutputModel | null }): React.JSX.Element | null {
  if (!output) {
    return null;
  }
  const Icon = toneIcon(output.tone);
  return (
    <section
      className={cn(
        "mx-auto mb-3 w-full max-w-3xl px-5",
        output.tone === "error" && "text-destructive",
        output.tone === "warning" && "text-amber-700 dark:text-amber-300",
      )}
      aria-live={output.tone === "error" ? "assertive" : "polite"}
    >
      <div className="rounded-xl bg-card/95 px-3.5 py-3 text-base shadow-sm ring-1 ring-border/70">
        <div className="flex min-w-0 items-start gap-2.5">
          <Icon className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-foreground">{output.title}</div>
            {output.body && <div className="mt-1 text-muted-foreground">{output.body}</div>}
            {output.rows && output.rows.length > 0 && (
              <div className="mt-2 divide-y divide-border/70 overflow-hidden rounded-lg border border-border/70">
                {output.rows.map((row) => (
                  <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">{row.title}</div>
                      {row.detail && <div className="truncate text-sm text-muted-foreground">{row.detail}</div>}
                    </div>
                    {row.meta && <div className="self-center text-sm text-muted-foreground">{row.meta}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function toneIcon(tone: NativeCommandOutputModel["tone"]) {
  if (tone === "success") {
    return CheckCircle2;
  }
  if (tone === "warning") {
    return TriangleAlert;
  }
  if (tone === "error") {
    return AlertCircle;
  }
  return Info;
}

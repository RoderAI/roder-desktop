import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const primaryActionClassName = "bg-primary text-primary-foreground hover:bg-primary/90";

export function StepIntro({ title, description }: { title: string; description: string }): React.JSX.Element {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="max-w-[60ch] text-base text-muted-foreground">{description}</p>
    </header>
  );
}

export function StatusPill({
  ready,
  readyLabel,
  idleLabel,
}: {
  ready: boolean;
  readyLabel: string;
  idleLabel: string;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-sm",
        ready ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
      )}
    >
      {ready ? (
        <span className="inline-flex items-center gap-1">
          <Check className="size-3.5" />
          {readyLabel}
        </span>
      ) : (
        idleLabel
      )}
    </span>
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Rejects when `work` has not settled within `ms`. The underlying request is not cancelled; this only
 * stops the UI from waiting on it forever.
 */
export function withDeadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    work.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

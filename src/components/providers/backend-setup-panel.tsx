import { CheckCircle2, ExternalLink, KeyRound, LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import { errorMessage, primaryActionClassName } from "@/components/onboarding/onboarding-primitives";
import { Button } from "@/components/ui/button";
import { useRoderStore } from "@/stores/roder-store";
import type { BackendSetupState, ExternalAgentBackendId } from "@/types/roder";

type BackendSetupPanelProps = {
  backend: ExternalAgentBackendId;
  state: BackendSetupState;
  onRetry?: () => void;
  onDismiss?: () => void;
};

export function BackendSetupPanel({
  backend,
  state,
  onRetry,
  onDismiss,
}: BackendSetupPanelProps): React.JSX.Element | null {
  const submitBackendSetupCode = useRoderStore((store) => store.submitBackendSetupCode);
  const cancelBackendSetup = useRoderStore((store) => store.cancelBackendSetup);
  const [code, setCode] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (state.backend !== backend || state.phase === "idle") {
    return null;
  }

  const label = backend === "codex" ? "Codex" : "Antigravity";
  const inProgress =
    state.phase === "checking" ||
    state.phase === "downloading" ||
    state.phase === "extracting" ||
    state.phase === "verifying" ||
    state.phase === "awaiting-browser" ||
    state.phase === "submitting-code" ||
    state.phase === "connecting";

  const downloadPercent =
    state.phase === "downloading" && state.downloadTotal && state.downloadTotal > 0
      ? Math.min(100, Math.round(((state.downloadBytes ?? 0) / state.downloadTotal) * 100))
      : null;

  async function handleSubmitCode(): Promise<void> {
    const trimmed = code.trim();
    if (!trimmed) {
      return;
    }
    setSubmitError(null);
    try {
      await submitBackendSetupCode(trimmed);
      setCode("");
    } catch (err) {
      setSubmitError(errorMessage(err));
    }
  }

  async function handleCancel(): Promise<void> {
    setSubmitError(null);
    setCode("");
    await cancelBackendSetup().catch(() => undefined);
    onDismiss?.();
  }

  function openAuthLink(): void {
    if (!state.authUrl) {
      return;
    }
    setSubmitError(null);
    void window.roderDesktop.openExternal(state.authUrl).catch((err: unknown) => {
      setSubmitError(errorMessage(err));
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-muted/30 p-4 ring-1 ring-border/70">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          {state.phase === "completed" ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
          ) : inProgress || state.phase === "awaiting-code" ? (
            <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
          ) : null}
          <div className="min-w-0">
            <div className="text-base font-medium text-foreground">
              {state.phase === "awaiting-code"
                ? `Finish ${label} sign-in in your browser`
                : state.phase === "awaiting-browser"
                  ? `Finish ${label} sign-in in your browser`
                  : state.phase === "completed"
                    ? `${label} connected`
                    : state.phase === "error"
                      ? `${label} setup failed`
                      : `Setting up ${label}`}
            </div>
            {state.message && state.phase !== "error" && (
              <p className="mt-0.5 text-sm text-muted-foreground">{state.message}</p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {state.authUrl && (state.phase === "awaiting-code" || state.phase === "awaiting-browser") && (
            <Button type="button" variant="outline" size="sm" onClick={openAuthLink}>
              <ExternalLink className="size-3.5" />
              Open sign-in
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="rounded-md text-muted-foreground hover:text-foreground"
            aria-label={state.phase === "completed" || state.phase === "error" ? "Dismiss setup" : "Cancel setup"}
            onClick={() => void handleCancel()}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      {state.phase === "downloading" && (
        <div className="flex flex-col gap-1.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${downloadPercent ?? 20}%` }}
            />
          </div>
          {downloadPercent !== null && (
            <div className="text-xs tabular-nums text-muted-foreground">{downloadPercent}% downloaded</div>
          )}
        </div>
      )}

      {(state.phase === "awaiting-code" || state.phase === "submitting-code") && (
        <div className="flex items-center gap-2">
          <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg bg-card px-3 ring-1 ring-border/70 focus-within:ring-ring">
            <KeyRound className="size-4 shrink-0 text-muted-foreground" />
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={code}
              aria-label="Google authorization code or callback URL"
              placeholder="Paste authorization code or callback URL..."
              disabled={state.phase === "submitting-code"}
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground disabled:opacity-50"
              onChange={(event) => setCode(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleSubmitCode();
                }
              }}
            />
          </label>
          <Button
            type="button"
            className={primaryActionClassName}
            disabled={state.phase === "submitting-code" || code.trim().length === 0}
            onClick={() => void handleSubmitCode()}
          >
            {state.phase === "submitting-code" ? "Completing..." : "Complete sign-in"}
          </Button>
        </div>
      )}

      {(state.error || submitError) && (
        <div className="flex items-center justify-between gap-3">
          <p role="alert" className="min-w-0 flex-1 text-sm text-destructive">
            {submitError ?? state.error}
          </p>
          {onRetry && state.phase === "error" && (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

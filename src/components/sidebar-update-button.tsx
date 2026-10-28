import { ArrowUpCircle, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { shouldShowUpdateButton, updateButtonLabel, type AppUpdateStatus } from "@/lib/app-update";

export function SidebarUpdateButton(): React.JSX.Element | null {
  const [status, setStatus] = useState<AppUpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function acceptStatus(next: AppUpdateStatus): void {
    if (next.state === "error") {
      setError(next.message);
      setStatus((previous) =>
        previous && "availableVersion" in previous
          ? { state: "available", currentVersion: previous.currentVersion, availableVersion: previous.availableVersion }
          : next,
      );
    } else {
      setError(null);
      setStatus(next);
    }
  }

  useMountEffect(() => {
    let cancelled = false;
    const desktop = window.roderDesktop;
    if (!desktop?.appUpdateStatus) {
      return;
    }

    let receivedEvent = false;
    const unsubscribe = desktop.onAppUpdateStatus?.((next) => {
      receivedEvent = true;
      if (!cancelled) acceptStatus(next);
    });
    // Subscribe first so a late snapshot cannot overwrite a downloaded update.
    void (async () => {
      try {
        const next = await desktop.appUpdateStatus();
        if (cancelled || receivedEvent) return;
        acceptStatus(next);
        if (next.state === "ready" || next.state === "downloading") return;
        const checked = await desktop.appUpdateCheck?.(false);
        if (!cancelled && !receivedEvent && checked) acceptStatus(checked);
      } catch {
        // Background availability checks are best-effort; don't strand the UI.
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  });

  if (!status || !shouldShowUpdateButton(status)) {
    return null;
  }

  async function onClick(): Promise<void> {
    if (!window.roderDesktop?.appUpdateInstall) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await window.roderDesktop.appUpdateInstall();
      acceptStatus(next);
    } catch {
      setError("Unable to update. Click to try again.");
    } finally {
      setBusy(false);
    }
  }

  return <SidebarUpdatePill status={status} busy={busy} error={error} onClick={() => void onClick()} />;
}

export function SidebarUpdatePill({
  status,
  busy = false,
  error = null,
  onClick,
}: {
  status: AppUpdateStatus;
  busy?: boolean;
  error?: string | null;
  onClick: () => void;
}): React.JSX.Element | null {
  if (!shouldShowUpdateButton(status)) return null;
  const downloading = status.state === "downloading" || busy;
  const Icon = status.state === "ready" ? RefreshCw : ArrowUpCircle;
  const label = error ? "Retry update" : updateButtonLabel(status);
  const text = downloading ? "Updating" : error ? "Retry update" : status.state === "ready" ? "Restart" : "Update";

  return (
    <button
      type="button"
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
      disabled={downloading}
      onClick={onClick}
      aria-label={label}
      aria-busy={downloading}
      title={error || label}
    >
      {downloading ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      ) : (
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      )}
      <span>{text}</span>
      {error ? (
        <span className="sr-only" role="alert">
          {error}
        </span>
      ) : null}
    </button>
  );
}

export function SidebarUpdateButtonContent({ status }: { status: AppUpdateStatus }): React.JSX.Element | null {
  if (!shouldShowUpdateButton(status)) {
    return null;
  }
  return <span>{updateButtonLabel(status)}</span>;
}

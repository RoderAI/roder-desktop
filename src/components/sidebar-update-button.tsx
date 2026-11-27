import { ArrowUpCircle, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { shouldShowUpdateButton, updateButtonLabel, type AppUpdateStatus } from "@/lib/app-update";
import { cn } from "@/lib/utils";

export function SidebarUpdateButton(): React.JSX.Element | null {
  const [status, setStatus] = useState<AppUpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const statusEventVersion = useRef(0);

  function acceptStatus(next: AppUpdateStatus): void {
    if (next.state === "error") {
      setError(next.message);
      setStatus((previous) => {
        const availableVersion =
          next.availableVersion ?? (previous && "availableVersion" in previous ? previous.availableVersion : undefined);
        return availableVersion ? { state: "available", currentVersion: next.currentVersion, availableVersion } : next;
      });
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
      if (!cancelled) {
        statusEventVersion.current += 1;
        acceptStatus(next);
      }
    });
    // Subscribe first so a late snapshot cannot overwrite a downloaded update.
    void (async () => {
      try {
        const next = await desktop.appUpdateStatus();
        if (cancelled || receivedEvent) return;
        acceptStatus(next);
        if (
          next.state === "ready" ||
          next.state === "downloading" ||
          (next.state === "error" && next.availableVersion)
        ) {
          return;
        }
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
    const version = statusEventVersion.current;
    try {
      const next = await window.roderDesktop.appUpdateInstall();
      if (statusEventVersion.current === version) acceptStatus(next);
    } catch {
      if (statusEventVersion.current === version) setError("Unable to update. Click to try again.");
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
  const { download, label, text } = updatePillPresentation(status, busy, error);
  const isBusy = download !== null || busy;
  const Icon = status.state === "ready" ? RefreshCw : ArrowUpCircle;

  return (
    <div className="relative flex shrink-0">
      <button
        type="button"
        className="inline-flex h-7 min-w-28 items-center justify-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 text-xs font-medium text-primary transition-colors enabled:hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait"
        disabled={isBusy}
        onClick={onClick}
        aria-label={label}
        aria-busy={isBusy}
        title={error || label}
      >
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{text}</span>
        {download?.percentLabel && <span className="min-w-6 text-right tabular-nums">{download.percentLabel}</span>}
        {error ? (
          <span className="sr-only" role="alert">
            {error}
          </span>
        ) : null}
      </button>
      {download && <UpdateDownloadMeter percent={download.percent} />}
    </div>
  );
}

function updatePillPresentation(status: AppUpdateStatus, busy: boolean, error: string | null) {
  const downloadStatus = status.state === "available" && busy ? { ...status, state: "downloading" as const } : status;
  if (downloadStatus.state === "downloading") {
    const reported = downloadStatus.percent;
    const percent =
      reported !== undefined && Number.isFinite(reported)
        ? Math.min(100, Math.max(0, Math.floor(reported)))
        : undefined;
    const finishing = percent === 100;
    return {
      text: finishing ? "Finishing" : "Updating",
      label: finishing ? "Finishing update" : updateButtonLabel(downloadStatus),
      download: { percent, percentLabel: percent !== undefined && !finishing ? `${percent}%` : undefined },
    };
  }
  if (error) return { text: "Retry update", label: "Retry update", download: null };
  return {
    text: status.state === "ready" ? "Restart" : "Update",
    label: updateButtonLabel(status),
    download: null,
  };
}

function UpdateDownloadMeter({ percent }: { percent: number | undefined }): React.JSX.Element {
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full text-primary"
      role="progressbar"
      aria-label="Update download progress"
      aria-valuenow={percent}
      aria-valuetext={percent === 100 ? "Download complete, preparing restart" : undefined}
    >
      <rect
        className={cn(
          "update-progress-outline",
          percent === undefined
            ? "[animation:update-progress-lap_1.6s_linear_infinite] motion-reduce:animate-none"
            : "transition-[stroke-dasharray] duration-300 ease-out motion-reduce:transition-none",
        )}
        pathLength="100"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray={percent === undefined ? "20 80" : `${percent} 100`}
      />
    </svg>
  );
}

export function SidebarUpdateButtonContent({ status }: { status: AppUpdateStatus }): React.JSX.Element | null {
  if (!shouldShowUpdateButton(status)) {
    return null;
  }
  return <span>{updateButtonLabel(status)}</span>;
}

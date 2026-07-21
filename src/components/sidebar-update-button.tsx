import { ArrowUpCircle, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  shouldShowUpdateButton,
  updateButtonLabel,
  type AppUpdateStatus,
} from "@/lib/app-update";
import { cn } from "@/lib/utils";

export function SidebarUpdateButton(): React.JSX.Element | null {
  const [status, setStatus] = useState<AppUpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useMountEffect(() => {
    let cancelled = false;
    const desktop = window.roderDesktop;
    if (!desktop?.appUpdateStatus) {
      return;
    }

    void desktop.appUpdateStatus().then((next) => {
      if (!cancelled) setStatus(next);
    });
    void desktop.appUpdateCheck?.(false).then((next) => {
      if (!cancelled) setStatus(next);
    });

    const unsubscribe = desktop.onAppUpdateStatus?.((next) => {
      if (!cancelled) setStatus(next);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  });

  if (!status || !shouldShowUpdateButton(status)) {
    return null;
  }

  const visibleStatus = status;

  async function onClick(): Promise<void> {
    if (!window.roderDesktop?.appUpdateInstall) {
      return;
    }
    setBusy(true);
    try {
      const next = await window.roderDesktop.appUpdateInstall();
      setStatus(next);
    } finally {
      setBusy(false);
    }
  }

  const downloading = visibleStatus.state === "downloading" || busy;
  const Icon = visibleStatus.state === "ready" ? RefreshCw : ArrowUpCircle;
  const label = updateButtonLabel(visibleStatus);

  return (
    <button
      type="button"
      className={cn(
        buttonVariants({ variant: "ghost" }),
        "squircle-corners mb-1 h-10 w-full justify-start gap-2 rounded-xl px-2 text-base text-sidebar-foreground",
        "bg-sidebar-active/20 hover:bg-sidebar-active/25",
      )}
      disabled={downloading}
      onClick={() => void onClick()}
      aria-label={label}
    >
      {downloading ? (
        <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
      ) : (
        <Icon className="size-4 shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate text-left font-medium">{label}</span>
    </button>
  );
}

export function SidebarUpdateButtonContent({
  status,
}: {
  status: AppUpdateStatus;
}): React.JSX.Element | null {
  if (!shouldShowUpdateButton(status)) {
    return null;
  }
  return <span>{updateButtonLabel(status)}</span>;
}

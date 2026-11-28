import { Accessibility, Check, ScanLine } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import type { MacComputerUsePermission, MacComputerUsePermissions } from "@/lib/macos-computer-use";

const items = [
  {
    id: "accessibility",
    icon: Accessibility,
    title: "Accessibility",
    detail: "Lets CuaDriver click and type in apps.",
  },
  { id: "screenRecording", icon: ScanLine, title: "Screen Recording", detail: "Lets CuaDriver capture screenshots." },
] as const;
const setupGuide = "https://cua.ai/docs/cua-driver/quickstart";

export function MacComputerUsePermissionCard({
  onReadyChange,
}: {
  onReadyChange?: (ready: boolean) => void;
}): React.JSX.Element | null {
  if (
    typeof window === "undefined" ||
    window.roderDesktop?.platform !== "darwin" ||
    !window.roderDesktop.macComputerUsePermissions
  ) {
    return null;
  }
  return <PermissionCard onReadyChange={onReadyChange} />;
}

function PermissionCard({ onReadyChange }: { onReadyChange?: (ready: boolean) => void }): React.JSX.Element {
  const [permissions, setPermissions] = useState<MacComputerUsePermissions | null>(null);
  const [checking, setChecking] = useState(true);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  useMountEffect(() => {
    let mounted = true;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      setChecking(true);
      try {
        const current = await window.roderDesktop.macComputerUsePermissions();
        if (mounted) {
          setPermissions(current);
          setStatusUnavailable(false);
          onReadyChange?.(current.accessibility === true && current.screenRecording === true);
        }
      } catch {
        if (mounted) {
          setPermissions(null);
          setStatusUnavailable(true);
          onReadyChange?.(false);
        }
      } finally {
        inFlight = false;
        if (mounted) setChecking(false);
      }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    return () => {
      mounted = false;
      window.removeEventListener("focus", refresh);
    };
  });

  async function openSettings(permission: MacComputerUsePermission): Promise<void> {
    setOpenError(null);
    try {
      await window.roderDesktop.openMacComputerUseSettings(permission);
    } catch {
      setOpenError("Could not open System Settings. Open it manually and choose Privacy & Security.");
    }
  }

  async function openSetupGuide(): Promise<void> {
    setOpenError(null);
    try {
      await window.roderDesktop.openExternal(setupGuide);
    } catch {
      setOpenError("Could not open the CuaDriver setup guide.");
    }
  }

  return (
    <div className="space-y-3 text-left">
      <ul
        className="divide-y divide-border rounded-xl bg-card px-4 ring-1 ring-border/70"
        aria-label="macOS permissions"
      >
        {items.map(({ id, icon: Icon, title, detail }) => {
          const granted = permissions?.[id];
          return (
            <li key={id} className="flex min-h-16 items-center gap-3 py-3">
              <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{title}</p>
                <p className="text-sm text-muted-foreground">
                  {detail}
                  {granted === false && " Not allowed in System Settings."}
                </p>
              </div>
              {granted === true ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-sm text-foreground" role="status">
                  <Check className="size-4" aria-hidden="true" />
                  Allowed
                </span>
              ) : (
                <Button
                  variant="default"
                  size="sm"
                  aria-label={`Open System Settings for ${title}`}
                  onClick={() => void openSettings(id)}
                >
                  Open Settings
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-muted-foreground" role="status">
        {checking
          ? "Checking CuaDriver permissions…"
          : statusUnavailable
            ? "Could not check permissions. You can still review them in System Settings."
            : permissions?.installed === false
              ? "Local computer use requires the separate CuaDriver app in Applications."
              : permissions?.accessibility == null || permissions.screenRecording == null
                ? "Permissions not verified. Open CuaDriver and return here to check again."
                : null}
      </p>
      <p className="text-sm text-muted-foreground">
        In macOS Privacy &amp; Security, turn on access for CuaDriver. If it isn’t listed, add it from Applications. If
        macOS asks, quit and reopen CuaDriver after granting access. This does not turn on computer use in Roder.{" "}
        <button
          type="button"
          className="rounded-sm text-primary underline-offset-2 hover:underline focus-visible:outline-ring"
          onClick={() => void openSetupGuide()}
        >
          CuaDriver setup guide
        </button>
      </p>
      {openError && (
        <p className="text-sm text-destructive" role="alert">
          {openError}
        </p>
      )}
    </div>
  );
}

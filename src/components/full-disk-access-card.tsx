import { HardDrive } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function FullDiskAccessCard({ onSettingsOpened }: { onSettingsOpened?: () => void }): React.JSX.Element {
  const [openError, setOpenError] = useState(false);

  async function openSettings(): Promise<void> {
    setOpenError(false);
    try {
      await window.roderDesktop.openMacFullDiskAccessSettings();
    } catch {
      setOpenError(true);
      return;
    }
    onSettingsOpened?.();
  }

  return (
    <div className="space-y-3 text-left">
      <div className="flex min-h-16 items-center gap-3 rounded-xl bg-card px-4 py-3 ring-1 ring-border/70">
        <HardDrive className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Full Disk Access</p>
          <p className="text-sm text-muted-foreground">Optional access to files macOS normally protects.</p>
        </div>
        <Button
          size="sm"
          className="shrink-0"
          aria-label="Open System Settings for Full Disk Access"
          onClick={() => void openSettings()}
        >
          Open Settings
        </Button>
      </div>
      {openError && (
        <p className="text-sm text-destructive" role="alert">
          Could not open System Settings. Go to Privacy &amp; Security → Full Disk Access manually.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        This is a broad permission that can include private data from Mail and Messages. Leave it off unless a task
        needs it. To grant or remove access for Roder, go to Privacy &amp; Security in System Settings. Restart Roder if
        macOS asks.
      </p>
    </div>
  );
}

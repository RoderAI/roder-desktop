import { useMountEffect } from "@/hooks/use-mount-effect";
import { WINDOWS_CLOUD_MACHINES_NOTICE } from "@/lib/cloud-machines";
import { cn } from "@/lib/utils";
import { useCloudMachinesStore } from "@/stores/cloud-machines-store";
import { useRoderStore } from "@/stores/roder-store";

export function ThreadExecutionMachine({ threadId }: { threadId: string }): React.JSX.Element {
  const thread = useRoderStore((state) => state.threads.find((entry) => entry.id === threadId));
  const label = !thread
    ? "Loading execution machine..."
    : thread.runner && thread.runner.providerId !== "unix-local"
      ? `${thread.runner.providerId}: ${thread.runner.workspace}`
      : "Local machine";
  return (
    <span
      title="Execution machine is fixed for this thread. Start a new thread to change it."
      className="max-w-56 truncate px-2 text-sm text-muted-foreground"
    >
      {label}
    </span>
  );
}

export function CloudMachinePicker({
  disabled = false,
  className,
}: {
  disabled?: boolean;
  className?: string;
}): React.JSX.Element {
  const machines = useCloudMachinesStore((state) => state.machines);
  const providers = useCloudMachinesStore((state) => state.providers);
  const selectedMachineId = useCloudMachinesStore((state) => state.selectedMachineId);
  const select = useCloudMachinesStore((state) => state.select);
  const refresh = useCloudMachinesStore((state) => state.refresh);
  const cloudSupported = typeof window === "undefined" || window.roderDesktop?.platform !== "win32";

  useMountEffect(() => {
    void refresh().catch(() => {
      // Saved profiles remain visible when discovery is temporarily unavailable.
    });
  });

  const missingSelection = selectedMachineId && !machines.some((machine) => machine.id === selectedMachineId);

  return (
    <select
      aria-label="Execution machine for new thread"
      title={
        cloudSupported
          ? "Choose where the new thread runs. Configure profiles in Settings > Cloud Machines."
          : WINDOWS_CLOUD_MACHINES_NOTICE
      }
      disabled={disabled}
      value={selectedMachineId}
      onChange={(event) => select(event.currentTarget.value)}
      className={cn(
        "h-8 min-w-0 max-w-56 rounded-lg border border-input bg-background px-2 text-base font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        className,
      )}
    >
      <option value="">Local machine</option>
      {missingSelection && (
        <option value={selectedMachineId} disabled>
          Unavailable machine - choose another
        </option>
      )}
      {machines.map((machine) => {
        const supported = cloudSupported && providers.some((provider) => provider.provider_id === machine.providerId);
        return (
          <option key={machine.id} value={machine.id} disabled={!supported}>
            {machine.name}
            {!cloudSupported ? " (unavailable on Windows)" : supported ? "" : " (provider unavailable)"}
          </option>
        );
      })}
    </select>
  );
}

import { Cloud, Network, Server } from "lucide-react";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  effectiveRunnerProviderId,
  isRemoteRunner,
  remoteRunnerLabel,
  WINDOWS_CLOUD_MACHINES_NOTICE,
} from "@/lib/cloud-machines";
import { cn } from "@/lib/utils";
import { useCloudMachinesStore } from "@/stores/cloud-machines-store";
import { useRoderStore } from "@/stores/roder-store";

export function ThreadExecutionMachine({ threadId }: { threadId: string }): React.JSX.Element {
  const thread = useRoderStore((state) => state.threads.find((entry) => entry.id === threadId));
  const machines = useCloudMachinesStore((state) => state.machines);
  const remote = Boolean(thread && isRemoteRunner(thread.runner));
  const providerId = effectiveRunnerProviderId(thread?.runner);
  const label = !thread
    ? "Loading execution machine..."
    : remote && thread.runner
      ? `${remoteRunnerLabel(thread.runner, machines)} (${providerId})`
      : "Local machine";
  return (
    <span
      title={
        remote && thread?.runner
          ? `${providerId}: ${thread.runner.workspace} — Execution machine is fixed for this thread.`
          : "Execution machine is fixed for this thread. Start a new thread to change it."
      }
      className="flex min-w-0 max-w-36 items-center gap-1 truncate px-1.5 text-sm text-muted-foreground @[520px]:max-w-56 @[520px]:px-2"
    >
      {remote &&
        (providerId === "tailscale" ? (
          <Network className="size-3.5 shrink-0" />
        ) : providerId === "ssh" ? (
          <Server className="size-3.5 shrink-0" />
        ) : (
          <Cloud className="size-3.5 shrink-0" />
        ))}
      <span className="truncate">{label}</span>
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
        "h-7 min-w-0 max-w-32 cursor-pointer rounded-full border-0 bg-transparent px-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 @[520px]:h-8 @[520px]:max-w-52 @[520px]:px-2.5 @[520px]:text-base",
        selectedMachineId && "bg-accent/60 text-foreground",
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

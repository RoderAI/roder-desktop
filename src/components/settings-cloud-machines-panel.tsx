import { Cloud, RefreshCw, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { validateMachineConfig, WINDOWS_CLOUD_MACHINES_NOTICE } from "@/lib/cloud-machines";
import { machineProviderHelp } from "@/lib/cloud-machine-providers";
import { cn } from "@/lib/utils";
import { useCloudMachinesStore } from "@/stores/cloud-machines-store";

const fieldClass =
  "min-h-8 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function SettingsCloudMachinesPanel(): React.JSX.Element {
  const machines = useCloudMachinesStore((state) => state.machines);
  const providers = useCloudMachinesStore((state) => state.providers);
  const busy = useCloudMachinesStore((state) => state.busy);
  const error = useCloudMachinesStore((state) => state.error);
  const refresh = useCloudMachinesStore((state) => state.refresh);
  const save = useCloudMachinesStore((state) => state.save);
  const remove = useCloudMachinesStore((state) => state.remove);
  const [name, setName] = useState("");
  const [providerId, setProviderId] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [readRoots, setReadRoots] = useState("");
  const [configText, setConfigText] = useState("{}");
  const [formError, setFormError] = useState("");
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const formId = useId();
  const selectedProvider = providers.find((provider) => provider.provider_id === providerId) ?? providers[0];
  const providerHelp = machineProviderHelp(selectedProvider?.provider_id ?? "");
  const cloudSupported = typeof window === "undefined" || window.roderDesktop?.platform !== "win32";

  useMountEffect(() => {
    void refresh().catch(() => {
      // The store exposes discovery errors without losing saved profiles.
    });
  });

  async function addMachine(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError("");
    if (!cloudSupported) {
      setFormError(WINDOWS_CLOUD_MACHINES_NOTICE);
      return;
    }
    let config: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(configText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setFormError("Provider configuration must be a JSON object.");
        return;
      }
      config = parsed as Record<string, unknown>;
      validateMachineConfig(config);
    } catch {
      setFormError("Enter a valid JSON object without credentials. Supply secrets through the app-server environment.");
      return;
    }
    if (!selectedProvider || !name.trim() || !workspace.trim()) {
      setFormError("Enter a name, select a provider, and enter the remote workspace path.");
      return;
    }
    try {
      await save({
        name: name.trim(),
        providerId: selectedProvider.provider_id,
        workspace: workspace.trim(),
        config,
        readRoots: readRoots
          .split("\n")
          .map((root) => root.trim())
          .filter(Boolean),
      });
      setName("");
      setWorkspace("");
      setReadRoots("");
      setConfigText("{}");
    } catch {
      setFormError("Could not save the machine. Check the connection and provider configuration, then try again.");
    }
  }

  async function removeMachine(id: string): Promise<void> {
    setFormError("");
    try {
      await remove(id);
      setPendingRemoval(null);
    } catch {
      setFormError("Could not remove the machine. Try again.");
    }
  }

  return (
    <section className="rounded-xl bg-card shadow-sm ring-1 ring-border/70">
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-base font-medium">
            <Cloud className="size-4" />
            Cloud Machines
          </h1>
          <p className="mt-1 text-base text-muted-foreground">
            Configure remote machines and cloud sandboxes, then choose where a new Roder thread runs.
          </p>
        </div>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void refresh().catch(() => {})}>
          <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
          Refresh
        </Button>
      </header>

      {(error || formError) && (
        <div role="alert" className="border-b border-border px-5 py-3 text-base text-destructive">
          {formError || error}
        </div>
      )}

      <div className="space-y-4 px-5 py-4">
        <div>
          <h2 className="text-base font-medium">Saved machines</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Profiles apply to new threads only. Removing a profile does not stop or delete the remote machine.
          </p>
        </div>
        {machines.length === 0 ? (
          <p className="rounded-lg bg-muted/30 p-3 text-base text-muted-foreground">
            No cloud machines configured. Add a profile below, or keep running threads locally.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {machines.map((machine) => {
              const supported = providers.some((provider) => provider.provider_id === machine.providerId);
              return (
                <li key={machine.id} className="flex flex-wrap items-center gap-3 p-3">
                  <Cloud className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-base font-medium">{machine.name}</div>
                    <div className="break-all text-sm text-muted-foreground">
                      {machine.providerId} &middot; {machine.workspace}
                    </div>
                    {!supported && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        Provider unavailable in the current runtime. Refresh providers or use another profile.
                      </p>
                    )}
                  </div>
                  {pendingRemoval === machine.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm">Remove profile?</span>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => setPendingRemoval(null)}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="warning"
                        disabled={busy}
                        onClick={() => void removeMachine(machine.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      aria-label={`Remove ${machine.name}`}
                      onClick={() => setPendingRemoval(machine.id)}
                    >
                      <Trash2 className="size-3.5" />
                      Remove
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {!cloudSupported && (
        <p className="px-5 pb-4 text-base text-muted-foreground" role="status">
          {WINDOWS_CLOUD_MACHINES_NOTICE}
        </p>
      )}
      <form onSubmit={(event) => void addMachine(event)} className="space-y-4 border-t border-border px-5 py-4">
        <h2 className="text-base font-medium">Add a cloud machine</h2>
        {providers.length === 0 && (
          <p className="text-base text-muted-foreground" role="status">
            {busy
              ? "Loading remote runner providers..."
              : "No remote runner providers available. Connect to the app-server and refresh to discover supported providers."}
          </p>
        )}
        <fieldset disabled={!cloudSupported || busy || providers.length === 0} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label htmlFor={`${formId}-name`} className="space-y-1.5 text-base">
              <span>Machine name</span>
              <input
                id={`${formId}-name`}
                className={fieldClass}
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                placeholder="Development sandbox"
                required
              />
            </label>
            <label htmlFor={`${formId}-provider`} className="space-y-1.5 text-base">
              <span>Runner provider</span>
              <select
                id={`${formId}-provider`}
                className={fieldClass}
                value={selectedProvider?.provider_id ?? ""}
                onChange={(event) => {
                  setProviderId(event.currentTarget.value);
                  setConfigText("{}");
                }}
              >
                {providers.map((provider) => (
                  <option key={provider.provider_id} value={provider.provider_id}>
                    {provider.provider_id}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {selectedProvider?.setup_hint && (
            <p className="whitespace-pre-wrap break-words rounded-lg bg-muted/30 p-3 text-sm text-muted-foreground">
              {selectedProvider.setup_hint}
            </p>
          )}
          {selectedProvider && (
            <div className="space-y-2 rounded-lg bg-muted/30 p-3 text-sm text-muted-foreground">
              <p>{providerHelp.description}</p>
              {providerHelp.environment.length > 0 && (
                <p>
                  App-server environment: <span className="font-mono">{providerHelp.environment.join(", ")}</span>
                </p>
              )}
              <div className="flex items-center justify-between gap-3">
                <span>Non-secret configuration example</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (configText.trim() === "{}" || configText.trim() === "") {
                      setConfigText(JSON.stringify(providerHelp.config, null, 2));
                    }
                  }}
                  disabled={configText.trim() !== "{}" && configText.trim() !== ""}
                >
                  Use example
                </Button>
              </div>
              <pre className="overflow-x-auto font-mono text-sm">{JSON.stringify(providerHelp.config, null, 2)}</pre>
              <p>Examples need your machine names and gateway addresses. They do not verify a connection.</p>
            </div>
          )}
          <label htmlFor={`${formId}-workspace`} className="block space-y-1.5 text-base">
            <span>Remote workspace path</span>
            <input
              id={`${formId}-workspace`}
              className={cn(fieldClass, "font-mono")}
              value={workspace}
              onChange={(event) => setWorkspace(event.currentTarget.value)}
              placeholder="/workspace/project"
              required
            />
            <span className="block text-sm text-muted-foreground">
              An existing directory on the remote machine, not a folder on this computer.
            </span>
          </label>
          <label htmlFor={`${formId}-config`} className="block space-y-1.5 text-base">
            <span>Non-secret provider configuration (JSON)</span>
            <textarea
              id={`${formId}-config`}
              className={cn(fieldClass, "min-h-24 resize-y font-mono")}
              value={configText}
              onChange={(event) => setConfigText(event.currentTarget.value)}
              spellCheck={false}
              aria-describedby={`${formId}-config-help`}
            />
          </label>
          <p id={`${formId}-config-help`} className="text-sm text-muted-foreground">
            Configuration is stored in thread metadata. Never enter passwords, API keys, or tokens here. Supply
            credentials through the app-server environment.
          </p>
          <details className="rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-base">Additional read roots</summary>
            <label htmlFor={`${formId}-roots`} className="mt-3 block space-y-1.5 text-base">
              <span>Remote paths (one per line)</span>
              <textarea
                id={`${formId}-roots`}
                className={cn(fieldClass, "min-h-16 resize-y font-mono")}
                value={readRoots}
                onChange={(event) => setReadRoots(event.currentTarget.value)}
                spellCheck={false}
                placeholder="/shared/reference"
              />
            </label>
          </details>
          <Button type="submit" size="sm" disabled={!name.trim() || !workspace.trim() || !selectedProvider}>
            Add machine
          </Button>
        </fieldset>
      </form>
    </section>
  );
}

import {
  CheckCircle2,
  Cloud,
  KeyRound,
  Pencil,
  PlugZap,
  Plus,
  RefreshCw,
  Terminal,
  Trash2,
  Unplug,
} from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  validateMachineConfig,
  WINDOWS_CLOUD_MACHINES_NOTICE,
  type CloudMachineTestResult,
} from "@/lib/cloud-machines";
import { machineProviderHelp } from "@/lib/cloud-machine-providers";
import { roderIpc } from "@/lib/roder-ipc";
import { cn } from "@/lib/utils";
import { useCloudMachinesStore } from "@/stores/cloud-machines-store";

const fieldClass =
  "min-h-8 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function SettingsCloudMachinesPanel(): React.JSX.Element {
  const machines = useCloudMachinesStore((state) => state.machines);
  const providers = useCloudMachinesStore((state) => state.providers);
  const credentialStatuses = useCloudMachinesStore((state) => state.credentialStatuses) ?? [];
  const blaxelCli = useCloudMachinesStore((state) => state.blaxelCli) ?? null;
  const blaxelWorkspaces = useCloudMachinesStore((state) => state.blaxelWorkspaces) ?? [];
  const blaxelSandboxes = useCloudMachinesStore((state) => state.blaxelSandboxes) ?? [];
  const blaxelActiveWorkspace = useCloudMachinesStore((state) => state.blaxelActiveWorkspace) ?? null;
  const loadingSandboxes = useCloudMachinesStore((state) => state.loadingSandboxes) ?? false;
  const savingCredentials = useCloudMachinesStore((state) => state.savingCredentials) ?? false;
  const busy = useCloudMachinesStore((state) => state.busy);
  const error = useCloudMachinesStore((state) => state.error);
  const refresh = useCloudMachinesStore((state) => state.refresh);
  const refreshBlaxelSandboxes = useCloudMachinesStore((state) => state.refreshBlaxelSandboxes);
  const importBlaxelCli = useCloudMachinesStore((state) => state.importBlaxelCli);
  const saveBlaxelCredentials = useCloudMachinesStore((state) => state.saveBlaxelCredentials);
  const saveProviderToken = useCloudMachinesStore((state) => state.saveProviderToken);
  const clearProviderCredentials = useCloudMachinesStore((state) => state.clearProviderCredentials);
  const createBlaxelSandbox = useCloudMachinesStore((state) => state.createBlaxelSandbox);
  const save = useCloudMachinesStore((state) => state.save);
  const remove = useCloudMachinesStore((state) => state.remove);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [providerId, setProviderId] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [readRoots, setReadRoots] = useState("");
  const [configText, setConfigText] = useState("{}");
  const [formError, setFormError] = useState("");
  const [formNotice, setFormNotice] = useState("");
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);

  // Blaxel credentials form state
  const [showBlaxelKeyForm, setShowBlaxelKeyForm] = useState(false);
  const [blaxelApiKey, setBlaxelApiKey] = useState("");
  const [blaxelWorkspaceInput, setBlaxelWorkspaceInput] = useState("");
  const [credentialFeedback, setCredentialFeedback] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  // Generic provider token input (for Sprites / gateway providers)
  const [providerTokenInput, setProviderTokenInput] = useState("");

  // Guided Blaxel sandbox picker / creation state
  const [blaxelMode, setBlaxelMode] = useState<"existing" | "create">("existing");
  const [selectedSandboxName, setSelectedSandboxName] = useState("");
  const [newSandboxName, setNewSandboxName] = useState("");
  const [newSandboxImage, setNewSandboxImage] = useState("blaxel/py-app:latest");
  const [newSandboxMemory, setNewSandboxMemory] = useState("4096");
  const [creatingSandbox, setCreatingSandbox] = useState(false);

  // Connection test results keyed by machine ID
  const [testingMachineId, setTestingMachineId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, CloudMachineTestResult>>({});

  const formId = useId();
  const blaxelProviderAvailable = providers.some((provider) => provider.provider_id === "blaxel");
  const blaxelCredential = credentialStatuses.find((entry) => entry.providerId === "blaxel") ?? null;
  const blaxelConnected = Boolean(blaxelCredential?.configured);
  const defaultProvider =
    providers.find((provider) => provider.provider_id === providerId) ??
    (blaxelProviderAvailable ? providers.find((provider) => provider.provider_id === "blaxel") : undefined) ??
    providers.find((provider) => provider.provider_id !== "unix-local") ??
    providers[0];
  const selectedProvider = defaultProvider;
  const isBlaxelSelected = selectedProvider?.provider_id === "blaxel";
  const providerHelp = machineProviderHelp(selectedProvider?.provider_id ?? "");
  const selectedProviderCredential = selectedProvider
    ? (credentialStatuses.find((entry) => entry.providerId === selectedProvider.provider_id) ?? null)
    : null;
  const cloudSupported = typeof window === "undefined" || window.roderDesktop?.platform !== "win32";
  const effectiveBlaxelWorkspace = blaxelActiveWorkspace || blaxelCredential?.workspace || blaxelCli?.workspace || "";

  useMountEffect(() => {
    void refresh().catch(() => {
      // The store exposes discovery errors without losing saved profiles.
    });
  });

  function resetForm(): void {
    setEditingId(null);
    setName("");
    setWorkspace("");
    setReadRoots("");
    setConfigText("{}");
    setSelectedSandboxName("");
    setNewSandboxName("");
    setFormError("");
  }

  function applyProviderSelection(nextProviderId: string): void {
    setProviderId(nextProviderId);
    setFormError("");
    setFormNotice("");
    if (nextProviderId === "blaxel") {
      if (!workspace.trim()) setWorkspace("/workspace");
      setConfigText(
        JSON.stringify(
          {
            sandbox_name: selectedSandboxName || "",
            working_dir: workspace.trim() || "/workspace",
            ...(effectiveBlaxelWorkspace ? { workspace: effectiveBlaxelWorkspace } : {}),
            cleanup: "keep",
          },
          null,
          2,
        ),
      );
    } else {
      setConfigText("{}");
    }
  }

  function syncBlaxelGuidedConfig(sandboxName: string, nextWorkspace: string): void {
    const cleanWorkspace = nextWorkspace.trim() || "/workspace";
    const config: Record<string, unknown> = {
      sandbox_name: sandboxName,
      working_dir: cleanWorkspace,
      cleanup: "keep",
    };
    if (effectiveBlaxelWorkspace) {
      config.workspace = effectiveBlaxelWorkspace;
    }
    setConfigText(JSON.stringify(config, null, 2));
  }

  async function handleImportBlaxelCli(): Promise<void> {
    if (!importBlaxelCli) return;
    setCredentialFeedback(null);
    try {
      await importBlaxelCli(blaxelCli?.workspace ?? undefined);
      setShowBlaxelKeyForm(false);
      setCredentialFeedback({
        kind: "info",
        text: `Connected to Blaxel${blaxelCli?.workspace ? ` (${blaxelCli.workspace})` : ""} via Blaxel CLI and refreshed the engine.`,
      });
    } catch (cause) {
      setCredentialFeedback({
        kind: "error",
        text: cause instanceof Error ? cause.message : "Could not import credentials from Blaxel CLI.",
      });
    }
  }

  async function handleSaveBlaxelKey(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!saveBlaxelCredentials) return;
    setCredentialFeedback(null);
    try {
      await saveBlaxelCredentials({
        apiKey: blaxelApiKey.trim(),
        workspace: blaxelWorkspaceInput.trim() || undefined,
      });
      setBlaxelApiKey("");
      setShowBlaxelKeyForm(false);
      setCredentialFeedback({
        kind: "info",
        text: "Saved encrypted Blaxel credentials and refreshed the engine.",
      });
    } catch (cause) {
      setCredentialFeedback({
        kind: "error",
        text: cause instanceof Error ? cause.message : "Could not save Blaxel credentials.",
      });
    }
  }

  async function handleClearCredentials(targetProviderId: string): Promise<void> {
    if (!clearProviderCredentials) return;
    setCredentialFeedback(null);
    try {
      await clearProviderCredentials(targetProviderId);
      setCredentialFeedback({
        kind: "info",
        text: `Disconnected ${targetProviderId} credentials.`,
      });
    } catch (cause) {
      setCredentialFeedback({
        kind: "error",
        text: cause instanceof Error ? cause.message : "Could not disconnect credentials.",
      });
    }
  }

  async function handleSaveGenericToken(): Promise<void> {
    if (!selectedProvider || !providerTokenInput.trim() || !saveProviderToken) return;
    setCredentialFeedback(null);
    try {
      await saveProviderToken(selectedProvider.provider_id, providerTokenInput.trim());
      setProviderTokenInput("");
      setCredentialFeedback({
        kind: "info",
        text: `Saved encrypted ${selectedProvider.provider_id} credentials and refreshed the engine.`,
      });
    } catch (cause) {
      setCredentialFeedback({
        kind: "error",
        text: cause instanceof Error ? cause.message : "Could not save provider token.",
      });
    }
  }

  async function handleCreateSandbox(): Promise<string | null> {
    if (!createBlaxelSandbox) return null;
    const cleanName = newSandboxName.trim().toLowerCase();
    if (!cleanName) {
      setFormError("Enter a sandbox name (lowercase letters, numbers, and hyphens).");
      return null;
    }
    setCreatingSandbox(true);
    setFormError("");
    try {
      const targetWorkspace = workspace.trim() || "/workspace";
      const memory = Number.parseInt(newSandboxMemory.trim(), 10);
      const created = await createBlaxelSandbox({
        name: cleanName,
        workspace: effectiveBlaxelWorkspace || undefined,
        image: newSandboxImage.trim() || "blaxel/py-app:latest",
        memory: Number.isFinite(memory) && memory >= 512 ? memory : 4096,
        workingDir: targetWorkspace,
      });
      setSelectedSandboxName(created.name);
      setBlaxelMode("existing");
      setNewSandboxName("");
      if (!name.trim()) setName(created.name);
      if (!workspace.trim()) setWorkspace(targetWorkspace);
      syncBlaxelGuidedConfig(created.name, targetWorkspace);
      setFormNotice(`Sandbox "${created.name}" is deployed and ready.`);
      return created.name;
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Could not create Blaxel sandbox.");
      return null;
    } finally {
      setCreatingSandbox(false);
    }
  }

  async function addMachine(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError("");
    setFormNotice("");
    if (!cloudSupported) {
      setFormError(WINDOWS_CLOUD_MACHINES_NOTICE);
      return;
    }
    if (!selectedProvider) {
      setFormError("Select a runner provider first.");
      return;
    }

    let resolvedWorkspace = workspace.trim();
    let resolvedName = name.trim();
    let config: Record<string, unknown>;

    if (isBlaxelSelected) {
      if (!resolvedWorkspace) resolvedWorkspace = "/workspace";
      let sandboxName = selectedSandboxName.trim();
      if (blaxelMode === "create") {
        const created = await handleCreateSandbox();
        if (!created) return;
        sandboxName = created;
        if (!resolvedName) resolvedName = created;
      }
      if (!sandboxName) {
        try {
          const parsed: unknown = JSON.parse(configText);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const candidate = (parsed as Record<string, unknown>).sandbox_name;
            if (typeof candidate === "string" && candidate.trim()) {
              sandboxName = candidate.trim();
            }
          }
        } catch {
          // handled below
        }
      }
      if (!sandboxName) {
        setFormError("Choose an existing Blaxel sandbox or create a new one.");
        return;
      }
      if (!resolvedName) resolvedName = sandboxName;

      try {
        const parsed: unknown = configText.trim() ? JSON.parse(configText) : {};
        const baseConfig =
          parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
        config = validateMachineConfig({
          ...baseConfig,
          sandbox_name: sandboxName,
          working_dir: resolvedWorkspace,
          ...(effectiveBlaxelWorkspace && !baseConfig.workspace ? { workspace: effectiveBlaxelWorkspace } : {}),
          cleanup: typeof baseConfig.cleanup === "string" ? baseConfig.cleanup : "keep",
        });
      } catch {
        setFormError(
          "Enter a valid JSON object without credentials. Supply secrets through the app-server environment.",
        );
        return;
      }
    } else {
      try {
        const parsed: unknown = JSON.parse(configText);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setFormError("Provider configuration must be a JSON object.");
          return;
        }
        config = parsed as Record<string, unknown>;
        validateMachineConfig(config);
      } catch {
        setFormError(
          "Enter a valid JSON object without credentials. Supply secrets through the app-server environment.",
        );
        return;
      }
      if (!resolvedName || !resolvedWorkspace) {
        setFormError("Enter a name, select a provider, and enter the remote workspace path.");
        return;
      }
    }

    try {
      await save({
        ...(editingId ? { id: editingId } : {}),
        name: resolvedName,
        providerId: selectedProvider.provider_id,
        workspace: resolvedWorkspace,
        config,
        readRoots: readRoots
          .split("\n")
          .map((root) => root.trim())
          .filter(Boolean),
      });
      setFormNotice(editingId ? `Updated "${resolvedName}".` : `Saved "${resolvedName}".`);
      resetForm();
    } catch {
      setFormError("Could not save the machine. Check the connection and provider configuration, then try again.");
    }
  }

  async function startEditingMachine(id: string): Promise<void> {
    setFormError("");
    setFormNotice("");
    try {
      const { machine } = await roderIpc.getCloudMachineProfile(id);
      setEditingId(machine.id);
      setName(machine.name);
      setProviderId(machine.providerId);
      setWorkspace(machine.workspace);
      setReadRoots((machine.readRoots ?? []).join("\n"));
      setConfigText(JSON.stringify(machine.config, null, 2));
      if (machine.providerId === "blaxel") {
        const sbx = typeof machine.config.sandbox_name === "string" ? machine.config.sandbox_name : "";
        setSelectedSandboxName(sbx);
        setBlaxelMode("existing");
      }
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Could not load machine profile.");
    }
  }

  async function testMachineConnection(id: string): Promise<void> {
    setTestingMachineId(id);
    setFormError("");
    try {
      const result = await roderIpc.testCloudMachine({ id });
      setTestResults((current) => ({ ...current, [id]: result }));
    } catch (cause) {
      setTestResults((current) => ({
        ...current,
        [id]: {
          ok: false,
          status: "ERROR",
          message: cause instanceof Error ? cause.message : "Connection test failed.",
        },
      }));
    } finally {
      setTestingMachineId(null);
    }
  }

  async function removeMachine(id: string): Promise<void> {
    setFormError("");
    try {
      await remove(id);
      if (editingId === id) resetForm();
      setPendingRemoval(null);
    } catch {
      setFormError("Could not remove the machine. Try again.");
    }
  }

  const canSubmit = isBlaxelSelected
    ? Boolean(
        selectedProvider &&
        (blaxelMode === "create" ? newSandboxName.trim() : selectedSandboxName.trim() || name.trim()),
      )
    : Boolean(name.trim() && workspace.trim() && selectedProvider);

  return (
    <section className="rounded-xl bg-card shadow-sm ring-1 ring-border/70">
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-base font-medium">
            <Cloud className="size-4" />
            Cloud Machines
          </h1>
          <p className="mt-1 text-base text-muted-foreground">
            Connect remote sandboxes so agents, files, terminal, search, and git review work natively on remote
            machines.
          </p>
        </div>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void refresh().catch(() => {})}>
          <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
          Refresh
        </Button>
      </header>

      {((error && (credentialFeedback?.kind !== "error" || credentialFeedback.text !== error)) || formError) && (
        <div role="alert" className="border-b border-border px-5 py-3 text-base text-destructive">
          {formError || error}
        </div>
      )}

      {formNotice && (
        <div role="status" className="border-b border-border bg-muted/30 px-5 py-2.5 text-sm text-foreground">
          {formNotice}
        </div>
      )}

      {cloudSupported && blaxelProviderAvailable && (
        <div className="space-y-3 border-b border-border px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-base font-medium">
                <KeyRound className="size-4 text-muted-foreground" />
                Blaxel connection
              </h2>
              <p className="mt-1 text-sm font-normal text-muted-foreground">
                Credentials are encrypted in OS secure storage and injected automatically into the Roder engine and
                remote workspace tools.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {blaxelConnected ? (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="size-3.5" />
                    Connected{effectiveBlaxelWorkspace ? ` · ${effectiveBlaxelWorkspace}` : ""}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={savingCredentials}
                    onClick={() => setShowBlaxelKeyForm((open) => !open)}
                  >
                    Update key
                  </Button>
                  {blaxelCredential?.source !== "env" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={savingCredentials}
                      onClick={() => void handleClearCredentials("blaxel")}
                    >
                      <Unplug className="size-3.5" />
                      Disconnect
                    </Button>
                  )}
                </>
              ) : (
                <>
                  {blaxelCli?.authenticated && (
                    <Button
                      type="button"
                      size="sm"
                      disabled={savingCredentials}
                      onClick={() => void handleImportBlaxelCli()}
                    >
                      <Terminal className="size-3.5" />
                      {savingCredentials
                        ? "Connecting…"
                        : `Connect from Blaxel CLI${blaxelCli.workspace ? ` (${blaxelCli.workspace})` : ""}`}
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant={blaxelCli?.authenticated ? "outline" : "default"}
                    disabled={savingCredentials}
                    onClick={() => setShowBlaxelKeyForm((open) => !open)}
                  >
                    <KeyRound className="size-3.5" />
                    {showBlaxelKeyForm ? "Hide key form" : "Use API key"}
                  </Button>
                </>
              )}
            </div>
          </div>

          {blaxelConnected && blaxelCredential?.preview && (
            <p className="text-sm font-normal text-muted-foreground">
              Active key: <span className="font-mono">{blaxelCredential.preview}</span>
              {" · "}
              Source:{" "}
              {blaxelCredential.source === "blaxel-cli"
                ? "Imported from Blaxel CLI"
                : blaxelCredential.source === "env"
                  ? "Process environment"
                  : "Saved API key"}
              {blaxelSandboxes.length > 0 ? ` · ${blaxelSandboxes.length} sandboxes available` : ""}
            </p>
          )}

          {credentialFeedback && (
            <p
              role={credentialFeedback.kind === "error" ? "alert" : "status"}
              className={cn(
                "text-sm font-normal",
                credentialFeedback.kind === "error" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {credentialFeedback.text}
            </p>
          )}

          {showBlaxelKeyForm && (
            <form
              onSubmit={(event) => void handleSaveBlaxelKey(event)}
              className="grid gap-3 rounded-lg bg-muted/30 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_auto]"
            >
              <label htmlFor={`${formId}-blaxel-key`} className="space-y-1 text-sm">
                <span className="text-muted-foreground">Blaxel API key</span>
                <input
                  id={`${formId}-blaxel-key`}
                  type="password"
                  className={cn(fieldClass, "font-mono")}
                  value={blaxelApiKey}
                  onChange={(event) => setBlaxelApiKey(event.currentTarget.value)}
                  placeholder="bl_..."
                  autoComplete="off"
                  required
                />
              </label>
              <label htmlFor={`${formId}-blaxel-workspace`} className="space-y-1 text-sm">
                <span className="text-muted-foreground">Workspace (optional)</span>
                <input
                  id={`${formId}-blaxel-workspace`}
                  className={cn(fieldClass, "font-mono")}
                  value={blaxelWorkspaceInput}
                  onChange={(event) => setBlaxelWorkspaceInput(event.currentTarget.value)}
                  placeholder={effectiveBlaxelWorkspace || "auto-detect"}
                />
              </label>
              <div className="flex items-end">
                <Button type="submit" size="sm" disabled={savingCredentials || !blaxelApiKey.trim()}>
                  {savingCredentials ? "Saving…" : "Connect"}
                </Button>
              </div>
            </form>
          )}
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
              const testResult = testResults[machine.id];
              return (
                <li key={machine.id} className="space-y-2 p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Cloud className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="break-words text-base font-medium">{machine.name}</div>
                      <div className="break-all font-mono text-sm text-muted-foreground">
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
                      <div className="flex flex-wrap items-center gap-1">
                        {machine.providerId === "blaxel" && cloudSupported && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={busy || testingMachineId === machine.id}
                            onClick={() => void testMachineConnection(machine.id)}
                          >
                            <PlugZap className="size-3.5" />
                            {testingMachineId === machine.id ? "Testing…" : "Test"}
                          </Button>
                        )}
                        {cloudSupported && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            aria-label={`Edit ${machine.name}`}
                            onClick={() => void startEditingMachine(machine.id)}
                          >
                            <Pencil className="size-3.5" />
                            Edit
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          aria-label={`Remove ${machine.name}`}
                          onClick={() => setPendingRemoval(machine.id)}
                        >
                          <Trash2 className="size-3.5" />
                          Remove
                        </Button>
                      </div>
                    )}
                  </div>
                  {testResult && (
                    <p
                      role={testResult.ok ? "status" : "alert"}
                      className={cn(
                        "rounded-md px-2.5 py-1.5 text-sm font-normal",
                        testResult.ok
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : "bg-destructive/10 text-destructive",
                      )}
                    >
                      {testResult.message}
                    </p>
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
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-medium">{editingId ? "Edit cloud machine" : "Add a cloud machine"}</h2>
          {editingId && (
            <Button type="button" size="sm" variant="ghost" onClick={resetForm}>
              Cancel edit
            </Button>
          )}
        </div>
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
                placeholder={isBlaxelSelected ? "roder-remote-dev" : "Development sandbox"}
                required={!isBlaxelSelected}
              />
            </label>
            <label htmlFor={`${formId}-provider`} className="space-y-1.5 text-base">
              <span>Runner provider</span>
              <select
                id={`${formId}-provider`}
                className={fieldClass}
                value={selectedProvider?.provider_id ?? ""}
                onChange={(event) => applyProviderSelection(event.currentTarget.value)}
              >
                {providers.map((provider) => (
                  <option key={provider.provider_id} value={provider.provider_id}>
                    {provider.provider_id}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {isBlaxelSelected ? (
            <div className="space-y-3 rounded-xl bg-muted/30 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex rounded-lg bg-background p-0.5 ring-1 ring-border/70">
                  <button
                    type="button"
                    className={cn(
                      "rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
                      blaxelMode === "existing"
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setBlaxelMode("existing")}
                  >
                    Existing sandbox
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
                      blaxelMode === "create"
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setBlaxelMode("create")}
                  >
                    Create new sandbox
                  </button>
                </div>
                {blaxelConnected && refreshBlaxelSandboxes && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={loadingSandboxes}
                    onClick={() => void refreshBlaxelSandboxes(effectiveBlaxelWorkspace || undefined)}
                  >
                    <RefreshCw className={cn("size-3.5", loadingSandboxes && "animate-spin")} />
                    {loadingSandboxes ? "Loading…" : "Reload sandboxes"}
                  </Button>
                )}
              </div>

              {!blaxelConnected && (
                <p className="text-sm font-normal text-muted-foreground">
                  Connect Blaxel above to browse and provision sandboxes directly, or enter a sandbox name manually.
                </p>
              )}

              {blaxelMode === "existing" ? (
                <div className="space-y-2">
                  {blaxelSandboxes.length > 0 ? (
                    <label htmlFor={`${formId}-blaxel-sandbox-select`} className="block space-y-1.5 text-base">
                      <span>Blaxel sandbox</span>
                      <select
                        id={`${formId}-blaxel-sandbox-select`}
                        className={cn(fieldClass, "font-mono")}
                        value={selectedSandboxName}
                        onChange={(event) => {
                          const nextSandbox = event.currentTarget.value;
                          setSelectedSandboxName(nextSandbox);
                          if (!name.trim() && nextSandbox) setName(nextSandbox);
                          const nextWorkspace = workspace.trim() || "/workspace";
                          if (!workspace.trim()) setWorkspace(nextWorkspace);
                          syncBlaxelGuidedConfig(nextSandbox, nextWorkspace);
                        }}
                      >
                        <option value="">Choose a sandbox…</option>
                        {blaxelSandboxes.map((sandbox) => (
                          <option key={sandbox.name} value={sandbox.name}>
                            {sandbox.name}
                            {sandbox.region ? ` (${sandbox.region})` : ""}
                            {sandbox.status ? ` · ${sandbox.status.toLowerCase()}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label htmlFor={`${formId}-blaxel-sandbox-manual`} className="block space-y-1.5 text-base">
                      <span>Blaxel sandbox name</span>
                      <input
                        id={`${formId}-blaxel-sandbox-manual`}
                        className={cn(fieldClass, "font-mono")}
                        value={selectedSandboxName}
                        onChange={(event) => {
                          const nextSandbox = event.currentTarget.value;
                          setSelectedSandboxName(nextSandbox);
                          const nextWorkspace = workspace.trim() || "/workspace";
                          syncBlaxelGuidedConfig(nextSandbox, nextWorkspace);
                        }}
                        placeholder="my-dev-sandbox"
                      />
                    </label>
                  )}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-3">
                  <label htmlFor={`${formId}-new-sandbox-name`} className="space-y-1.5 text-base">
                    <span>New sandbox name</span>
                    <input
                      id={`${formId}-new-sandbox-name`}
                      className={cn(fieldClass, "font-mono")}
                      value={newSandboxName}
                      onChange={(event) => {
                        const next = event.currentTarget.value;
                        setNewSandboxName(next);
                        if (!name.trim() || name === newSandboxName) {
                          setName(next);
                        }
                        if (!workspace.trim()) setWorkspace("/workspace");
                      }}
                      placeholder="roder-remote-dev"
                    />
                  </label>
                  <label htmlFor={`${formId}-new-sandbox-image`} className="space-y-1.5 text-base">
                    <span>Image</span>
                    <input
                      id={`${formId}-new-sandbox-image`}
                      className={cn(fieldClass, "font-mono")}
                      value={newSandboxImage}
                      onChange={(event) => setNewSandboxImage(event.currentTarget.value)}
                      placeholder="blaxel/py-app:latest"
                    />
                  </label>
                  <label htmlFor={`${formId}-new-sandbox-memory`} className="space-y-1.5 text-base">
                    <span>Memory (MB)</span>
                    <input
                      id={`${formId}-new-sandbox-memory`}
                      type="number"
                      min={512}
                      step={512}
                      className={cn(fieldClass, "font-mono")}
                      value={newSandboxMemory}
                      onChange={(event) => setNewSandboxMemory(event.currentTarget.value)}
                    />
                  </label>
                </div>
              )}

              {blaxelWorkspaces.length > 1 && (
                <p className="text-sm font-normal text-muted-foreground">
                  Active Blaxel workspace: <span className="font-mono">{effectiveBlaxelWorkspace}</span>
                </p>
              )}
            </div>
          ) : (
            <>
              {selectedProvider?.setup_hint && (
                <p className="whitespace-pre-wrap break-words rounded-lg bg-muted/30 p-3 text-sm text-muted-foreground">
                  {selectedProvider.setup_hint}
                </p>
              )}
              {selectedProvider && (
                <div className="space-y-2 rounded-lg bg-muted/30 p-3 text-sm text-muted-foreground">
                  <p>{providerHelp.description}</p>
                  {providerHelp.environment.length > 0 && (
                    <div className="space-y-2">
                      <p>
                        App-server environment: <span className="font-mono">{providerHelp.environment.join(", ")}</span>
                      </p>
                      {selectedProviderCredential && typeof saveProviderToken === "function" && (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="password"
                            aria-label={`${selectedProvider.provider_id} token`}
                            className={cn(fieldClass, "max-w-xs font-mono")}
                            value={providerTokenInput}
                            onChange={(event) => setProviderTokenInput(event.currentTarget.value)}
                            placeholder={
                              selectedProviderCredential.configured
                                ? `Saved (${selectedProviderCredential.preview ?? "configured"})`
                                : `Save ${providerHelp.environment[0]}`
                            }
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={savingCredentials || !providerTokenInput.trim()}
                            onClick={() => void handleSaveGenericToken()}
                          >
                            Save key
                          </Button>
                        </div>
                      )}
                    </div>
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
                  <pre className="overflow-x-auto font-mono text-sm">
                    {JSON.stringify(providerHelp.config, null, 2)}
                  </pre>
                  <p>Examples need your machine names and gateway addresses. They do not verify a connection.</p>
                </div>
              )}
            </>
          )}

          <label htmlFor={`${formId}-workspace`} className="block space-y-1.5 text-base">
            <span>Remote workspace path</span>
            <input
              id={`${formId}-workspace`}
              className={cn(fieldClass, "font-mono")}
              value={workspace}
              onChange={(event) => {
                const next = event.currentTarget.value;
                setWorkspace(next);
                if (isBlaxelSelected && selectedSandboxName) {
                  syncBlaxelGuidedConfig(selectedSandboxName, next);
                }
              }}
              placeholder={isBlaxelSelected ? "/workspace" : "/workspace/project"}
              required={!isBlaxelSelected}
            />
            <span className="block text-sm text-muted-foreground">
              An existing directory on the remote machine, not a folder on this computer.
            </span>
          </label>

          {isBlaxelSelected ? (
            <details className="rounded-lg border border-border p-3">
              <summary className="cursor-pointer text-base">Advanced provider configuration (JSON)</summary>
              <div className="mt-3 space-y-2">
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
              </div>
            </details>
          ) : (
            <>
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
            </>
          )}

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
          <Button type="submit" size="sm" disabled={!canSubmit || creatingSandbox}>
            {blaxelMode === "create" && isBlaxelSelected ? (
              <>
                <Plus className="size-3.5" />
                {creatingSandbox ? "Provisioning sandbox…" : "Create sandbox & save machine"}
              </>
            ) : editingId ? (
              "Save changes"
            ) : (
              "Add machine"
            )}
          </Button>
        </fieldset>
      </form>
    </section>
  );
}

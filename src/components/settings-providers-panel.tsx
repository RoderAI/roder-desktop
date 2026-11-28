import { Check, ChevronRight, ClipboardCopy, LoaderCircle, RefreshCw, Search } from "lucide-react";
import { useState } from "react";
import { useSearch } from "@tanstack/react-router";
import { BackendIcon } from "@/components/agent-backend-picker";
import { BackendSetupTerminal } from "@/components/providers/backend-setup-terminal";
import { ProviderConnectCard } from "@/components/providers/provider-connect-card";
import { ProviderLogo } from "@/components/provider-logo";
import { errorMessage, primaryActionClassName, StatusPill } from "@/components/onboarding/onboarding-primitives";
import { Button } from "@/components/ui/button";
import { useProviderSetupState } from "@/hooks/use-provider-setup-state";
import { isProviderReady, providerSetupKind, providerStatusLabel } from "@/lib/onboarding";
import { providerCopy, authTypeLabel } from "@/lib/provider-copy";
import { modelKey, providerName, visibleModelIdsFor } from "@/lib/roder-models";
import { cn } from "@/lib/utils";
import { useRoderStore } from "@/stores/roder-store";
import type {
  AgentBackendId,
  AgentBackendStatus,
  AntigravityStatus,
  ClaudeCliStatus,
  ExternalAgentBackendId,
  ProviderDescriptor,
  ProviderModelDescriptor,
  RoderModel,
} from "@/types/roder";

export function ProvidersSettingsPanel(): React.JSX.Element {
  const { setupProvider } = useSearch({ from: "/settings/$section" });
  const providers = useRoderStore((state) => state.providers);
  const models = useRoderStore((state) => state.models);
  const hiddenModelIds = useRoderStore((state) => state.hiddenModelIds);
  const setModelVisibility = useRoderStore((state) => state.setModelVisibility);
  const refreshProviders = useRoderStore((state) => state.refreshProviders);
  const { claudeCli, antigravityStatus, environment, recheckClaudeCli, recheckAntigravity } = useProviderSetupState();
  const [query, setQuery] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(setupProvider ?? null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The internal mock provider is not something users set up, so it stays out of Settings too.
  const visibleProviders = providers.filter((provider) => providerSetupKind(provider) !== "hidden");
  const filteredProviders = filterProviders(visibleProviders, query);
  const selectedProvider =
    filteredProviders.find((provider) => provider.id === selectedProviderId) ?? filteredProviders[0] ?? null;

  const environmentVars = new Map(environment.map((found) => [found.providerId, found.envVar]));
  const readyProviderIds = new Set(
    visibleProviders.filter((provider) => isProviderReady(provider, claudeCli)).map((provider) => provider.id),
  );
  const visibleIds = visibleModelIdsFor(models, hiddenModelIds);
  const visibleSet = new Set(visibleIds);

  async function refresh(): Promise<void> {
    setRefreshing(true);
    setError(null);
    try {
      const latestAntigravity = await recheckAntigravity();
      if (latestAntigravity.runtimeInstalled && typeof window.roderDesktop?.antigravityConnect === "function") {
        await window.roderDesktop.antigravityConnect({ forceRefresh: true }).catch(() => undefined);
        await recheckAntigravity();
      }
      await refreshProviders();
    } catch (refreshError) {
      setError(errorMessage(refreshError));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <AgentBackendsSection
        highlightedBackend={setupProvider === "codex" || setupProvider === "antigravity" ? setupProvider : null}
        onRecheckAntigravity={recheckAntigravity}
      />

      <section className="rounded-xl bg-card shadow-sm ring-1 ring-border/70">
        <header className="flex items-start justify-between gap-6 border-b border-border px-5 py-4">
          <div>
            <h1 className="text-base font-medium">Providers</h1>
            <p className="mt-1 text-base text-muted-foreground">
              Sign in, paste an API key, or use what is already set up on this machine. {readyProviderIds.size}{" "}
              connected.
            </p>
          </div>
          <Button variant="ghost" size="sm" disabled={refreshing} onClick={() => void refresh()}>
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </header>

        <div className="flex h-12 items-center gap-3 border-b border-border px-5">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={query}
            aria-label="Search providers and models"
            className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
            placeholder="Search providers and models..."
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </div>

        {error && (
          <div role="alert" className="border-b border-border px-5 py-3 text-base text-destructive">
            {error}
          </div>
        )}

        {providers.length === 0 ? (
          <div className="px-5 py-8 text-base text-muted-foreground">
            No provider catalog loaded from the app-server yet.
          </div>
        ) : filteredProviders.length === 0 ? (
          <div className="px-5 py-8 text-base text-muted-foreground">No matching providers.</div>
        ) : (
          <div className="grid min-h-[560px] grid-cols-[minmax(240px,300px)_1fr] divide-x divide-border">
            <nav className="space-y-2 p-4" aria-label="Provider list">
              {filteredProviders.map((provider) => (
                <ProviderMenuItem
                  key={provider.id}
                  provider={provider}
                  ready={readyProviderIds.has(provider.id)}
                  environmentVar={environmentVars.get(provider.id)}
                  modelCount={provider.models?.length ?? 0}
                  selected={provider.id === selectedProvider?.id}
                  onSelect={() => setSelectedProviderId(provider.id)}
                />
              ))}
            </nav>
            {selectedProvider && (
              <ProviderDetails
                provider={selectedProvider}
                ready={readyProviderIds.has(selectedProvider.id)}
                environmentVar={environmentVars.get(selectedProvider.id)}
                claudeCli={claudeCli}
                antigravityStatus={antigravityStatus}
                models={models}
                visibleIds={visibleIds}
                visibleSet={visibleSet}
                onRecheckClaudeCli={recheckClaudeCli}
                onRecheckAntigravity={recheckAntigravity}
                onError={setError}
                onToggleModel={(modelId, visible) => setModelVisibility(modelId, visible)}
              />
            )}
          </div>
        )}
      </section>
    </div>
  );
}

const AGENT_BACKEND_ORDER: readonly AgentBackendId[] = ["roder", "codex", "antigravity"];

function AgentBackendsSection({
  highlightedBackend,
  onRecheckAntigravity,
}: {
  highlightedBackend: ExternalAgentBackendId | null;
  onRecheckAntigravity: () => Promise<AntigravityStatus>;
}): React.JSX.Element {
  const activeBackend = useRoderStore((state) => state.activeBackend);
  const agentBackends = useRoderStore((state) => state.agentBackends);
  const selectAgentBackend = useRoderStore((state) => state.selectAgentBackend);
  const connectAgentBackend = useRoderStore((state) => state.connectAgentBackend);
  const logoutAgentBackend = useRoderStore((state) => state.logoutAgentBackend);
  const applyAgentBackends = useRoderStore((state) => state.applyAgentBackends);

  const [busyBackend, setBusyBackend] = useState<AgentBackendId | null>(null);
  const [setupTerminal, setSetupTerminal] = useState<{
    backend: ExternalAgentBackendId;
    antigravityMode?: "login" | "install";
  } | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [copiedCodexCmd, setCopiedCodexCmd] = useState(false);

  async function refreshAllBackends(): Promise<void> {
    setBackendError(null);
    setBusyBackend("roder");
    try {
      const snapshot = await window.roderDesktop.agentBackendsSnapshot();
      applyAgentBackends(snapshot);
      for (const id of ["codex", "antigravity"] as const) {
        if (snapshot.backends[id]?.runtimeInstalled) {
          await connectAgentBackend(id, { forceRefresh: true }).catch(() => undefined);
        }
      }
      await onRecheckAntigravity();
    } catch (err) {
      setBackendError(errorMessage(err));
    } finally {
      setBusyBackend(null);
    }
  }

  async function useBackend(id: AgentBackendId): Promise<void> {
    setBackendError(null);
    setBusyBackend(id);
    try {
      await selectAgentBackend(id);
      if (id === "antigravity") {
        await onRecheckAntigravity();
      }
      setSetupTerminal(null);
    } catch (err) {
      setBackendError(errorMessage(err));
    } finally {
      setBusyBackend(null);
    }
  }

  async function checkBackend(
    id: ExternalAgentBackendId,
    options: { activateOnSuccess?: boolean; closeTerminalOnSuccess?: boolean } = {},
  ): Promise<void> {
    setBackendError(null);
    setBusyBackend(id);
    try {
      const snapshot = await connectAgentBackend(id, { forceRefresh: true });
      if (id === "antigravity") {
        await onRecheckAntigravity();
      }
      const status = snapshot.backends[id];
      if (status?.connected) {
        if (options.activateOnSuccess) {
          await selectAgentBackend(id);
        }
        if (options.closeTerminalOnSuccess) {
          setSetupTerminal(null);
        }
      } else {
        setBackendError(
          status?.runtimeInstalled
            ? `${status.name} is not signed in yet. Complete sign-in and try again.`
            : `${status?.name ?? id} CLI was not found on this machine.`,
        );
      }
    } catch (err) {
      setBackendError(errorMessage(err));
    } finally {
      setBusyBackend(null);
    }
  }

  async function signOutBackend(id: ExternalAgentBackendId): Promise<void> {
    setBackendError(null);
    setBusyBackend(id);
    try {
      await logoutAgentBackend(id);
      if (id === "antigravity") {
        await onRecheckAntigravity();
      }
      setSetupTerminal(null);
    } catch (err) {
      setBackendError(errorMessage(err));
    } finally {
      setBusyBackend(null);
    }
  }

  return (
    <section aria-label="Agent backend" className="rounded-xl bg-card shadow-sm ring-1 ring-border/70">
      <header className="flex items-start justify-between gap-6 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-base font-medium">Agent backend</h2>
          <p className="mt-1 text-base text-muted-foreground">
            Switch between Roder&apos;s native runtime, the Codex CLI backend, or the Antigravity CLI backend. You can
            also switch directly from the composer.
          </p>
        </div>
        <Button variant="ghost" size="sm" disabled={busyBackend !== null} onClick={() => void refreshAllBackends()}>
          <RefreshCw className={cn("size-3.5", busyBackend === "roder" && "animate-spin")} />
          Check backends
        </Button>
      </header>

      <div className="flex flex-col gap-4 p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {AGENT_BACKEND_ORDER.map((id) => {
            const info = agentBackends[id];
            const isActive = activeBackend === id;
            const isBusy = busyBackend === id;
            const highlighted = highlightedBackend === id;
            return (
              <AgentBackendCard
                key={id}
                id={id}
                info={info}
                active={isActive}
                busy={isBusy}
                anyBusy={busyBackend !== null}
                highlighted={highlighted}
                copiedCodexCmd={copiedCodexCmd}
                onUse={() => void useBackend(id)}
                onCheck={id === "roder" ? undefined : () => void checkBackend(id)}
                onOpenSetup={
                  id === "roder"
                    ? undefined
                    : (mode) => {
                        setBackendError(null);
                        setSetupTerminal({ backend: id, antigravityMode: mode });
                      }
                }
                onSignOut={id === "roder" ? undefined : () => void signOutBackend(id)}
                onCopyCodexInstall={() => {
                  void navigator.clipboard?.writeText("npm i -g @openai/codex");
                  setCopiedCodexCmd(true);
                  window.setTimeout(() => setCopiedCodexCmd(false), 1800);
                }}
              />
            );
          })}
        </div>

        {setupTerminal && (
          <BackendSetupTerminal
            key={`${setupTerminal.backend}:${setupTerminal.antigravityMode ?? "login"}`}
            backend={setupTerminal.backend}
            antigravityMode={setupTerminal.antigravityMode}
            checking={busyBackend === setupTerminal.backend}
            onCheckConnection={() =>
              checkBackend(setupTerminal.backend, { activateOnSuccess: true, closeTerminalOnSuccess: true })
            }
            onAutoComplete={() =>
              checkBackend(setupTerminal.backend, { activateOnSuccess: true, closeTerminalOnSuccess: true })
            }
            onClose={() => setSetupTerminal(null)}
          />
        )}

        {backendError && (
          <div role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {backendError}
          </div>
        )}
      </div>
    </section>
  );
}

function AgentBackendCard({
  id,
  info,
  active,
  busy,
  anyBusy,
  highlighted,
  copiedCodexCmd,
  onUse,
  onCheck,
  onOpenSetup,
  onSignOut,
  onCopyCodexInstall,
}: {
  id: AgentBackendId;
  info: AgentBackendStatus | undefined;
  active: boolean;
  busy: boolean;
  anyBusy: boolean;
  highlighted: boolean;
  copiedCodexCmd: boolean;
  onUse: () => void;
  onCheck?: () => void;
  onOpenSetup?: (mode?: "login" | "install") => void;
  onSignOut?: () => void;
  onCopyCodexInstall: () => void;
}): React.JSX.Element {
  const connected = id === "roder" ? true : Boolean(info?.connected);
  const runtimeInstalled = id === "roder" ? true : Boolean(info?.runtimeInstalled);
  const modelCount = info?.modelCount ?? 0;

  const statusLabel = active
    ? "Active"
    : connected
      ? id === "roder"
        ? "Ready"
        : `${modelCount} ${modelCount === 1 ? "model" : "models"}`
      : runtimeInstalled
        ? "CLI found"
        : "Not installed";

  return (
    <article
      aria-label={`${info?.name ?? id} agent backend`}
      className={cn(
        "flex flex-col justify-between gap-3 rounded-xl bg-background/60 p-4 ring-1 transition-colors",
        active ? "ring-primary/50 bg-primary/[0.03]" : highlighted ? "ring-ring" : "ring-border/70",
      )}
    >
      <div className="flex flex-col gap-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted/50">
              <BackendIcon backend={id} />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-base font-medium text-foreground">{info?.name ?? id}</h3>
              {id !== "roder" && connected && (
                <p className="truncate text-sm text-muted-foreground">
                  {modelCount} {modelCount === 1 ? "model" : "models"} available
                </p>
              )}
            </div>
          </div>
          <StatusPill ready={active || connected} readyLabel={statusLabel} idleLabel={statusLabel} />
        </div>
        <p className="text-sm text-muted-foreground">{info?.description}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {id === "roder" ? (
          <Button
            size="sm"
            variant={active ? "outline" : "default"}
            className={cn(!active && primaryActionClassName)}
            disabled={active || anyBusy}
            onClick={onUse}
          >
            {active ? (
              <>
                <Check className="size-3.5" />
                Active
              </>
            ) : (
              "Use Roder"
            )}
          </Button>
        ) : id === "codex" ? (
          <>
            {runtimeInstalled ? (
              <>
                <Button
                  size="sm"
                  variant={active ? "outline" : "default"}
                  className={cn(!active && primaryActionClassName)}
                  disabled={active || anyBusy}
                  onClick={onUse}
                >
                  {busy ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : active ? (
                    <Check className="size-3.5" />
                  ) : null}
                  {active ? "Active" : busy ? "Connecting..." : "Use Codex"}
                </Button>
                {!connected && onOpenSetup && (
                  <Button size="sm" variant="outline" disabled={anyBusy} onClick={() => onOpenSetup("login")}>
                    Sign in
                  </Button>
                )}
                {connected && onSignOut && (
                  <Button size="sm" variant="ghost" disabled={anyBusy} onClick={onSignOut}>
                    Sign out
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={onCopyCodexInstall}>
                  <ClipboardCopy className="size-3.5" />
                  {copiedCodexCmd ? "Copied install cmd" : "Copy install cmd"}
                </Button>
                {onCheck && (
                  <Button size="sm" variant="ghost" disabled={anyBusy} onClick={onCheck}>
                    <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
                    Check
                  </Button>
                )}
              </>
            )}
          </>
        ) : (
          <>
            {connected ? (
              <>
                <Button
                  size="sm"
                  variant={active ? "outline" : "default"}
                  className={cn(!active && primaryActionClassName)}
                  disabled={active || anyBusy}
                  onClick={onUse}
                >
                  {busy ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : active ? (
                    <Check className="size-3.5" />
                  ) : null}
                  {active ? "Active" : busy ? "Connecting..." : "Use Antigravity"}
                </Button>
                {onSignOut && (
                  <Button size="sm" variant="ghost" disabled={anyBusy} onClick={onSignOut}>
                    Sign out
                  </Button>
                )}
              </>
            ) : runtimeInstalled ? (
              <>
                {onOpenSetup && (
                  <Button
                    size="sm"
                    className={primaryActionClassName}
                    disabled={anyBusy}
                    onClick={() => onOpenSetup("login")}
                  >
                    Sign in with Google
                  </Button>
                )}
                {onCheck && (
                  <Button size="sm" variant="ghost" disabled={anyBusy} onClick={onCheck}>
                    <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
                    Check
                  </Button>
                )}
              </>
            ) : (
              <>
                {onOpenSetup && (
                  <Button
                    size="sm"
                    className={primaryActionClassName}
                    disabled={anyBusy}
                    onClick={() => onOpenSetup("install")}
                  >
                    Install & sign in
                  </Button>
                )}
                {onCheck && (
                  <Button size="sm" variant="ghost" disabled={anyBusy} onClick={onCheck}>
                    <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
                    Check
                  </Button>
                )}
              </>
            )}
          </>
        )}
      </div>
    </article>
  );
}

function ProviderMenuItem({
  provider,
  ready,
  environmentVar,
  modelCount,
  selected,
  onSelect,
}: {
  provider: ProviderDescriptor;
  ready: boolean;
  environmentVar: string | undefined;
  modelCount: number;
  selected: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const title = providerCopy[provider.id]?.title ?? (provider.name || providerName(provider.id));

  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
        selected ? "border-primary/40 bg-primary/10" : "border-transparent hover:bg-accent/70",
      )}
      onClick={onSelect}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted/50">
        <ProviderLogo provider={provider.id} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-medium">{title}</span>
        <span className="mt-0.5 block truncate text-sm text-muted-foreground">
          {providerStatusLabel({ ready, environmentVar })} · {modelCount} {modelCount === 1 ? "model" : "models"}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function ProviderDetails({
  provider,
  ready,
  environmentVar,
  claudeCli,
  antigravityStatus,
  models,
  visibleIds,
  visibleSet,
  onRecheckClaudeCli,
  onRecheckAntigravity,
  onError,
  onToggleModel,
}: {
  provider: ProviderDescriptor;
  ready: boolean;
  environmentVar: string | undefined;
  claudeCli: ClaudeCliStatus | null;
  antigravityStatus: AntigravityStatus | null;
  models: RoderModel[];
  visibleIds: string[];
  visibleSet: Set<string>;
  onRecheckClaudeCli: () => Promise<void>;
  onRecheckAntigravity: () => Promise<AntigravityStatus>;
  onError: (message: string | null) => void;
  onToggleModel: (modelId: string, visible: boolean) => void;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-5 px-6 py-5">
      <ProviderConnectCard
        provider={provider}
        ready={ready}
        environmentVar={environmentVar}
        claudeCli={claudeCli}
        antigravityStatus={antigravityStatus}
        onRecheckClaudeCli={onRecheckClaudeCli}
        onRecheckAntigravity={onRecheckAntigravity}
        onError={onError}
      />
      <ProviderMeta provider={provider} />
      <ModelAccessList
        provider={provider}
        configured={ready}
        models={models}
        visibleIds={visibleIds}
        visibleSet={visibleSet}
        onToggleModel={onToggleModel}
      />
    </section>
  );
}

function ProviderMeta({ provider }: { provider: ProviderDescriptor }): React.JSX.Element {
  const chips = [
    `ID: ${provider.id}`,
    `Auth: ${authTypeLabel(provider.authType)}`,
    provider.authLabel,
    provider.authDetail,
    provider.recommended ? "Recommended" : null,
  ].filter((chip): chip is string => Boolean(chip));

  return (
    <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
      {chips.map((chip) => (
        <span key={chip} className="rounded-full bg-muted px-2 py-1">
          {chip}
        </span>
      ))}
    </div>
  );
}

function ModelAccessList({
  provider,
  configured,
  models,
  visibleIds,
  visibleSet,
  onToggleModel,
}: {
  provider: ProviderDescriptor;
  configured: boolean;
  models: RoderModel[];
  visibleIds: string[];
  visibleSet: Set<string>;
  onToggleModel: (modelId: string, visible: boolean) => void;
}): React.JSX.Element {
  const providerModels = provider.models ?? [];
  const availableModels = models.filter((model) => model.modelProvider === provider.id);
  const availableById = new Map(availableModels.map((model) => [model.id, model]));
  const enabledCount = availableModels.filter((model) => visibleSet.has(modelKey(model))).length;

  return (
    <section className="rounded-xl border border-border bg-background/60">
      <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-base font-medium">Model access</h2>
          <p className="mt-1 text-base text-muted-foreground">
            {configured
              ? `${enabledCount} of ${availableModels.length} available in the composer.`
              : "Connect this provider before enabling individual models."}
          </p>
        </div>
        {configured && availableModels.length > 0 && (
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                for (const model of availableModels) {
                  onToggleModel(modelKey(model), true);
                }
              }}
            >
              Enable all
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={enabledCount === 0 || visibleIds.length <= enabledCount}
              onClick={() => {
                for (const model of availableModels) {
                  onToggleModel(modelKey(model), false);
                }
              }}
            >
              Disable all
            </Button>
          </div>
        )}
      </div>

      {providerModels.length === 0 ? (
        <div className="px-4 py-6 text-base text-muted-foreground">No models reported for this provider.</div>
      ) : (
        <div className="divide-y divide-border">
          {providerModels.map((providerModel) => {
            const model = availableById.get(providerModel.id);
            const key = model ? modelKey(model) : `${provider.id || "roder"}:${providerModel.id}`;
            const visible = visibleSet.has(key);
            const disabled = !configured || !model || (visible && visibleIds.length <= 1);
            return (
              <ProviderModelRow
                key={key}
                providerModel={providerModel}
                visible={visible}
                disabled={disabled}
                unavailable={!model}
                onToggle={() => onToggleModel(key, !visible)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function ProviderModelRow({
  providerModel,
  visible,
  disabled,
  unavailable,
  onToggle,
}: {
  providerModel: ProviderModelDescriptor;
  visible: boolean;
  disabled: boolean;
  unavailable: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
        visible ? "text-foreground hover:bg-accent/70" : "text-muted-foreground hover:bg-accent/40",
      )}
      disabled={disabled}
      onClick={onToggle}
    >
      <VisibilitySwitch checked={visible} disabled={disabled} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-base font-medium">{providerModel.name || providerModel.id}</span>
          {providerModel.isDefault && <span className="rounded-full bg-muted px-2 py-0.5 text-sm">Default</span>}
        </span>
        <span className="mt-0.5 block truncate text-sm text-muted-foreground">{providerModel.id}</span>
        {providerModel.description && (
          <span className="mt-1 block line-clamp-2 text-base text-muted-foreground">{providerModel.description}</span>
        )}
        {unavailable && (
          <span className="mt-1 block text-sm text-muted-foreground">
            Connect this provider to make this model available.
          </span>
        )}
      </span>
      {visible && <Check className="size-4 shrink-0 text-primary" />}
    </button>
  );
}

function VisibilitySwitch({ checked, disabled }: { checked: boolean; disabled: boolean }): React.JSX.Element {
  return (
    <span
      className={cn(
        "relative h-6 w-10 shrink-0 rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted-foreground/80",
        disabled && "opacity-50",
      )}
    >
      <span
        className={cn(
          "absolute left-1 top-1 size-4 rounded-full bg-white transition-transform",
          checked && "translate-x-4",
        )}
      />
    </span>
  );
}

function filterProviders(providers: ProviderDescriptor[], query: string): ProviderDescriptor[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return providers;
  }
  return providers.filter((provider) => {
    const models = provider.models?.map((model) => `${model.name} ${model.id}`).join(" ") ?? "";
    return `${provider.name} ${provider.id} ${provider.description} ${provider.authType} ${models}`
      .toLowerCase()
      .includes(needle);
  });
}

import { Check, ChevronRight, RefreshCw, Search } from "lucide-react";
import { useState } from "react";
import { ProviderConnectCard } from "@/components/providers/provider-connect-card";
import { ProviderLogo } from "@/components/provider-logo";
import { errorMessage } from "@/components/onboarding/onboarding-primitives";
import { Button } from "@/components/ui/button";
import { useProviderSetupState } from "@/hooks/use-provider-setup-state";
import { isProviderReady, providerSetupKind, providerStatusLabel } from "@/lib/onboarding";
import { providerCopy, authTypeLabel } from "@/lib/provider-copy";
import { modelKey, providerName, visibleModelIdsFor } from "@/lib/roder-models";
import { cn } from "@/lib/utils";
import { useRoderStore } from "@/stores/roder-store";
import type { ClaudeCliStatus, ProviderDescriptor, ProviderModelDescriptor, RoderModel } from "@/types/roder";

export function ProvidersSettingsPanel(): React.JSX.Element {
  const providers = useRoderStore((state) => state.providers);
  const models = useRoderStore((state) => state.models);
  const hiddenModelIds = useRoderStore((state) => state.hiddenModelIds);
  const setModelVisibility = useRoderStore((state) => state.setModelVisibility);
  const refreshProviders = useRoderStore((state) => state.refreshProviders);
  const { claudeCli, environment, recheckClaudeCli } = useProviderSetupState();
  const [query, setQuery] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
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
      await refreshProviders();
    } catch (refreshError) {
      setError(errorMessage(refreshError));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section className="rounded-xl bg-card shadow-sm ring-1 ring-border/70">
      <header className="flex items-start justify-between gap-6 border-b border-border px-5 py-4">
        <div>
          <h1 className="text-base font-medium">Providers</h1>
          <p className="mt-1 text-base text-muted-foreground">
            Sign in, paste an API key, or use what is already set up on this machine. {readyProviderIds.size} connected.
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
              models={models}
              visibleIds={visibleIds}
              visibleSet={visibleSet}
              onRecheckClaudeCli={recheckClaudeCli}
              onError={setError}
              onToggleModel={(modelId, visible) => setModelVisibility(modelId, visible)}
            />
          )}
        </div>
      )}
    </section>
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
  models,
  visibleIds,
  visibleSet,
  onRecheckClaudeCli,
  onError,
  onToggleModel,
}: {
  provider: ProviderDescriptor;
  ready: boolean;
  environmentVar: string | undefined;
  claudeCli: ClaudeCliStatus | null;
  models: RoderModel[];
  visibleIds: string[];
  visibleSet: Set<string>;
  onRecheckClaudeCli: () => Promise<void>;
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
        onRecheckClaudeCli={onRecheckClaudeCli}
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

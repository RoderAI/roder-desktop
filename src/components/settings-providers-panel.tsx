import { Check, ChevronRight, KeyRound, Plus, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { isProviderConfigured, modelKey, providerName, visibleModelIdsFor } from "@/lib/roder-models";
import { useRoderStore } from "@/stores/roder-store";
import type { ProviderDescriptor, ProviderModelDescriptor, RoderModel } from "@/types/roder";
import { cn } from "@/lib/utils";

export function ProvidersSettingsPanel(): React.JSX.Element {
  const providers = useRoderStore((state) => state.providers);
  const models = useRoderStore((state) => state.models);
  const hiddenModelIds = useRoderStore((state) => state.hiddenModelIds);
  const setModelVisibility = useRoderStore((state) => state.setModelVisibility);
  const refreshProviders = useRoderStore((state) => state.refreshProviders);
  const configureProvider = useRoderStore((state) => state.configureProvider);
  const [query, setQuery] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const filteredProviders = useMemo(() => filterProviders(providers, query), [providers, query]);
  const selectedProvider = useMemo(
    () =>
      filteredProviders.find((provider) => provider.id === selectedProviderId) ??
      providers.find((provider) => provider.id === selectedProviderId) ??
      filteredProviders[0] ??
      providers[0],
    [filteredProviders, providers, selectedProviderId],
  );
  const visibleIds = useMemo(() => visibleModelIdsFor(models, hiddenModelIds), [models, hiddenModelIds]);
  const visibleSet = useMemo(() => new Set(visibleIds), [visibleIds]);
  const configuredCount = providers.filter(isProviderConfigured).length;

  async function refresh(): Promise<void> {
    setRefreshing(true);
    setError(null);
    try {
      await refreshProviders();
    } catch (refreshError) {
      setError((refreshError as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  async function saveApiKey(providerId: string): Promise<void> {
    const apiKey = apiKeys[providerId]?.trim() ?? "";
    if (!apiKey) {
      setError("Enter an API key before saving.");
      return;
    }
    setSavingProvider(providerId);
    setError(null);
    try {
      await configureProvider(providerId, apiKey);
      setApiKeys((current) => ({ ...current, [providerId]: "" }));
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSavingProvider(null);
    }
  }

  return (
    <section className="rounded-xl bg-card shadow-sm ring-1 ring-border/70">
      <header className="flex items-start justify-between gap-6 border-b border-border px-5 py-4">
        <div>
          <h1 className="text-base font-medium">Providers</h1>
          <p className="mt-1 text-base text-muted-foreground">
            Configure API keys, OAuth providers, and model catalogs. {configuredCount} configured.
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
          placeholder="Search providers, Agent SDK providers, models..."
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </div>

      {error && <div className="border-b border-border px-5 py-3 text-base text-destructive">{error}</div>}

      {providers.length === 0 ? (
        <div className="px-5 py-8 text-base text-muted-foreground">
          No provider catalog loaded from the app-server yet.
        </div>
      ) : filteredProviders.length === 0 ? (
        <div className="px-5 py-8 text-base text-muted-foreground">No matching providers.</div>
      ) : (
        <div className="grid min-h-[560px] grid-cols-[minmax(240px,300px)_1fr] divide-x divide-border">
          <nav className="space-y-2 p-4" aria-label="Provider configuration menu">
            {filteredProviders.map((provider) => (
              <ProviderMenuItem
                key={provider.id}
                provider={provider}
                selected={provider.id === selectedProvider?.id}
                onSelect={() => setSelectedProviderId(provider.id)}
              />
            ))}
          </nav>
          {selectedProvider && (
            <ProviderDetails
              provider={selectedProvider}
              models={models}
              visibleIds={visibleIds}
              visibleSet={visibleSet}
              apiKey={apiKeys[selectedProvider.id] ?? ""}
              saving={savingProvider === selectedProvider.id}
              onApiKeyChange={(apiKey) => setApiKeys((current) => ({ ...current, [selectedProvider.id]: apiKey }))}
              onSave={() => void saveApiKey(selectedProvider.id)}
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
  selected,
  onSelect,
}: {
  provider: ProviderDescriptor;
  selected: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const configured = isProviderConfigured(provider);
  const modelCount = provider.models?.length ?? 0;

  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
        selected ? "border-primary/40 bg-primary/10" : "border-transparent hover:bg-accent/70",
      )}
      onClick={onSelect}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          configured ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        {configured ? <Check className="size-4" /> : <Plus className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-medium">{provider.name || providerName(provider.id)}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {configured ? "Configured" : "Add provider"} · {modelCount} {modelCount === 1 ? "model" : "models"}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function ProviderDetails({
  provider,
  models,
  visibleIds,
  visibleSet,
  apiKey,
  saving,
  onApiKeyChange,
  onSave,
  onToggleModel,
}: {
  provider: ProviderDescriptor;
  models: RoderModel[];
  visibleIds: string[];
  visibleSet: Set<string>;
  apiKey: string;
  saving: boolean;
  onApiKeyChange: (apiKey: string) => void;
  onSave: () => void;
  onToggleModel: (modelId: string, visible: boolean) => void;
}): React.JSX.Element {
  const configured = isProviderConfigured(provider);
  const authType = provider.authType ?? "unknown";
  const supportsApiKey = authType === "api_key";

  return (
    <section className="px-6 py-5">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold">{provider.name || providerName(provider.id)}</h2>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs",
                configured ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
              )}
            >
              {configured ? "Configured" : "Not configured"}
            </span>
            {provider.recommended && <span className="rounded-full bg-muted px-2 py-0.5 text-xs">Recommended</span>}
          </div>
          <p className="mt-1 max-w-[560px] text-base text-muted-foreground">
            {provider.description || `${providerName(provider.id)} provider`}
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-muted px-2 py-1">ID: {provider.id}</span>
            <span className="rounded-full bg-muted px-2 py-1">Auth: {authLabel(authType)}</span>
            {provider.authLabel && <span className="rounded-full bg-muted px-2 py-1">{provider.authLabel}</span>}
            {provider.authDetail && <span className="rounded-full bg-muted px-2 py-1">{provider.authDetail}</span>}
          </div>
        </div>
        {configured && <Check className="mt-1 size-4 shrink-0 text-primary" />}
      </div>

      {supportsApiKey && (
        <div className="mt-5 rounded-xl border border-border bg-background/60 p-4">
          <div className="text-base font-medium">API key</div>
          <p className="mt-1 text-base text-muted-foreground">
            {configured ? "Update the saved key for this provider." : "Paste a key to configure this provider."}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-card px-3">
              <KeyRound className="size-4 shrink-0 text-muted-foreground" />
              <input
                type="password"
                value={apiKey}
                aria-label={`${provider.name || provider.id} API key`}
                className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
                placeholder={provider.authLabel ? `Paste ${provider.authLabel}` : "Paste API key"}
                onChange={(event) => onApiKeyChange(event.currentTarget.value)}
              />
            </div>
            <Button size="sm" disabled={saving || apiKey.trim().length === 0} onClick={onSave}>
              {saving ? "Saving..." : configured ? "Update key" : "Configure"}
            </Button>
          </div>
        </div>
      )}

      {!supportsApiKey && authType !== "oauth" && (
        <div className="mt-5 rounded-xl border border-border bg-background/60 p-4 text-base text-muted-foreground">
          {configured
            ? "This provider is available without additional setup."
            : "This provider cannot be configured from the desktop UI yet."}
        </div>
      )}

      {authType === "oauth" && (
        <div className="mt-5 rounded-xl border border-border bg-background/60 p-4 text-base text-muted-foreground">
          OAuth setup is handled by the provider runtime. Refresh after signing in to update model availability.
        </div>
      )}

      <ModelAccessList
        provider={provider}
        configured={configured}
        models={models}
        visibleIds={visibleIds}
        visibleSet={visibleSet}
        onToggleModel={onToggleModel}
      />
    </section>
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
    <section className="mt-5 rounded-xl border border-border bg-background/60">
      <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-base font-medium">Model access</h3>
          <p className="mt-1 text-base text-muted-foreground">
            {configured
              ? `${enabledCount} of ${availableModels.length} available in the composer.`
              : "Configure this provider before enabling individual models."}
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
            const key = model ? modelKey(model) : providerModelKey(provider.id, providerModel.id);
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
          {providerModel.isDefault && <span className="rounded-full bg-muted px-2 py-0.5 text-xs">Default</span>}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{providerModel.id}</span>
        {providerModel.description && (
          <span className="mt-1 block line-clamp-2 text-base text-muted-foreground">{providerModel.description}</span>
        )}
        {unavailable && (
          <span className="mt-1 block text-xs text-muted-foreground">
            Configure this provider to make this model available.
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
        checked ? "bg-primary" : "bg-muted",
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

function providerModelKey(providerId: string, modelId: string): string {
  return `${providerId || "roder"}:${modelId}`;
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

function authLabel(authType: string): string {
  if (authType === "api_key") {
    return "API key";
  }
  if (authType === "oauth") {
    return "OAuth";
  }
  if (authType === "none") {
    return "None";
  }
  return authType;
}

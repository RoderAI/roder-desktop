import { Check, KeyRound, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { isProviderConfigured, providerName } from "@/lib/roder-models";
import { useRoderStore } from "@/stores/roder-store";
import type { ProviderDescriptor } from "@/types/roder";
import { cn } from "@/lib/utils";

export function ProvidersSettingsPanel(): React.JSX.Element {
  const providers = useRoderStore((state) => state.providers);
  const refreshProviders = useRoderStore((state) => state.refreshProviders);
  const configureProvider = useRoderStore((state) => state.configureProvider);
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const filteredProviders = useMemo(() => filterProviders(providers, query), [providers, query]);
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
        <div className="divide-y divide-border">
          {filteredProviders.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              apiKey={apiKeys[provider.id] ?? ""}
              saving={savingProvider === provider.id}
              onApiKeyChange={(apiKey) => setApiKeys((current) => ({ ...current, [provider.id]: apiKey }))}
              onSave={() => void saveApiKey(provider.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ProviderRow({
  provider,
  apiKey,
  saving,
  onApiKeyChange,
  onSave,
}: {
  provider: ProviderDescriptor;
  apiKey: string;
  saving: boolean;
  onApiKeyChange: (apiKey: string) => void;
  onSave: () => void;
}): React.JSX.Element {
  const configured = isProviderConfigured(provider);
  const authType = provider.authType ?? "unknown";
  const supportsApiKey = authType === "api_key";

  return (
    <section className="px-5 py-4">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-base font-medium">{provider.name || providerName(provider.id)}</h2>
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
          </div>
        </div>
        {configured && <Check className="mt-1 size-4 shrink-0 text-primary" />}
      </div>

      {supportsApiKey && (
        <div className="mt-4 flex items-center gap-2">
          <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3">
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
            {saving ? "Saving..." : "Save key"}
          </Button>
        </div>
      )}

      {authType === "oauth" && (
        <p className="mt-4 text-base text-muted-foreground">
          OAuth setup is handled by the provider runtime. Refresh after signing in to update model availability.
        </p>
      )}

      <ModelCatalog provider={provider} />
    </section>
  );
}

function ModelCatalog({ provider }: { provider: ProviderDescriptor }): React.JSX.Element | null {
  const models = provider.models ?? [];
  if (models.length === 0) {
    return <p className="mt-4 text-base text-muted-foreground">No models reported for this provider.</p>;
  }
  return (
    <div className="mt-4">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Models ({models.length})
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {models.slice(0, 8).map((model) => (
          <div key={model.id} className="min-w-0 rounded-lg bg-muted/50 px-3 py-2">
            <div className="truncate text-base font-medium">{model.name || model.id}</div>
            <div className="truncate text-xs text-muted-foreground">{model.id}</div>
          </div>
        ))}
      </div>
      {models.length > 8 && <div className="mt-2 text-xs text-muted-foreground">+{models.length - 8} more</div>}
    </div>
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

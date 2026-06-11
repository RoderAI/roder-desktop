import type { ProviderDescriptor, RoderModel } from "@/types/roder";

export function providerConfigured(provider: string, configuredProviders: Set<string> | null): boolean {
  const normalizedProvider = normalizeProviderId(provider);
  if (hiddenProviderIds.has(normalizedProvider)) {
    return false;
  }
  if (!configuredProviders) {
    return true;
  }
  return configuredProviders.has(normalizedProvider);
}

function normalizeProviderId(provider: string | undefined): string {
  return (provider || "roder").toLowerCase();
}

export function configuredModelsFor(models: RoderModel[], providers: ProviderDescriptor[]): RoderModel[] {
  const configuredProviders = configuredProviderIds(providers);
  return models.filter((model) => providerConfigured(model.modelProvider, configuredProviders));
}

export function configuredProviderIds(providers: ProviderDescriptor[]): Set<string> | null {
  if (providers.length === 0) {
    return null;
  }
  const normalizedProviders = providers.filter((provider) => !hiddenProviderIds.has(normalizeProviderId(provider.id)));
  if (normalizedProviders.length === 0) {
    return new Set<string>();
  }
  const configured = new Set(
    normalizedProviders
      .filter(isProviderConfigured)
      .map((provider) => normalizeProviderId(provider.id))
      .filter(Boolean),
  );
  return configured.size > 0 ? configured : new Set<string>();
}

export function isProviderConfigured(provider: ProviderDescriptor): boolean {
  const authType = provider.authType?.toLowerCase() ?? "";
  if (hiddenProviderIds.has(normalizeProviderId(provider.id))) {
    return false;
  }
  if (provider.authenticated) {
    return true;
  }
  return authType === "none" || authType === "local";
}

const hiddenProviderIds = new Set(["mock"]);

export function selectedModelProvider(
  models: RoderModel[],
  selectedModel: string,
  preferredProvider?: string,
): string | undefined {
  return selectedModelRecord(models, selectedModel, preferredProvider)?.modelProvider;
}

export function modelKey(model: Pick<RoderModel, "id" | "modelProvider">): string {
  return `${model.modelProvider || "roder"}:${model.id}`;
}

export const modelVisibilityKey = modelKey;

export function modelKeys(models: RoderModel[]): string[] {
  return models.map(modelKey);
}

export function visibleModelIdsFor(models: RoderModel[], explicitIds: string[]): string[] {
  const allIds = modelKeys(models);
  if (explicitIds.length === 0) {
    return allIds;
  }
  const visibleIds = explicitIds.flatMap((id) => visibleModelKeysForId(models, id));
  return visibleIds.length > 0 ? visibleIds : allIds;
}

export function compactVisibleModelIds(models: RoderModel[], visibleIds: string[]): string[] {
  const allIds = modelKeys(models);
  if (visibleIds.length === allIds.length && visibleIds.every((id, index) => id === allIds[index])) {
    return [];
  }
  return visibleIds;
}

export function visibleModelsFor(models: RoderModel[], explicitIds: string[]): RoderModel[] {
  const visibleIds = visibleModelIdsFor(models, explicitIds);
  const visible = new Set(visibleIds);
  return models.filter((model) => visible.has(modelKey(model)));
}

export function groupModelsByProvider<T extends Pick<RoderModel, "modelProvider">>(
  models: T[],
): Array<{ provider: string; models: T[] }> {
  const groups = new Map<string, T[]>();
  for (const model of models) {
    const provider = model.modelProvider || "roder";
    groups.set(provider, [...(groups.get(provider) ?? []), model]);
  }
  return [...groups.entries()].map(([provider, groupModels]) => ({ provider, models: groupModels }));
}

export function providerName(provider: string): string {
  if (!provider) {
    return "Roder";
  }
  if (provider.toLowerCase() === "openai") {
    return "OpenAI";
  }
  return provider.slice(0, 1).toUpperCase() + provider.slice(1);
}

export function effectiveSelectedModel(
  models: RoderModel[],
  visibleModelIds: string[],
  selectedModel: string,
  selectedProvider?: string,
): RoderModel | undefined {
  const visibleModels = visibleModelsFor(models, visibleModelIds);
  return selectedModelRecord(visibleModels, selectedModel, selectedProvider) ?? visibleModels[0];
}

export function selectedModelRecord(
  models: RoderModel[],
  selectedModel: string,
  selectedProvider?: string,
): RoderModel | undefined {
  return (
    models.find((model) => model.id === selectedModel && model.modelProvider === selectedProvider) ??
    models.find((model) => model.id === selectedModel)
  );
}

function visibleModelKeysForId(models: RoderModel[], id: string): string[] {
  const explicitMatch = models.find((model) => modelKey(model) === id);
  if (explicitMatch) {
    return [modelKey(explicitMatch)];
  }
  return models.flatMap((model) => (model.id === id ? [modelKey(model)] : []));
}

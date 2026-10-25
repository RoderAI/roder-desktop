import type { InferenceRoutingOptionDescriptor, ProviderDescriptor, RoderModel } from "@/types/roder";
import { displayModelName, groupModelsByProvider, isProviderConfigured, providerName } from "@/lib/roder-models";

export type ModelPickerItem =
  | { type: "auto"; option: InferenceRoutingOptionDescriptor }
  | { type: "model"; model: RoderModel }
  | { type: "setup"; model: RoderModel; providerId: string; providerLabel: string };
export type ModelPickerGroup = { id: string; label: string; items: ModelPickerItem[] };

function providerId(id: string): string {
  const normalized = id.toLowerCase();
  return normalized === "opencode-zen" ? "opencode" : normalized;
}

export function modelProviderReady(model: Pick<RoderModel, "modelProvider">, providers: ProviderDescriptor[]): boolean {
  const provider = providers.find((candidate) => providerId(candidate.id) === providerId(model.modelProvider));
  return !!provider && isProviderConfigured(provider);
}

export function buildModelPickerGroups(
  models: RoderModel[],
  providers: ProviderDescriptor[],
  routingOptions: InferenceRoutingOptionDescriptor[],
): ModelPickerGroup[] {
  const catalog = new Map(providers.map((provider) => [providerId(provider.id), provider]));
  const key = (model: RoderModel) => `${providerId(model.modelProvider)}:${model.id}`;
  const knownModels = new Map(models.map((model) => [key(model), model]));
  for (const provider of providers) {
    if (isProviderConfigured(provider) || providerId(provider.id) === "mock") continue;
    for (const model of provider.models ?? []) {
      const record: RoderModel = { ...model, modelProvider: provider.id, description: model.description ?? undefined };
      record.displayName = displayModelName(record);
      if (!knownModels.has(key(record))) knownModels.set(key(record), record);
    }
  }
  const selectable: RoderModel[] = [];
  const setup: ModelPickerItem[] = [];
  for (const model of knownModels.values()) {
    const provider = catalog.get(providerId(model.modelProvider));
    if (!provider || providerId(provider.id) === "mock") continue;
    if (isProviderConfigured(provider)) selectable.push(model);
    else
      setup.push({
        type: "setup",
        model,
        providerId: provider.id,
        providerLabel: provider.name || providerName(provider.id),
      });
  }
  const auto = routingOptions.flatMap((option): ModelPickerItem[] =>
    option.available !== false && modelProviderReady({ modelProvider: option.baseline.provider }, providers)
      ? [{ type: "auto", option }]
      : [],
  );
  return [
    ...(auto.length ? [{ id: "auto-routing", label: "Auto routing", items: auto }] : []),
    ...groupModelsByProvider(selectable).map((group) => ({
      id: `provider:${group.provider}`,
      label: catalog.get(providerId(group.provider))?.name || providerName(group.provider),
      items: group.models.map((model): ModelPickerItem => ({ type: "model", model })),
    })),
    ...(setup.length ? [{ id: "setup-providers", label: "Set up provider", items: setup }] : []),
  ];
}

export function chooseModelPickerItem(
  item: ModelPickerItem,
  handlers: {
    onChange: (model: string, provider?: string) => void;
    onAutoChange: (id: string) => void;
    onProviderSetup: (provider: string) => void;
  },
): void {
  if (item.type === "setup") handlers.onProviderSetup(item.providerId);
  else if (item.type === "auto") handlers.onAutoChange(item.option.id);
  else handlers.onChange(item.model.id, item.model.modelProvider);
}

export function validateProviderSettingsSearch(search: Record<string, unknown>): { setupProvider?: string } {
  return typeof search.setupProvider === "string" && search.setupProvider.trim() && search.setupProvider.length <= 500
    ? { setupProvider: search.setupProvider }
    : {};
}

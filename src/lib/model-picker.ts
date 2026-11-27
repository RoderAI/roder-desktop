import type { InferenceRoutingOptionDescriptor, ProviderDescriptor, RoderModel } from "@/types/roder";
import { groupModelsByProvider, isProviderConfigured, providerName } from "@/lib/roder-models";

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
  // Only list models whose provider has credentials configured.
  const selectable: RoderModel[] = [];
  for (const model of knownModels.values()) {
    const provider = catalog.get(providerId(model.modelProvider));
    if (!provider || providerId(provider.id) === "mock") continue;
    if (isProviderConfigured(provider)) selectable.push(model);
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

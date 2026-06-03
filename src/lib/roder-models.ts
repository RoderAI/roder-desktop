import type { RoderModel } from "@/types/roder";

export function selectedModelProvider(
  models: RoderModel[],
  selectedModel: string,
  preferredProvider?: string,
): string | undefined {
  return selectedModelRecord(models, selectedModel, preferredProvider)?.modelProvider;
}

export function visibleModelIdsFor(models: RoderModel[], explicitIds: string[]): string[] {
  const allIds = models.map((model) => model.id);
  if (explicitIds.length === 0) {
    return allIds;
  }
  const available = new Set(allIds);
  const visibleIds = explicitIds.filter((id) => available.has(id));
  return visibleIds.length > 0 ? visibleIds : allIds;
}

export function compactVisibleModelIds(models: RoderModel[], visibleIds: string[]): string[] {
  const allIds = models.map((model) => model.id);
  if (visibleIds.length === allIds.length && visibleIds.every((id, index) => id === allIds[index])) {
    return [];
  }
  return visibleIds;
}

export function visibleModelsFor(models: RoderModel[], explicitIds: string[]): RoderModel[] {
  const visibleIds = visibleModelIdsFor(models, explicitIds);
  const visible = new Set(visibleIds);
  return models.filter((model) => visible.has(model.id));
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

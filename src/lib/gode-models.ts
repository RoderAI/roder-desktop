import type { GodeModel } from "@/types/gode";

export function selectedModelProvider(models: GodeModel[], selectedModel: string): string | undefined {
  return models.find((model) => model.id === selectedModel)?.modelProvider;
}

export function visibleModelIdsFor(models: GodeModel[], explicitIds: string[]): string[] {
  const allIds = models.map((model) => model.id);
  if (explicitIds.length === 0) {
    return allIds;
  }
  const available = new Set(allIds);
  const visibleIds = explicitIds.filter((id) => available.has(id));
  return visibleIds.length > 0 ? visibleIds : allIds;
}

export function compactVisibleModelIds(models: GodeModel[], visibleIds: string[]): string[] {
  const allIds = models.map((model) => model.id);
  if (visibleIds.length === allIds.length && visibleIds.every((id, index) => id === allIds[index])) {
    return [];
  }
  return visibleIds;
}

export function visibleModelsFor(models: GodeModel[], explicitIds: string[]): GodeModel[] {
  const visibleIds = visibleModelIdsFor(models, explicitIds);
  const visible = new Set(visibleIds);
  return models.filter((model) => visible.has(model.id));
}

export function effectiveSelectedModel(models: GodeModel[], visibleModelIds: string[], selectedModel: string): GodeModel | undefined {
  const visibleModels = visibleModelsFor(models, visibleModelIds);
  return visibleModels.find((model) => model.id === selectedModel) ?? visibleModels[0];
}

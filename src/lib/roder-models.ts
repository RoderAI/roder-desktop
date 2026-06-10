import type { RoderModel } from "@/types/roder";

export function selectedModelProvider(
  models: RoderModel[],
  selectedModel: string,
  preferredProvider?: string,
): string | undefined {
  return selectedModelRecord(models, selectedModel, preferredProvider)?.modelProvider;
}

export function modelVisibilityKey(model: RoderModel): string {
  return `${model.modelProvider}:${model.id}`;
}

export function visibleModelIdsFor(models: RoderModel[], explicitIds: string[]): string[] {
  const allIds = models.map(modelVisibilityKey);
  if (explicitIds.length === 0) {
    return allIds;
  }
  const visibleIds = explicitIds.flatMap((id) => visibleModelKeysForId(models, id));
  return visibleIds.length > 0 ? visibleIds : allIds;
}

export function compactVisibleModelIds(models: RoderModel[], visibleIds: string[]): string[] {
  const allIds = models.map(modelVisibilityKey);
  if (visibleIds.length === allIds.length && visibleIds.every((id, index) => id === allIds[index])) {
    return [];
  }
  return visibleIds;
}

export function visibleModelsFor(models: RoderModel[], explicitIds: string[]): RoderModel[] {
  const visibleIds = visibleModelIdsFor(models, explicitIds);
  const visible = new Set(visibleIds);
  return models.filter((model) => visible.has(modelVisibilityKey(model)));
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
  const explicitMatch = models.find((model) => modelVisibilityKey(model) === id);
  if (explicitMatch) {
    return [modelVisibilityKey(explicitMatch)];
  }
  return models.flatMap((model) => (model.id === id ? [modelVisibilityKey(model)] : []));
}

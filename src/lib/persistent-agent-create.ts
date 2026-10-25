import type { PersistentAgentCreate } from "@/types/persistent-agents";
import type { ProviderDescriptor, RoderModel } from "@/types/roder";
import { modelProviderReady } from "@/lib/model-picker";

export function persistentAgentCreateParams(
  draft: {
    name: string;
    mission: string;
    workspaceId: string;
    model: RoderModel | undefined;
    reasoning?: string;
  },
  providers: ProviderDescriptor[],
): PersistentAgentCreate | null {
  const name = draft.name.trim();
  const mission = draft.mission.trim();
  if (
    !name ||
    name.length > 120 ||
    !mission ||
    mission.length > 16000 ||
    !draft.workspaceId ||
    !draft.model ||
    !modelProviderReady(draft.model, providers)
  )
    return null;
  return {
    name,
    mission,
    workspaceId: draft.workspaceId,
    model: draft.model.id,
    modelProvider: draft.model.modelProvider,
    ...(draft.reasoning ? { reasoning: draft.reasoning } : {}),
  };
}

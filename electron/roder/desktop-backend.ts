import type { ExternalAgentBackendId } from "../../src/types/roder";
export type { AgentBackendId, ExternalAgentBackendId } from "../../src/types/roder";

export const antigravitySetupSession = "setup:antigravity";
export const codexSetupSession = "setup:codex";

export type ExternalBackendModelRecord = {
  id: string;
  name?: string;
  description?: string;
  modelProvider: string;
  defaultReasoningEffort?: string;
  reasoningEfforts?: string[];
  isDefault?: boolean;
};

export type AntigravityModelRecord = ExternalBackendModelRecord;

type BackendClient = {
  start: () => Promise<unknown>;
  request: (method: string, params: object) => Promise<unknown>;
  stop: () => Promise<void>;
};

export async function prepareExternalBackendCatalog<T extends BackendClient>(
  candidate: T,
  backend: ExternalAgentBackendId,
): Promise<{ client: T; models: ExternalBackendModelRecord[] }> {
  try {
    await candidate.start();
    const result = (await candidate.request("model/list", {})) as {
      models?: ExternalBackendModelRecord[];
    };
    const models = (result?.models ?? []).filter((model) => Boolean(model?.id) && model.modelProvider === backend);
    if (models.length === 0) {
      const label = backend === "codex" ? "Codex" : backend === "claude-code" ? "Claude Code" : "Antigravity";
      throw new Error(`No ${label} models are available for this account.`);
    }
    return { client: candidate, models };
  } catch (error) {
    await candidate.stop();
    throw error;
  }
}

export async function prepareAntigravityCatalog<T extends BackendClient>(
  candidate: T,
): Promise<{ client: T; models: AntigravityModelRecord[] }> {
  return prepareExternalBackendCatalog(candidate, "antigravity");
}

export async function prepareAntigravityBackend<T extends BackendClient>(candidate: T): Promise<T> {
  const { client } = await prepareExternalBackendCatalog(candidate, "antigravity");
  return client;
}

export async function prepareCodexBackend<T extends BackendClient>(candidate: T): Promise<T> {
  const { client } = await prepareExternalBackendCatalog(candidate, "codex");
  return client;
}

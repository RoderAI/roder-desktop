export const antigravitySetupSession = "setup:antigravity";

type BackendClient = {
  start: () => Promise<unknown>;
  request: (method: string, params: object) => Promise<unknown>;
  stop: () => Promise<void>;
};

export async function prepareAntigravityBackend<T extends BackendClient>(candidate: T): Promise<T> {
  try {
    await candidate.start();
    const result = (await candidate.request("model/list", {})) as {
      models?: Array<{ id?: string; modelProvider?: string }>;
    };
    if (!result?.models?.some((model) => model.id && model.modelProvider === "antigravity")) {
      throw new Error("No Antigravity models are available for this account.");
    }
    return candidate;
  } catch (error) {
    await candidate.stop();
    throw error;
  }
}

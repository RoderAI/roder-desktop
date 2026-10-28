export type CloudMachine = {
  id: string;
  name: string;
  providerId: string;
  workspace: string;
  readRoots?: string[];
};

export type CloudMachineInput = Omit<CloudMachine, "id"> & {
  id?: string;
  config: Record<string, unknown>;
};

export type CloudRunnerProvider = {
  provider_id: string;
  capabilities: Record<string, unknown>;
  setup_hint?: string | null;
};

export type ThreadRunner = {
  providerId: string;
  workspace: string;
  config: Record<string, unknown>;
  readRoots?: string[];
};

const credentialKey = /token|secret|password|authorization|credential|api[_-]?key|private[_-]?key/i;

/** Runner config is persisted upstream; authentication belongs in the runner environment. */
export function validateMachineConfig(config: unknown): Record<string, unknown> {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Provider configuration must be a JSON object.");
  }
  function visit(value: unknown): void {
    if (typeof value === "string") {
      if (/-----BEGIN .*PRIVATE KEY-----/u.test(value)) {
        throw new Error("Keep credentials out of provider configuration. Use environment variables.");
      }
      if (/^https?:\/\//iu.test(value)) {
        const url = new URL(value);
        if (url.username || url.password || [...url.searchParams.keys()].some((key) => credentialKey.test(key))) {
          throw new Error("Provider URLs must not contain credentials.");
        }
      }
      return;
    }
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
      for (const [key, entry] of Object.entries(value)) {
        if (credentialKey.test(key)) {
          throw new Error("Keep credentials out of provider configuration. Use environment variables.");
        }
        visit(entry);
      }
      return;
    }
    throw new Error("Provider configuration must contain only JSON values.");
  }
  visit(config);
  return config as Record<string, unknown>;
}

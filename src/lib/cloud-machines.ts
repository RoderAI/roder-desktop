export const WINDOWS_CLOUD_MACHINES_NOTICE =
  "Cloud machines are not supported on Windows yet. Choose Local machine to use native Windows tools.";

export const REMOTE_WORKSPACE_ROOT_ID = "remote-root";

export type CloudMachine = {
  id: string;
  name: string;
  providerId: string;
  workspace: string;
  readRoots?: string[];
};

export type CloudMachineProfileDetail = CloudMachine & {
  config: Record<string, unknown>;
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
  config?: Record<string, unknown>;
  readRoots?: string[];
};

export type CloudProviderCredentialStatus = {
  providerId: string;
  configured: boolean;
  source: "saved" | "blaxel-cli" | "env" | "none";
  workspace?: string | null;
  preview?: string | null;
  envVars: string[];
};

export type BlaxelCliStatus = {
  installed: boolean;
  authenticated: boolean;
  workspace: string | null;
  workspaces: string[];
  binaryPath: string | null;
};

export type BlaxelWorkspaceInfo = {
  id: string;
  name: string;
  region?: string | null;
};

export type BlaxelSandboxSummary = {
  name: string;
  displayName: string;
  workspace: string;
  url: string | null;
  status: string;
  region: string | null;
  image: string | null;
  memory: number | null;
  updatedAt: string | null;
};

export type CloudMachineTestResult = {
  ok: boolean;
  status: string;
  sandboxUrl?: string;
  directoryExists?: boolean;
  message: string;
};

export type RemoteRunnerStatusSnapshot = {
  workspaceId: string;
  providerId: string;
  targetName: string;
  workspace: string;
  blaxelWorkspace?: string | null;
  status: string;
  region?: string | null;
  url?: string | null;
  reachable: boolean;
  bridgeMode?: "remote-roder-tunnel" | "blaxel-api" | "pending";
  bridgeDetail?: string;
  message?: string;
};

export type ActiveRemoteWorkspace = {
  workspaceId: string;
  providerId: string;
  label: string;
  workspacePath: string;
  targetName: string;
  threadId?: string;
  machineId?: string;
};

export function isRemoteRunner(runner: ThreadRunner | null | undefined): runner is ThreadRunner {
  return Boolean(runner && runner.providerId && runner.providerId !== "unix-local");
}

export function isRemoteWorkspaceId(workspaceId: string | null | undefined): boolean {
  return typeof workspaceId === "string" && workspaceId.startsWith("remote:");
}

export function remoteWorkspaceIdForThread(threadId: string): string {
  return `remote:thread:${threadId}`;
}

export function remoteWorkspaceIdForMachine(machineId: string): string {
  return `remote:machine:${machineId}`;
}

export function remoteRunnerTargetName(runner: Pick<ThreadRunner, "providerId" | "workspace" | "config">): string {
  const config = runner.config ?? {};
  if (runner.providerId === "blaxel") {
    const sandbox = config.sandbox_name ?? config.sandboxName ?? config.name;
    if (typeof sandbox === "string" && sandbox.trim()) {
      return sandbox.trim();
    }
  }
  if (runner.providerId === "sprites") {
    const sprite = config.sprite_name;
    if (typeof sprite === "string" && sprite.trim()) {
      return sprite.trim();
    }
  }
  const folder = runner.workspace.split("/").filter(Boolean).pop();
  return folder || runner.providerId;
}

export function remoteRunnerLabel(
  runner: Pick<ThreadRunner, "providerId" | "workspace" | "config">,
  machines: readonly CloudMachine[] = [],
): string {
  const target = remoteRunnerTargetName(runner);
  const matching = machines.find(
    (machine) =>
      machine.providerId === runner.providerId &&
      machine.workspace === runner.workspace &&
      machine.name.toLowerCase() === target.toLowerCase(),
  );
  return matching?.name ?? target;
}

export function remoteWorkspaceGroupKey(runner: Pick<ThreadRunner, "providerId" | "workspace" | "config">): string {
  return `remote:${runner.providerId}:${remoteRunnerTargetName(runner)}:${runner.workspace}`;
}

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

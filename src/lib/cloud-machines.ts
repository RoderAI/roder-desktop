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

export type TailscalePeerSummary = {
  id: string;
  hostName: string;
  dnsName: string;
  tailscaleIp: string;
  os: string;
  online: boolean;
  active: boolean;
  lastSeen: string | null;
  tags: string[];
};

export type LocalTailscaleStatus = {
  installed: boolean;
  running: boolean;
  backendState: string;
  version: string | null;
  binaryPath: string | null;
  self: {
    hostName: string;
    dnsName: string;
    tailscaleIp: string;
    os: string;
    sshCapable: boolean;
    httpsEnabled: boolean;
  } | null;
  tailnetName: string | null;
  magicDnsSuffix: string | null;
  peers: TailscalePeerSummary[];
  error?: string;
};

export type SshConfigHostEntry = {
  alias: string;
  hostName: string;
  user: string | null;
  port: number;
  identityFile: string | null;
  proxyJump: string | null;
};

export type LocalSshEnvironment = {
  installed: boolean;
  binaryPath: string | null;
  configPath: string;
  hosts: SshConfigHostEntry[];
  identityFiles: string[];
};

export type TailscaleCredentialStatus = {
  configured: boolean;
  mode: "oauth" | "auth-key" | "none";
  source: "saved" | "env" | "none";
  preview: string | null;
  oauthClientId: string | null;
  tags: string[];
  tailnet: string | null;
  preferForSandboxes: boolean;
};

export type CloudMachineTestResult = {
  ok: boolean;
  status: string;
  sandboxUrl?: string;
  tailscaleIp?: string | null;
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
  bridgeMode?:
    | "tailscale-tunnel"
    | "ssh-tunnel"
    | "remote-roder-tunnel"
    | "tailscale-ssh"
    | "ssh-direct"
    | "blaxel-api"
    | "pending";
  bridgeDetail?: string;
  tailscaleActive?: boolean;
  tailscaleIp?: string | null;
  tailscaleDnsName?: string | null;
  tailscaleConfigured?: boolean;
  tailscaleError?: string | null;
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

export function effectiveRunnerProviderId(
  runner: Pick<ThreadRunner, "providerId" | "config"> | null | undefined,
): string {
  if (!runner) return "";
  if (runner.providerId === "ssh" || runner.config?.roder_transport === "ssh") {
    return "ssh";
  }
  if (runner.providerId === "tailscale" || runner.config?.roder_transport === "tailscale") {
    return "tailscale";
  }
  return runner.providerId;
}

export function isRemoteRunner(runner: ThreadRunner | null | undefined): runner is ThreadRunner {
  const providerId = effectiveRunnerProviderId(runner);
  return Boolean(providerId && providerId !== "unix-local");
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
  const providerId = effectiveRunnerProviderId(runner);
  if (providerId === "ssh") {
    const label = config.machine_name ?? config.ssh_host ?? config.host;
    if (typeof label === "string" && label.trim()) {
      return label.trim();
    }
  }
  if (providerId === "tailscale") {
    const label = config.machine_name ?? config.tailscale_host ?? config.dns_name ?? config.tailscale_ip ?? config.host;
    if (typeof label === "string" && label.trim()) {
      return label.trim().replace(/\.+$/u, "");
    }
  }
  if (providerId === "blaxel") {
    const sandbox = config.sandbox_name ?? config.sandboxName ?? config.name;
    if (typeof sandbox === "string" && sandbox.trim()) {
      return sandbox.trim();
    }
  }
  if (providerId === "sprites") {
    const sprite = config.sprite_name;
    if (typeof sprite === "string" && sprite.trim()) {
      return sprite.trim();
    }
  }
  const folder = runner.workspace.split("/").filter(Boolean).pop();
  return folder || providerId;
}

export function remoteRunnerLabel(
  runner: Pick<ThreadRunner, "providerId" | "workspace" | "config">,
  machines: readonly CloudMachine[] = [],
): string {
  const providerId = effectiveRunnerProviderId(runner);
  const target = remoteRunnerTargetName(runner);
  const matching = machines.find(
    (machine) =>
      machine.providerId === providerId &&
      machine.workspace === runner.workspace &&
      machine.name.toLowerCase() === target.toLowerCase(),
  );
  return matching?.name ?? target;
}

export function remoteWorkspaceGroupKey(runner: Pick<ThreadRunner, "providerId" | "workspace" | "config">): string {
  return `remote:${effectiveRunnerProviderId(runner)}:${remoteRunnerTargetName(runner)}:${runner.workspace}`;
}

export function parseQuickSshInput(raw: string): {
  host: string;
  user?: string;
  port?: number;
  identityFile?: string;
  proxyJump?: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) return { host: "" };
  const tokens = trimmed.split(/\s+/u).filter(Boolean);
  let start = 0;
  if (tokens[0] === "ssh") start = 1;

  let port: number | undefined;
  let identityFile: string | undefined;
  let proxyJump: string | undefined;
  let destination = "";

  for (let i = start; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "-p" && i + 1 < tokens.length) {
      const parsed = Number.parseInt(tokens[++i], 10);
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) port = parsed;
      continue;
    }
    if (token === "-i" && i + 1 < tokens.length) {
      identityFile = tokens[++i];
      continue;
    }
    if (token === "-J" && i + 1 < tokens.length) {
      proxyJump = tokens[++i];
      continue;
    }
    if (token.startsWith("-")) continue;
    destination = token;
    break;
  }

  let user: string | undefined;
  let hostPart = destination;
  const atIndex = hostPart.indexOf("@");
  if (atIndex > 0) {
    user = hostPart.slice(0, atIndex);
    hostPart = hostPart.slice(atIndex + 1);
  }
  const colonIndex = hostPart.lastIndexOf(":");
  if (colonIndex > 0 && !hostPart.includes("]")) {
    const maybePort = Number.parseInt(hostPart.slice(colonIndex + 1), 10);
    if (Number.isInteger(maybePort) && maybePort >= 1 && maybePort <= 65535) {
      port = port ?? maybePort;
      hostPart = hostPart.slice(0, colonIndex);
    }
  }

  return {
    host: hostPart.trim(),
    ...(user ? { user: user.trim() } : {}),
    ...(port ? { port } : {}),
    ...(identityFile ? { identityFile } : {}),
    ...(proxyJump ? { proxyJump } : {}),
  };
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

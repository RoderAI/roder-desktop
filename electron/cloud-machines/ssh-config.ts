import { accessSync, constants } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

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

const safeSshHostPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,252}$/u;
const safeSshUserPattern = /^[a-zA-Z0-9._-]{1,64}$/u;
const safeProxyJumpPattern = /^[a-zA-Z0-9][a-zA-Z0-9._@:,-]{0,252}$/u;

export type SshMachineTargetConfig = {
  host: string;
  displayHost?: string;
  tailscaleIp?: string;
  dnsName?: string;
  sshUser?: string;
  sshPort: number;
  identityFile?: string;
  proxyJump?: string;
  remoteRoderPort: number;
};

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveSshBinary(
  options: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    exists?: (path: string) => boolean;
  } = {},
): string | null {
  const platform = options.platform ?? process.platform;
  const check = options.exists ?? isExecutable;
  const envPath = options.env?.PATH ?? process.env.PATH ?? "";
  const separator = platform === "win32" ? ";" : ":";
  const binNames = platform === "win32" ? ["ssh.exe", "ssh"] : ["ssh"];

  for (const dir of envPath.split(separator).filter(Boolean)) {
    for (const bin of binNames) {
      const candidate = `${dir.replace(/[\\/]+$/u, "")}/${bin}`;
      if (check(candidate)) return candidate;
    }
  }

  const fallbacks =
    platform === "win32"
      ? ["C:/Windows/System32/OpenSSH/ssh.exe"]
      : ["/usr/bin/ssh", "/usr/local/bin/ssh", "/opt/homebrew/bin/ssh", "/bin/ssh"];
  for (const candidate of fallbacks) {
    if (check(candidate)) return candidate;
  }
  return null;
}

export function expandTildePath(rawPath: string, home = homedir()): string {
  const trimmed = rawPath.trim();
  if (trimmed === "~") return home;
  if (trimmed.startsWith("~/")) return join(home, trimmed.slice(2));
  return trimmed;
}

export function sanitizeIdentityFilePath(rawPath: string, home = homedir()): string {
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed.includes("\0") || /[\r\n]/u.test(trimmed)) {
    throw new Error("SSH identity file path must be a valid file path.");
  }
  if (trimmed.startsWith("-")) {
    throw new Error("SSH identity file path must not start with '-'.");
  }
  const expanded = expandTildePath(trimmed, home);
  if (!isAbsolute(expanded)) {
    throw new Error("SSH identity file path must be absolute (e.g. ~/.ssh/id_ed25519).");
  }
  return resolve(expanded);
}

/**
 * Parses a quick SSH target string such as:
 * - "ubuntu@10.0.0.5"
 * - "root@hetzner.example.com:2222"
 * - "ssh -p 2222 -i ~/.ssh/prod ubuntu@1.2.3.4"
 * - "my-alias"
 */
export function parseQuickSshTarget(raw: string): {
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

/**
 * Parses OpenSSH client config (`~/.ssh/config`) without touching or reading private keys.
 * Skips wildcard host patterns (`*`, `?`, `!`) and merges standard host directives.
 */
export function parseSshConfigText(content: string): SshConfigHostEntry[] {
  type Block = {
    patterns: string[];
    hostName?: string;
    user?: string;
    port?: number;
    identityFile?: string;
    proxyJump?: string;
  };
  const blocks: Block[] = [];
  let current: Block | null = null;

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.replace(/#.*$/u, "").trim();
    if (!line) continue;
    const match = /^([A-Za-z][A-Za-z0-9_-]*)(?:\s*=\s*|\s+)(.+)$/u.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const rawValue = match[2].trim().replace(/^"(.*)"$/u, "$1");

    if (key === "host") {
      const patterns = rawValue.split(/\s+/u).filter(Boolean);
      current = { patterns };
      blocks.push(current);
      continue;
    }
    if (key === "match") {
      current = null;
      continue;
    }
    if (!current) continue;

    if (key === "hostname" && !current.hostName) {
      current.hostName = rawValue;
    } else if (key === "user" && !current.user) {
      current.user = rawValue;
    } else if (key === "port" && !current.port) {
      const parsedPort = Number.parseInt(rawValue, 10);
      if (Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535) {
        current.port = parsedPort;
      }
    } else if (key === "identityfile" && !current.identityFile) {
      current.identityFile = rawValue;
    } else if (key === "proxyjump" && !current.proxyJump) {
      current.proxyJump = rawValue;
    }
  }

  const results: SshConfigHostEntry[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    for (const pattern of block.patterns) {
      if (!pattern || /[*?!]/u.test(pattern) || pattern.startsWith("-")) continue;
      if (seen.has(pattern)) continue;
      seen.add(pattern);
      results.push({
        alias: pattern,
        hostName: block.hostName || pattern,
        user: block.user ?? null,
        port: block.port ?? 22,
        identityFile: block.identityFile ?? null,
        proxyJump: block.proxyJump ?? null,
      });
    }
  }
  return results;
}

const IGNORED_SSH_DIR_FILES = new Set([
  "authorized_keys",
  "authorized_keys2",
  "config",
  "environment",
  "known_hosts",
  "known_hosts.old",
  "rc",
]);

export async function detectLocalSshEnvironment(
  options: {
    homeDir?: string;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    exists?: (path: string) => boolean;
  } = {},
): Promise<LocalSshEnvironment> {
  const home = options.homeDir ?? homedir();
  const sshDir = join(home, ".ssh");
  const configPath = join(sshDir, "config");
  const binaryPath = resolveSshBinary({
    env: options.env,
    platform: options.platform,
    exists: options.exists,
  });

  let hosts: SshConfigHostEntry[] = [];
  try {
    const configText = await readFile(configPath, "utf8");
    hosts = parseSshConfigText(configText);
  } catch {
    hosts = [];
  }

  const identityFiles: string[] = [];
  try {
    const entries = await readdir(sshDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      if (IGNORED_SSH_DIR_FILES.has(name) || name.endsWith(".pub") || name.startsWith(".")) continue;
      identityFiles.push(`~/.ssh/${name}`);
    }
    identityFiles.sort((left, right) => left.localeCompare(right));
  } catch {
    // ~/.ssh may not exist yet
  }

  return {
    installed: Boolean(binaryPath),
    binaryPath,
    configPath,
    hosts,
    identityFiles,
  };
}

export function parseSshMachineConfig(
  config: Record<string, unknown> | undefined,
  home = homedir(),
): SshMachineTargetConfig {
  const record = config ?? {};
  const rawHost =
    typeof record.ssh_host === "string"
      ? record.ssh_host.trim()
      : typeof record.host === "string"
        ? record.host.trim()
        : typeof record.tailscale_ip === "string"
          ? record.tailscale_ip.trim()
          : typeof record.tailscale_host === "string"
            ? record.tailscale_host.trim().replace(/\.+$/u, "")
            : "";

  if (!rawHost || rawHost.startsWith("-") || !safeSshHostPattern.test(rawHost)) {
    throw new Error(
      'This SSH machine profile needs a valid "ssh_host" (hostname, IP address, or ~/.ssh/config alias).',
    );
  }

  const rawUser =
    typeof record.ssh_user === "string"
      ? record.ssh_user.trim()
      : typeof record.user === "string"
        ? record.user.trim()
        : "";
  if (rawUser && (rawUser.startsWith("-") || !safeSshUserPattern.test(rawUser))) {
    throw new Error(`Invalid SSH username "${rawUser}".`);
  }

  const rawPort = record.ssh_port ?? record.port;
  let sshPort = 22;
  if (rawPort !== undefined && rawPort !== "") {
    const parsedPort = typeof rawPort === "number" ? rawPort : Number.parseInt(String(rawPort), 10);
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      throw new Error("SSH port must be an integer between 1 and 65535.");
    }
    sshPort = parsedPort;
  }

  const rawIdentity = typeof record.identity_file === "string" ? record.identity_file.trim() : "";
  const identityFile = rawIdentity ? sanitizeIdentityFilePath(rawIdentity, home) : undefined;

  const rawProxyJump = typeof record.proxy_jump === "string" ? record.proxy_jump.trim() : "";
  if (rawProxyJump && (rawProxyJump.startsWith("-") || !safeProxyJumpPattern.test(rawProxyJump))) {
    throw new Error(`Invalid SSH ProxyJump "${rawProxyJump}".`);
  }

  const rawRoderPort = record.remote_roder_port;
  let remoteRoderPort = 17373;
  if (rawRoderPort !== undefined && rawRoderPort !== "") {
    const parsedRoderPort = typeof rawRoderPort === "number" ? rawRoderPort : Number.parseInt(String(rawRoderPort), 10);
    if (!Number.isInteger(parsedRoderPort) || parsedRoderPort < 1 || parsedRoderPort > 65535) {
      throw new Error("Remote Roder port must be an integer between 1 and 65535.");
    }
    remoteRoderPort = parsedRoderPort;
  }

  const rawTailscaleIp = typeof record.tailscale_ip === "string" ? record.tailscale_ip.trim() : "";
  const rawDns = typeof record.tailscale_host === "string" ? record.tailscale_host.trim().replace(/\.+$/u, "") : "";

  return {
    host: rawHost,
    displayHost: rawHost,
    ...(rawTailscaleIp ? { tailscaleIp: rawTailscaleIp } : {}),
    ...(rawDns ? { dnsName: rawDns } : {}),
    ...(rawUser ? { sshUser: rawUser } : {}),
    sshPort,
    ...(identityFile ? { identityFile } : {}),
    ...(rawProxyJump ? { proxyJump: rawProxyJump } : {}),
    remoteRoderPort,
  };
}

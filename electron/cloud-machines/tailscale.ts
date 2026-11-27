import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const TAILSCALE_BINARY_DIR = "/root/.roder/bin";
export const TAILSCALE_BIN_PATH = `${TAILSCALE_BINARY_DIR}/tailscale`;
export const TAILSCALED_BIN_PATH = `${TAILSCALE_BINARY_DIR}/tailscaled`;
export const TAILSCALE_STATE_DIR = "/root/.roder/tailscale";
export const TAILSCALE_SOCKET_PATH = "/root/.roder/run/tailscaled.sock";
export const TAILSCALE_DAEMON_PROCESS_NAME = "roder-tailscaled";
export const TAILSCALE_DEFAULT_TAG = "tag:roder";
export const TAILSCALE_FALLBACK_VERSION = "1.82.5";

const TAILSCALE_API_BASE = "https://api.tailscale.com/api/v2";

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

export type TailscalePeerConfig = {
  host: string;
  tailscaleIp?: string;
  dnsName?: string;
  sshUser?: string;
  sshPort: number;
  remoteRoderPort: number;
};

export type TailscaleExecFileFn = (
  file: string,
  args: string[],
  options: { timeout?: number; maxBuffer?: number; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }>;

function defaultExecFile(
  file: string,
  args: string[],
  options: { timeout?: number; maxBuffer?: number; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(file, args, {
    encoding: "utf8",
    timeout: options.timeout ?? 5_000,
    maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
    env: options.env,
  });
}

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveTailscaleBinary(
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
  const binNames = platform === "win32" ? ["tailscale.exe", "tailscale"] : ["tailscale"];

  for (const dir of envPath.split(separator).filter(Boolean)) {
    for (const bin of binNames) {
      const candidate = `${dir.replace(/[\\/]+$/u, "")}/${bin}`;
      if (check(candidate)) return candidate;
    }
  }

  const fallbacks =
    platform === "darwin"
      ? [
          "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
          "/opt/homebrew/bin/tailscale",
          "/usr/local/bin/tailscale",
        ]
      : platform === "win32"
        ? ["C:/Program Files/Tailscale/tailscale.exe"]
        : ["/usr/bin/tailscale", "/usr/local/bin/tailscale", "/bin/tailscale"];

  for (const candidate of fallbacks) {
    if (check(candidate)) return candidate;
  }
  return null;
}

function stripTrailingDot(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\.+$/u, "") : "";
}

function firstIpv4(ips: unknown): string {
  if (!Array.isArray(ips)) return "";
  const ipv4 = ips.find((entry) => typeof entry === "string" && /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(entry));
  if (typeof ipv4 === "string") return ipv4;
  const first = ips.find((entry) => typeof entry === "string" && entry.trim());
  return typeof first === "string" ? first.trim() : "";
}

export function parseTailscaleStatusJson(rawJson: string, binaryPath: string | null = null): LocalTailscaleStatus {
  const parsed = JSON.parse(rawJson) as Record<string, unknown>;
  const backendState = typeof parsed.BackendState === "string" ? parsed.BackendState : "Unknown";
  const running = backendState === "Running";
  const version = typeof parsed.Version === "string" && parsed.Version.trim() ? parsed.Version.trim() : null;

  const currentTailnet =
    parsed.CurrentTailnet && typeof parsed.CurrentTailnet === "object"
      ? (parsed.CurrentTailnet as Record<string, unknown>)
      : null;
  const magicDnsSuffix =
    (typeof parsed.MagicDNSSuffix === "string" && parsed.MagicDNSSuffix.trim()) ||
    (typeof currentTailnet?.MagicDNSSuffix === "string" && currentTailnet.MagicDNSSuffix.trim()) ||
    null;
  const tailnetName =
    (typeof currentTailnet?.Name === "string" && currentTailnet.Name.trim()) || magicDnsSuffix || null;

  const certDomains = Array.isArray(parsed.CertDomains)
    ? parsed.CertDomains.filter((d): d is string => typeof d === "string" && d.trim().length > 0)
    : [];

  let self: LocalTailscaleStatus["self"] = null;
  if (parsed.Self && typeof parsed.Self === "object") {
    const selfObj = parsed.Self as Record<string, unknown>;
    const capabilities = Array.isArray(selfObj.Capabilities)
      ? selfObj.Capabilities.filter((c): c is string => typeof c === "string")
      : [];
    const hostName = typeof selfObj.HostName === "string" ? selfObj.HostName.trim() : "";
    const dnsName = stripTrailingDot(selfObj.DNSName);
    const tailscaleIp = firstIpv4(selfObj.TailscaleIPs) || firstIpv4(parsed.TailscaleIPs);
    if (hostName || dnsName || tailscaleIp) {
      self = {
        hostName: hostName || dnsName.split(".")[0] || "this-device",
        dnsName,
        tailscaleIp,
        os: typeof selfObj.OS === "string" ? selfObj.OS : process.platform,
        sshCapable: capabilities.includes("https://tailscale.com/cap/ssh"),
        httpsEnabled: certDomains.length > 0 || capabilities.includes("https"),
      };
    }
  }

  const peers: TailscalePeerSummary[] = [];
  if (parsed.Peer && typeof parsed.Peer === "object") {
    for (const value of Object.values(parsed.Peer as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const peer = value as Record<string, unknown>;
      const tailscaleIp = firstIpv4(peer.TailscaleIPs);
      if (!tailscaleIp) continue;
      // Skip Mullvad/exit-only placeholder nodes that have no hostname and are not tailnet machines.
      const tags = Array.isArray(peer.Tags) ? peer.Tags.filter((tag): tag is string => typeof tag === "string") : [];
      const dnsName = stripTrailingDot(peer.DNSName);
      const hostName =
        (typeof peer.HostName === "string" && peer.HostName.trim()) || dnsName.split(".")[0] || tailscaleIp;
      if (dnsName.endsWith(".mullvad.ts.net")) continue;
      const id = typeof peer.ID === "string" && peer.ID ? peer.ID : tailscaleIp;
      const lastSeen =
        typeof peer.LastSeen === "string" && !peer.LastSeen.startsWith("0001-01-01") ? peer.LastSeen : null;
      peers.push({
        id,
        hostName,
        dnsName,
        tailscaleIp,
        os: typeof peer.OS === "string" ? peer.OS : "unknown",
        online: Boolean(peer.Online),
        active: Boolean(peer.Active),
        lastSeen,
        tags,
      });
    }
  }

  peers.sort(
    (left, right) =>
      Number(right.online) - Number(left.online) ||
      Number(right.active) - Number(left.active) ||
      left.hostName.localeCompare(right.hostName),
  );

  return {
    installed: true,
    running,
    backendState,
    version,
    binaryPath,
    self,
    tailnetName,
    magicDnsSuffix,
    peers,
  };
}

export async function detectLocalTailscale(
  options: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    exists?: (path: string) => boolean;
    execFileImpl?: TailscaleExecFileFn;
  } = {},
): Promise<LocalTailscaleStatus> {
  const binaryPath = resolveTailscaleBinary({
    env: options.env,
    platform: options.platform,
    exists: options.exists,
  });
  if (!binaryPath) {
    return {
      installed: false,
      running: false,
      backendState: "NotInstalled",
      version: null,
      binaryPath: null,
      self: null,
      tailnetName: null,
      magicDnsSuffix: null,
      peers: [],
    };
  }

  const execImpl = options.execFileImpl ?? defaultExecFile;
  try {
    const { stdout } = await execImpl(binaryPath, ["status", "--json"], {
      timeout: 5_000,
      env: options.env,
    });
    return parseTailscaleStatusJson(stdout, binaryPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      installed: true,
      running: false,
      backendState: "Stopped",
      version: null,
      binaryPath,
      self: null,
      tailnetName: null,
      magicDnsSuffix: null,
      peers: [],
      error: message.slice(0, 240),
    };
  }
}

export function sanitizeTailscaleHostname(raw: string, prefix = "roder"): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+/u, "")
    .replace(/-+$/u, "");
  const cleanPrefix = prefix
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  const combined = cleanPrefix
    ? cleaned.startsWith(`${cleanPrefix}-`)
      ? cleaned
      : `${cleanPrefix}-${cleaned || "sandbox"}`
    : cleaned || "roder-sandbox";
  return combined.slice(0, 63).replace(/-+$/u, "") || "roder-sandbox";
}

export function normalizeTailscaleTags(raw: readonly string[] | string | undefined): string[] {
  const items = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,]+/u) : [];
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const withPrefix = trimmed.startsWith("tag:") ? trimmed : `tag:${trimmed}`;
    if (!/^tag:[a-zA-Z][a-zA-Z0-9._-]{0,62}$/u.test(withPrefix)) {
      throw new Error(`Invalid Tailscale tag "${trimmed}". Tags must look like "tag:roder".`);
    }
    if (!seen.has(withPrefix)) {
      seen.add(withPrefix);
      normalized.push(withPrefix);
    }
  }
  return normalized;
}

export function validateTailscaleAuthKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes("\0") || /\s/u.test(trimmed)) {
    throw new Error("Enter a valid Tailscale auth key (e.g. tskey-auth-...).");
  }
  if (!trimmed.startsWith("tskey-auth-")) {
    throw new Error('Tailscale auth keys must start with "tskey-auth-".');
  }
  return trimmed;
}

export async function requestTailscaleOAuthToken(input: {
  oauthClientId: string;
  oauthClientSecret: string;
  fetchImpl?: typeof fetch;
  apiBase?: string;
}): Promise<{ accessToken: string; expiresIn: number }> {
  const clientId = input.oauthClientId.trim();
  const clientSecret = input.oauthClientSecret.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Both Tailscale OAuth client ID and client secret are required.");
  }
  const fetchFn = input.fetchImpl ?? globalThis.fetch;
  const base = (input.apiBase ?? TAILSCALE_API_BASE).replace(/\/+$/u, "");
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
  });
  const response = await fetchFn(`${base}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  if (!response.ok) {
    const detail = await readTailscaleErrorMessage(response);
    throw new Error(`Tailscale OAuth authentication failed (${response.status})${detail ? `: ${detail}` : "."}`);
  }
  const json = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof json.access_token !== "string" || !json.access_token.trim()) {
    throw new Error("Tailscale OAuth did not return an access token.");
  }
  return {
    accessToken: json.access_token,
    expiresIn: typeof json.expires_in === "number" ? json.expires_in : 3600,
  };
}

export async function mintTailscaleEphemeralAuthKey(input: {
  oauthClientId: string;
  oauthClientSecret: string;
  tags?: readonly string[];
  tailnet?: string;
  description?: string;
  expirySeconds?: number;
  fetchImpl?: typeof fetch;
  apiBase?: string;
}): Promise<{ key: string; id?: string; expires?: string }> {
  const tags = normalizeTailscaleTags(input.tags && input.tags.length > 0 ? input.tags : [TAILSCALE_DEFAULT_TAG]);
  if (tags.length === 0) {
    throw new Error(`Tailscale OAuth key minting requires at least one tag (e.g. "${TAILSCALE_DEFAULT_TAG}").`);
  }
  const { accessToken } = await requestTailscaleOAuthToken({
    oauthClientId: input.oauthClientId,
    oauthClientSecret: input.oauthClientSecret,
    fetchImpl: input.fetchImpl,
    apiBase: input.apiBase,
  });

  const fetchFn = input.fetchImpl ?? globalThis.fetch;
  const base = (input.apiBase ?? TAILSCALE_API_BASE).replace(/\/+$/u, "");
  const tailnet = input.tailnet?.trim() || "-";
  const response = await fetchFn(`${base}/tailnet/${encodeURIComponent(tailnet)}/keys`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      capabilities: {
        devices: {
          create: {
            reusable: false,
            ephemeral: true,
            preauthorized: true,
            tags,
          },
        },
      },
      expirySeconds: input.expirySeconds ?? 600,
      description: (input.description ?? "Roder Desktop ephemeral sandbox tunnel").slice(0, 50),
    }),
  });
  if (!response.ok) {
    const detail = await readTailscaleErrorMessage(response);
    throw new Error(
      `Could not mint ephemeral Tailscale auth key (${response.status})${detail ? `: ${detail}` : ". Ensure the OAuth client has auth_keys write scope and owns the configured tag."}`,
    );
  }
  const payload = (await response.json()) as { key?: unknown; id?: unknown; expires?: unknown };
  if (typeof payload.key !== "string" || !payload.key.trim()) {
    throw new Error("Tailscale API did not return an auth key.");
  }
  return {
    key: payload.key.trim(),
    ...(typeof payload.id === "string" ? { id: payload.id } : {}),
    ...(typeof payload.expires === "string" ? { expires: payload.expires } : {}),
  };
}

async function readTailscaleErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as { message?: unknown; error_description?: unknown; error?: unknown };
      const msg = parsed.message ?? parsed.error_description ?? parsed.error;
      if (typeof msg === "string" && msg.trim()) return msg.trim().slice(0, 220);
    } catch {
      // plain text body
    }
    return text.trim().slice(0, 220);
  } catch {
    return "";
  }
}

export function shellQuotePosixTailscale(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

export function buildTailscaleInstallScript(
  fallbackVersion = TAILSCALE_FALLBACK_VERSION,
  baseDir = "/root/.roder",
): string {
  const isHome = baseDir === "$HOME/.roder";
  const binDir = isHome ? '"$HOME/.roder/bin"' : shellQuotePosixTailscale(`${baseDir}/bin`);
  const stateDir = isHome ? '"$HOME/.roder/tailscale"' : shellQuotePosixTailscale(`${baseDir}/tailscale`);
  const runDir = isHome ? '"$HOME/.roder/run"' : shellQuotePosixTailscale(`${baseDir}/run`);
  const tsBin = isHome ? '"$HOME/.roder/bin/tailscale"' : shellQuotePosixTailscale(`${baseDir}/bin/tailscale`);
  const tsdBin = isHome ? '"$HOME/.roder/bin/tailscaled"' : shellQuotePosixTailscale(`${baseDir}/bin/tailscaled`);
  return [
    "set -eu",
    `mkdir -p ${binDir} ${stateDir} ${runDir}`,
    `ts_bin=${tsBin}`,
    `tsd_bin=${tsdBin}`,
    'if [ -x "$ts_bin" ] && [ -x "$tsd_bin" ]; then echo "TAILSCALE_READY"; exit 0; fi',
    "if command -v tailscale >/dev/null 2>&1 && command -v tailscaled >/dev/null 2>&1; then",
    '  ln -sf "$(command -v tailscale)" "$ts_bin"',
    '  ln -sf "$(command -v tailscaled)" "$tsd_bin"',
    '  echo "TAILSCALE_READY"',
    "  exit 0",
    "fi",
    'os="$(uname -s)"',
    'if [ "$os" != "Linux" ]; then echo "Automatic Tailscale binary injection requires Linux (macOS hosts should use the Tailscale app)." >&2; exit 43; fi',
    'arch="$(uname -m)"',
    'case "$arch" in',
    '  x86_64|amd64) ts_arch="amd64" ;;',
    '  aarch64|arm64) ts_arch="arm64" ;;',
    '  *) echo "unsupported arch for tailscale: $arch" >&2; exit 1 ;;',
    "esac",
    "download() {",
    '  if command -v curl >/dev/null 2>&1; then curl -fsSL --retry 3 --retry-delay 1 "$1" -o "$2"',
    '  elif command -v wget >/dev/null 2>&1; then wget -q "$1" -O "$2"',
    '  elif command -v python3 >/dev/null 2>&1; then python3 -c "import urllib.request,sys; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])" "$1" "$2"',
    '  elif command -v node >/dev/null 2>&1; then node -e "const fs=require(\'fs\'); fetch(process.argv[1]).then(async r=>{if(!r.ok)process.exit(1); fs.writeFileSync(process.argv[2], Buffer.from(await r.arrayBuffer()));})" "$1" "$2"',
    '  else echo "curl, wget, python3, or node is required to install Tailscale" >&2; exit 1; fi',
    "}",
    'tmp_dir="$(mktemp -d)"',
    "trap 'rm -rf \"$tmp_dir\"' EXIT",
    'tarball=""',
    'if download "https://pkgs.tailscale.com/stable/?mode=json" "$tmp_dir/meta.json" 2>/dev/null; then',
    "  if command -v python3 >/dev/null 2>&1; then",
    '    tarball="$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print((d.get(\'Tarballs\') or {}).get(sys.argv[2], \'\'))" "$tmp_dir/meta.json" "$ts_arch" 2>/dev/null || true)"',
    "  elif command -v node >/dev/null 2>&1; then",
    '    tarball="$(node -e "const d=JSON.parse(require(\'fs\').readFileSync(process.argv[1],\'utf8\')); console.log((d.Tarballs||{})[process.argv[2]]||\'\')" "$tmp_dir/meta.json" "$ts_arch" 2>/dev/null || true)"',
    "  fi",
    "fi",
    `if [ -z "$tarball" ]; then tarball="tailscale_${fallbackVersion}_\${ts_arch}.tgz"; fi`,
    'download "https://pkgs.tailscale.com/stable/${tarball}" "$tmp_dir/ts.tgz"',
    'tar -xzf "$tmp_dir/ts.tgz" -C "$tmp_dir"',
    'extracted_ts="$(find "$tmp_dir" -maxdepth 2 -type f -name tailscale | head -n 1)"',
    'extracted_tsd="$(find "$tmp_dir" -maxdepth 2 -type f -name tailscaled | head -n 1)"',
    '[ -n "$extracted_ts" ] && [ -n "$extracted_tsd" ] || { echo "Tailscale archive did not contain binaries" >&2; exit 1; }',
    'cp "$extracted_ts" "${ts_bin}.tmp" && chmod 0755 "${ts_bin}.tmp" && mv "${ts_bin}.tmp" "$ts_bin"',
    'cp "$extracted_tsd" "${tsd_bin}.tmp" && chmod 0755 "${tsd_bin}.tmp" && mv "${tsd_bin}.tmp" "$tsd_bin"',
    'echo "TAILSCALE_READY"',
  ].join("\n");
}

export function buildTailscaledLaunchCommand(baseDir = "/root/.roder"): string {
  const isHome = baseDir === "$HOME/.roder";
  const stateDir = isHome ? '"$HOME/.roder/tailscale"' : shellQuotePosixTailscale(`${baseDir}/tailscale`);
  const runDir = isHome ? '"$HOME/.roder/run"' : shellQuotePosixTailscale(`${baseDir}/run`);
  const sockPath = isHome
    ? '"$HOME/.roder/run/tailscaled.sock"'
    : shellQuotePosixTailscale(`${baseDir}/run/tailscaled.sock`);
  const tsdBin = isHome ? '"$HOME/.roder/bin/tailscaled"' : shellQuotePosixTailscale(`${baseDir}/bin/tailscaled`);
  return [
    `mkdir -p ${stateDir} ${runDir}`,
    `exec ${tsdBin} --tun=userspace-networking --statedir=${stateDir} --socket=${sockPath} --socks5-server=127.0.0.1:1055 --outbound-http-proxy-listen=127.0.0.1:1055`,
  ].join("; ");
}

export function buildTailscaleStatusProbeScript(baseDir = "/root/.roder"): string {
  const isHome = baseDir === "$HOME/.roder";
  const sockPath = isHome
    ? '"$HOME/.roder/run/tailscaled.sock"'
    : shellQuotePosixTailscale(`${baseDir}/run/tailscaled.sock`);
  const tsBin = isHome ? '"$HOME/.roder/bin/tailscale"' : shellQuotePosixTailscale(`${baseDir}/bin/tailscale`);
  return [
    `if [ -S ${sockPath} ] && [ -x ${tsBin} ]; then`,
    `  ${tsBin} --socket=${sockPath} status --json 2>/dev/null || echo '{"BackendState":"Stopped"}'`,
    "elif command -v tailscale >/dev/null 2>&1 && tailscale status --json >/dev/null 2>&1; then",
    "  tailscale status --json",
    "else",
    '  echo \'{"BackendState":"NotRunning"}\'',
    "fi",
  ].join("\n");
}

export function buildTailscaleWaitSocketScript(baseDir = "/root/.roder"): string {
  const isHome = baseDir === "$HOME/.roder";
  const sockPath = isHome
    ? '"$HOME/.roder/run/tailscaled.sock"'
    : shellQuotePosixTailscale(`${baseDir}/run/tailscaled.sock`);
  return [
    "for i in $(seq 1 40); do",
    `  if [ -S ${sockPath} ]; then echo "SOCKET_READY"; exit 0; fi`,
    "  sleep 0.25",
    "done",
    'echo "tailscaled socket did not appear" >&2',
    "exit 1",
  ].join("\n");
}

/**
 * Joins the userspace tailscaled instance to the user's tailnet without leaving the auth key on disk
 * or visible in long-lived process arguments.
 */
export function buildTailscaleUpScript(hostname: string, authKey: string, baseDir = "/root/.roder"): string {
  const safeHostname = sanitizeTailscaleHostname(hostname);
  const isHome = baseDir === "$HOME/.roder";
  const sockPath = isHome
    ? '"$HOME/.roder/run/tailscaled.sock"'
    : shellQuotePosixTailscale(`${baseDir}/run/tailscaled.sock`);
  const tsBin = isHome ? '"$HOME/.roder/bin/tailscale"' : shellQuotePosixTailscale(`${baseDir}/bin/tailscale`);
  const keyFileExpr = isHome ? '"$HOME/.roder/run/ts-auth-$$.key"' : '"/root/.roder/run/ts-auth-$$.key"';
  return [
    "set -eu",
    "umask 077",
    `key_file=${keyFileExpr}`,
    "trap 'rm -f \"$key_file\"' EXIT",
    `printf '%s' ${shellQuotePosixTailscale(authKey)} > "$key_file"`,
    `${tsBin} --socket=${sockPath} up --auth-key="file:$key_file" --hostname=${shellQuotePosixTailscale(safeHostname)} --accept-dns=false`,
    'rm -f "$key_file"',
    `${tsBin} --socket=${sockPath} status --json`,
  ].join("\n");
}

export function parseRemoteTailscaleIdentity(statusJson: string): {
  running: boolean;
  tailscaleIp: string | null;
  dnsName: string | null;
  backendState: string;
} {
  try {
    const trimmed = statusJson.trim();
    const jsonStart = trimmed.indexOf("{");
    if (jsonStart === -1) {
      return { running: false, tailscaleIp: null, dnsName: null, backendState: "Unknown" };
    }
    const parsed = JSON.parse(trimmed.slice(jsonStart)) as Record<string, unknown>;
    const backendState = typeof parsed.BackendState === "string" ? parsed.BackendState : "Unknown";
    const self = parsed.Self && typeof parsed.Self === "object" ? (parsed.Self as Record<string, unknown>) : null;
    const ip = firstIpv4(self?.TailscaleIPs) || firstIpv4(parsed.TailscaleIPs) || null;
    const dnsName = stripTrailingDot(self?.DNSName) || null;
    return {
      running: backendState === "Running" && Boolean(ip),
      tailscaleIp: ip,
      dnsName,
      backendState,
    };
  } catch {
    return { running: false, tailscaleIp: null, dnsName: null, backendState: "InvalidJson" };
  }
}

const safeHostPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,252}$/u;
const safeUserPattern = /^[a-zA-Z0-9._-]{1,64}$/u;

export function parseTailscalePeerConfig(config: Record<string, unknown> | undefined): TailscalePeerConfig {
  const record = config ?? {};
  const rawIp = typeof record.tailscale_ip === "string" ? record.tailscale_ip.trim() : "";
  const rawDns = stripTrailingDot(record.tailscale_host ?? record.dns_name ?? record.host);
  const host = rawIp || rawDns;
  if (!host || host.startsWith("-") || !safeHostPattern.test(host)) {
    throw new Error(
      'This Tailscale machine profile needs a valid "tailscale_host" or "tailscale_ip" (e.g. 100.x.y.z or devbox.tailnet.ts.net).',
    );
  }
  if (rawIp && (rawIp.startsWith("-") || !safeHostPattern.test(rawIp))) {
    throw new Error(`Invalid Tailscale IP "${rawIp}".`);
  }
  if (rawDns && (rawDns.startsWith("-") || !safeHostPattern.test(rawDns))) {
    throw new Error(`Invalid Tailscale hostname "${rawDns}".`);
  }

  const rawUser = typeof record.ssh_user === "string" ? record.ssh_user.trim() : "";
  if (rawUser && (rawUser.startsWith("-") || !safeUserPattern.test(rawUser))) {
    throw new Error(`Invalid SSH username "${rawUser}".`);
  }

  const rawPort = record.ssh_port;
  let sshPort = 22;
  if (rawPort !== undefined && rawPort !== "") {
    const parsedPort = typeof rawPort === "number" ? rawPort : Number.parseInt(String(rawPort), 10);
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      throw new Error("SSH port must be an integer between 1 and 65535.");
    }
    sshPort = parsedPort;
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

  return {
    host,
    ...(rawIp ? { tailscaleIp: rawIp } : {}),
    ...(rawDns ? { dnsName: rawDns } : {}),
    ...(rawUser ? { sshUser: rawUser } : {}),
    sshPort,
    remoteRoderPort,
  };
}

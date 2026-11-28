import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import type { BlaxelClient } from "./blaxel-client";
import type { BlaxelAuth, ResolvedTailscaleAuth } from "./credentials";
import {
  buildTailscaledLaunchCommand,
  buildTailscaleInstallScript,
  buildTailscaleStatusProbeScript,
  buildTailscaleUpScript,
  buildTailscaleWaitSocketScript,
  mintTailscaleEphemeralAuthKey,
  parseRemoteTailscaleIdentity,
  TAILSCALE_DAEMON_PROCESS_NAME,
  type TailscalePeerConfig,
} from "./tailscale";
import type { SshMachineTargetConfig } from "./ssh-config";
import type { ActiveSshPortForward, SshConnectionTarget, TailscaleSshClient } from "./tailscale-ssh";

export const REMOTE_RODER_PORT = 17373;
export const REMOTE_RODER_PROTOCOL = "roder.remote.v1";
export const REMOTE_RODER_BINARY_PATH = "/root/.roder/bin/remote-roder";
export const REMOTE_RODER_TOKEN_PATH = "/root/.roder/bridge.token";
export const REMOTE_RODER_PROCESS_NAME = "roder-app-server";
export const REMOTE_RODER_PREVIEW_NAME = "roder-app-server";
export const REMOTE_RODER_DOWNLOAD_BASE = "https://github.com/RoderAI/roder/releases/download/latest";
const RPC_TIMEOUT_MS = 30_000;
const DEFAULT_KEEPALIVE_INTERVAL_MS = 20_000;

export class RemoteRoderUnsupportedRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteRoderUnsupportedRuntimeError";
  }
}

export type RemoteTunnelNotification = {
  method: string;
  params: unknown;
};

type WebSocketWithInitCtor = new (
  url: string,
  init?: string | string[] | { protocols?: string[]; headers?: Record<string, string> },
) => WebSocket;

export type RemoteWebSocketFactory = (
  url: string,
  options: { protocols: string[]; headers: Record<string, string> },
) => WebSocket;

type PendingRpc = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export function shellQuotePosixTunnel(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

export function buildRemoteRoderInstallScript(
  workingDir: string,
  downloadBaseUrl = REMOTE_RODER_DOWNLOAD_BASE,
): string {
  const cleanBase = downloadBaseUrl.replace(/\/+$/u, "");
  return [
    "set -eu",
    `mkdir -p ${shellQuotePosixTunnel(workingDir)} /root/.roder/bin`,
    "if [ -f /etc/alpine-release ] && ! [ -e /lib64/ld-linux-x86-64.so.2 ] && ! [ -e /lib/ld-linux-aarch64.so.1 ]; then",
    '  echo "RODER_UNSUPPORTED_MUSL" >&2',
    "  exit 42",
    "fi",
    'arch="$(uname -m)"',
    'case "$arch" in',
    '  x86_64|amd64) target="x86_64-unknown-linux-gnu" ;;',
    '  aarch64|arm64) target="aarch64-unknown-linux-gnu" ;;',
    '  *) echo "unsupported arch: $arch" >&2; exit 1 ;;',
    "esac",
    `bin=${shellQuotePosixTunnel(REMOTE_RODER_BINARY_PATH)}`,
    "download() {",
    '  if command -v curl >/dev/null 2>&1; then curl -fsSL --retry 3 --retry-delay 1 "$1" -o "$2"',
    '  elif command -v wget >/dev/null 2>&1; then wget -q "$1" -O "$2"',
    '  elif command -v python3 >/dev/null 2>&1; then python3 -c "import urllib.request,sys; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])" "$1" "$2"',
    '  elif command -v node >/dev/null 2>&1; then node -e "const fs=require(\'fs\'); fetch(process.argv[1]).then(async r=>{if(!r.ok)process.exit(1); fs.writeFileSync(process.argv[2], Buffer.from(await r.arrayBuffer()));})" "$1" "$2"',
    '  else echo "curl, wget, python3, or node is required to install remote-roder" >&2; exit 1; fi',
    "}",
    'if [ ! -x "$bin" ]; then',
    `  url="${cleanBase}/remote-roder-\${target}"`,
    '  download "$url" "${bin}.tmp"',
    '  download "${url}.sha256" "${bin}.sha256"',
    '  expected="$(awk \'{print $1}\' "${bin}.sha256")"',
    '  actual="$(sha256sum "${bin}.tmp" | awk \'{print $1}\')"',
    '  [ "$expected" = "$actual" ] || { echo "remote-roder sha256 mismatch" >&2; exit 1; }',
    '  chmod 0755 "${bin}.tmp"',
    '  mv "${bin}.tmp" "$bin"',
    '  rm -f "${bin}.sha256"',
    "fi",
    'echo "RODER_BINARY_READY"',
  ].join("\n");
}

export function previewHttpUrlToWsUrl(previewUrl: string): string {
  const parsed = new URL(previewUrl);
  parsed.protocol = parsed.protocol === "http:" ? "ws:" : "wss:";
  parsed.pathname = parsed.pathname.replace(/\/+$/u, "") || "/";
  return parsed.toString().replace(/\/$/u, "");
}

export class RemoteRoderTunnelConnection extends EventEmitter {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRpc>();
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private ready = false;

  constructor(
    private readonly options: {
      wsUrl: string;
      remoteToken: string;
      extraHeaders?: Record<string, string>;
      createWebSocket?: RemoteWebSocketFactory;
      clientVersion?: string;
      keepAliveMs?: number;
    },
  ) {
    super();
  }

  isOpen(): boolean {
    return !this.closed && this.ready && this.ws !== null && this.ws.readyState === 1;
  }

  async connect(): Promise<Record<string, unknown>> {
    const factory: RemoteWebSocketFactory =
      this.options.createWebSocket ??
      ((url, init) => {
        const WsCtor = globalThis.WebSocket as unknown as WebSocketWithInitCtor;
        return new WsCtor(url, init);
      });

    const protocols = [REMOTE_RODER_PROTOCOL, `bearer.${this.options.remoteToken}`];
    const headers: Record<string, string> = {
      ...this.options.extraHeaders,
      Authorization: `Bearer ${this.options.remoteToken}`,
    };

    const ws = factory(this.options.wsUrl, { protocols, headers });
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out connecting to remote Roder app-server tunnel."));
      }, 15_000);
      const cleanup = () => clearTimeout(timeout);

      ws.addEventListener("open", () => {
        cleanup();
        resolve();
      });
      ws.addEventListener("error", () => {
        cleanup();
        reject(new Error("WebSocket tunnel handshake to remote Roder app-server failed."));
      });
      ws.addEventListener("close", (event) => {
        cleanup();
        const closeCode = (event as { code?: number }).code ?? 1006;
        reject(new Error(`Remote Roder app-server tunnel closed during handshake (${closeCode}).`));
      });
    });

    ws.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : String(event.data ?? "");
      this.handleMessage(raw);
    });
    ws.addEventListener("close", () => {
      this.stopKeepAlive();
      this.ready = false;
      this.ws = null;
      this.rejectAll(new Error("Remote Roder app-server tunnel disconnected."));
      this.emit("close");
    });
    ws.addEventListener("error", () => {
      // Close event handles cleanup.
    });

    this.ready = true;
    const initResult = (await this.request("initialize", {
      clientInfo: {
        name: "roder-desktop-bridge",
        title: "Roder Desktop",
        version: this.options.clientVersion ?? "0.1.19",
      },
      capabilities: {
        experimentalApi: true,
      },
    })) as Record<string, unknown>;
    this.startKeepAlive();
    return initResult;
  }

  request(method: string, params: unknown = {}): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== 1) {
      return Promise.reject(new Error("Remote Roder app-server tunnel is not connected."));
    }
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Remote Roder app-server ${method} timed out after ${RPC_TIMEOUT_MS}ms`));
      }, RPC_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws!.send(payload);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    this.stopKeepAlive();
    this.rejectAll(new Error("Remote Roder app-server tunnel closed."));
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close(1000, "closed by roder-desktop");
    } catch {
      // ignore
    }
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    const intervalMs = this.options.keepAliveMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS;
    if (intervalMs <= 0) return;
    const timer = setInterval(() => {
      if (!this.isOpen()) {
        this.stopKeepAlive();
        return;
      }
      // Keep Blaxel preview proxies from closing idle WebSocket connections.
      void this.request("workspace/list", {}).catch(() => {
        if (!this.isOpen()) {
          this.stopKeepAlive();
        }
      });
    }, intervalMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    this.keepAliveTimer = timer;
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private handleMessage(raw: string): void {
    let message: {
      id?: number | string;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { code?: number; message?: string };
    };
    try {
      message = JSON.parse(raw) as typeof message;
    } catch {
      return;
    }

    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || "Remote Roder app-server error"));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message.method === "string" && message.method !== "event") {
      this.emit("notification", {
        method: message.method,
        params: message.params ?? {},
      } satisfies RemoteTunnelNotification);
    }
  }

  private rejectAll(error: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }
}

export type RemoteTunnelTransport = "tailscale" | "ssh-forward" | "blaxel-preview";

export type ActiveRemoteTunnel = {
  key: string;
  sandboxName: string;
  workingDir: string;
  wsUrl: string;
  transport: RemoteTunnelTransport;
  tailscaleIp?: string;
  tailscaleDnsName?: string;
  remoteWorkspaceId: string;
  remoteRootId: string;
  connection: RemoteRoderTunnelConnection;
  desktopWorkspaceIds: Set<string>;
};

export type RemoteRoderTunnelManagerOptions = {
  blaxelClient: BlaxelClient;
  sshClient?: TailscaleSshClient;
  createWebSocket?: RemoteWebSocketFactory;
  downloadBaseUrl?: string;
  fetchImpl?: typeof fetch;
};

type CachedTunnelEndpoint = {
  wsUrl: string;
  remoteToken: string;
  transport: RemoteTunnelTransport;
  tailscaleIp?: string;
  tailscaleDnsName?: string;
};

export function buildPeerRemoteRoderInstallScript(
  workingDir: string,
  downloadBaseUrl = REMOTE_RODER_DOWNLOAD_BASE,
): string {
  const cleanBase = downloadBaseUrl.replace(/\/+$/u, "");
  return [
    "set -eu",
    `mkdir -p ${shellQuotePosixTunnel(workingDir)} "$HOME/.roder/bin"`,
    'if [ -x "$HOME/.roder/bin/remote-roder" ]; then printf "RODER_BIN:%s\\n" "$HOME/.roder/bin/remote-roder"; exit 0; fi',
    'if command -v remote-roder >/dev/null 2>&1; then printf "RODER_BIN:%s\\n" "$(command -v remote-roder)"; exit 0; fi',
    'if command -v roder >/dev/null 2>&1; then printf "RODER_BIN:%s\\n" "$(command -v roder)"; exit 0; fi',
    'os="$(uname -s)"',
    'if [ "$os" != "Linux" ]; then echo "RODER_UNSUPPORTED_PEER_OS:$os" >&2; exit 42; fi',
    "if [ -f /etc/alpine-release ] && ! [ -e /lib64/ld-linux-x86-64.so.2 ] && ! [ -e /lib/ld-linux-aarch64.so.1 ]; then",
    '  echo "RODER_UNSUPPORTED_MUSL" >&2',
    "  exit 42",
    "fi",
    'arch="$(uname -m)"',
    'case "$arch" in',
    '  x86_64|amd64) target="x86_64-unknown-linux-gnu" ;;',
    '  aarch64|arm64) target="aarch64-unknown-linux-gnu" ;;',
    '  *) echo "unsupported arch: $arch" >&2; exit 42 ;;',
    "esac",
    'bin="$HOME/.roder/bin/remote-roder"',
    "download() {",
    '  if command -v curl >/dev/null 2>&1; then curl -fsSL --retry 3 --retry-delay 1 "$1" -o "$2"',
    '  elif command -v wget >/dev/null 2>&1; then wget -q "$1" -O "$2"',
    '  elif command -v python3 >/dev/null 2>&1; then python3 -c "import urllib.request,sys; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])" "$1" "$2"',
    '  elif command -v node >/dev/null 2>&1; then node -e "const fs=require(\'fs\'); fetch(process.argv[1]).then(async r=>{if(!r.ok)process.exit(1); fs.writeFileSync(process.argv[2], Buffer.from(await r.arrayBuffer()));})" "$1" "$2"',
    '  else echo "curl, wget, python3, or node is required to install remote-roder" >&2; exit 1; fi',
    "}",
    `url="${cleanBase}/remote-roder-\${target}"`,
    'download "$url" "${bin}.tmp"',
    'download "${url}.sha256" "${bin}.sha256"',
    'expected="$(awk \'{print $1}\' "${bin}.sha256")"',
    'actual="$(sha256sum "${bin}.tmp" | awk \'{print $1}\')"',
    '[ "$expected" = "$actual" ] || { echo "remote-roder sha256 mismatch" >&2; exit 1; }',
    'chmod 0755 "${bin}.tmp"',
    'mv "${bin}.tmp" "$bin"',
    'rm -f "${bin}.sha256"',
    'printf "RODER_BIN:%s\\n" "$bin"',
  ].join("\n");
}

export class RemoteRoderTunnelManager extends EventEmitter {
  private readonly tunnels = new Map<string, ActiveRemoteTunnel>();
  private readonly connecting = new Map<string, Promise<ActiveRemoteTunnel>>();
  private readonly unsupportedKeys = new Map<string, string>();
  private readonly tailscaleErrors = new Map<string, string>();
  private readonly cachedEndpoints = new Map<string, CachedTunnelEndpoint>();

  constructor(private readonly options: RemoteRoderTunnelManagerOptions) {
    super();
  }

  isUnsupported(key: string): string | null {
    return this.unsupportedKeys.get(key) ?? null;
  }

  getTailscaleError(key: string): string | null {
    return this.tailscaleErrors.get(key) ?? null;
  }

  getActiveTunnel(key: string): ActiveRemoteTunnel | null {
    const tunnel = this.tunnels.get(key);
    return tunnel && tunnel.connection.isOpen() ? tunnel : null;
  }

  closeTunnel(key: string): void {
    const existing = this.tunnels.get(key);
    if (existing) {
      existing.connection.close();
      this.tunnels.delete(key);
    }
    this.cachedEndpoints.delete(key);
  }

  closeAll(): void {
    for (const tunnel of this.tunnels.values()) {
      tunnel.connection.close();
    }
    this.tunnels.clear();
    this.unsupportedKeys.clear();
    this.tailscaleErrors.clear();
    this.cachedEndpoints.clear();
  }

  async ensureBlaxelTunnel(input: {
    desktopWorkspaceId: string;
    desktopRootName: string;
    auth: BlaxelAuth;
    sandboxName: string;
    sandboxUrl: string;
    workingDir: string;
    tailscaleAuth?: ResolvedTailscaleAuth | null;
    preferTailscale?: boolean;
    requireTailscale?: boolean;
  }): Promise<ActiveRemoteTunnel> {
    const key = tunnelKey("blaxel", input.auth.workspace, input.sandboxName, input.workingDir);
    const unsupportedReason = this.unsupportedKeys.get(key);
    if (unsupportedReason) {
      throw new RemoteRoderUnsupportedRuntimeError(unsupportedReason);
    }

    const existing = this.tunnels.get(key);
    if (existing && existing.connection.isOpen()) {
      if (!input.requireTailscale || existing.transport === "tailscale") {
        existing.desktopWorkspaceIds.add(input.desktopWorkspaceId);
        return existing;
      }
      this.closeTunnel(key);
    }

    const inflight = this.connecting.get(key);
    if (inflight) {
      const tunnel = await inflight;
      tunnel.desktopWorkspaceIds.add(input.desktopWorkspaceId);
      return tunnel;
    }

    const connectPromise = this.bootstrapAndConnectBlaxel(key, input).finally(() => {
      if (this.connecting.get(key) === connectPromise) {
        this.connecting.delete(key);
      }
    });
    this.connecting.set(key, connectPromise);
    return connectPromise;
  }

  async ensureTailscalePeerTunnel(input: {
    desktopWorkspaceId: string;
    desktopRootName: string;
    peer: TailscalePeerConfig;
    workingDir: string;
  }): Promise<ActiveRemoteTunnel> {
    const key = tunnelKey("tailscale", input.peer.sshUser ?? "", input.peer.host, input.workingDir);
    const unsupportedReason = this.unsupportedKeys.get(key);
    if (unsupportedReason) {
      throw new RemoteRoderUnsupportedRuntimeError(unsupportedReason);
    }

    const existing = this.tunnels.get(key);
    if (existing && existing.connection.isOpen()) {
      existing.desktopWorkspaceIds.add(input.desktopWorkspaceId);
      return existing;
    }

    const inflight = this.connecting.get(key);
    if (inflight) {
      const tunnel = await inflight;
      tunnel.desktopWorkspaceIds.add(input.desktopWorkspaceId);
      return tunnel;
    }

    const connectPromise = this.bootstrapAndConnectSshTarget(key, {
      desktopWorkspaceId: input.desktopWorkspaceId,
      desktopRootName: input.desktopRootName,
      target: input.peer,
      workingDir: input.workingDir,
      mode: "tailscale-peer",
    }).finally(() => {
      if (this.connecting.get(key) === connectPromise) {
        this.connecting.delete(key);
      }
    });
    this.connecting.set(key, connectPromise);
    return connectPromise;
  }

  async ensureSshMachineTunnel(input: {
    desktopWorkspaceId: string;
    desktopRootName: string;
    target: SshMachineTargetConfig;
    workingDir: string;
    tailscaleAuth?: ResolvedTailscaleAuth | null;
    preferTailscale?: boolean;
    requireTailscale?: boolean;
  }): Promise<ActiveRemoteTunnel> {
    const key = tunnelKey("ssh", input.target.sshUser ?? "", input.target.host, input.workingDir);
    const unsupportedReason = this.unsupportedKeys.get(key);
    if (unsupportedReason) {
      throw new RemoteRoderUnsupportedRuntimeError(unsupportedReason);
    }

    const existing = this.tunnels.get(key);
    if (existing && existing.connection.isOpen()) {
      if (!input.requireTailscale || existing.transport === "tailscale") {
        existing.desktopWorkspaceIds.add(input.desktopWorkspaceId);
        return existing;
      }
      this.closeTunnel(key);
    }

    const inflight = this.connecting.get(key);
    if (inflight) {
      const tunnel = await inflight;
      tunnel.desktopWorkspaceIds.add(input.desktopWorkspaceId);
      return tunnel;
    }

    const connectPromise = this.bootstrapAndConnectSshTarget(key, {
      desktopWorkspaceId: input.desktopWorkspaceId,
      desktopRootName: input.desktopRootName,
      target: input.target,
      workingDir: input.workingDir,
      mode: "ssh-machine",
      tailscaleAuth: input.tailscaleAuth,
      preferTailscale: input.preferTailscale,
      requireTailscale: input.requireTailscale,
    }).finally(() => {
      if (this.connecting.get(key) === connectPromise) {
        this.connecting.delete(key);
      }
    });
    this.connecting.set(key, connectPromise);
    return connectPromise;
  }

  private async bootstrapAndConnectBlaxel(
    key: string,
    input: {
      desktopWorkspaceId: string;
      desktopRootName: string;
      auth: BlaxelAuth;
      sandboxName: string;
      sandboxUrl: string;
      workingDir: string;
      tailscaleAuth?: ResolvedTailscaleAuth | null;
      preferTailscale?: boolean;
      requireTailscale?: boolean;
    },
  ): Promise<ActiveRemoteTunnel> {
    const { blaxelClient } = this.options;
    const { auth, sandboxName, sandboxUrl, workingDir } = input;
    const shouldAttemptTailscale =
      Boolean(input.tailscaleAuth) && (input.preferTailscale !== false || Boolean(input.requireTailscale));

    // 0. Fast-path reconnect if we already bootstrapped this sandbox's endpoint & token.
    const cachedEndpoint = this.cachedEndpoints.get(key);
    if (cachedEndpoint && (!input.requireTailscale || cachedEndpoint.transport === "tailscale")) {
      try {
        const fastConnection = new RemoteRoderTunnelConnection({
          wsUrl: cachedEndpoint.wsUrl,
          remoteToken: cachedEndpoint.remoteToken,
          extraHeaders:
            cachedEndpoint.transport === "blaxel-preview"
              ? {
                  "X-Blaxel-Authorization": `Bearer ${auth.apiKey}`,
                  ...(auth.workspace ? { "X-Blaxel-Workspace": auth.workspace } : {}),
                }
              : undefined,
          createWebSocket: this.options.createWebSocket,
        });
        await fastConnection.connect();
        const { remoteWorkspaceId, remoteRootId } = await ensureRemoteServerWorkspace(
          fastConnection,
          workingDir,
          input.desktopRootName,
        );
        return this.registerActiveTunnel(key, {
          sandboxName,
          workingDir,
          wsUrl: cachedEndpoint.wsUrl,
          transport: cachedEndpoint.transport,
          tailscaleIp: cachedEndpoint.tailscaleIp,
          tailscaleDnsName: cachedEndpoint.tailscaleDnsName,
          remoteToken: cachedEndpoint.remoteToken,
          remoteWorkspaceId,
          remoteRootId,
          connection: fastConnection,
          desktopWorkspaceId: input.desktopWorkspaceId,
        });
      } catch {
        // Cached endpoint may have expired or sandbox restarted; fall through to full bootstrap.
        this.cachedEndpoints.delete(key);
      }
    }

    // 1. Wake standby sandbox & ensure workspace dir exists.
    await blaxelClient.wakeSandbox(auth, sandboxUrl);
    await blaxelClient.ensureDirectory(auth, sandboxUrl, workingDir);

    // 2. Inject / verify remote-roder binary in sandbox.
    const installScript = buildRemoteRoderInstallScript(workingDir, this.options.downloadBaseUrl);
    const installResult = await blaxelClient.runProcess(auth, sandboxUrl, {
      name: "roder-bridge-install",
      command: `sh -c ${shellQuotePosixTunnel(installScript)}`,
      workingDir,
      waitForCompletion: true,
      timeoutMs: 90_000,
    });
    const combinedInstall = `${installResult.stdout}\n${installResult.stderr}\n${installResult.logs}`;
    if (installResult.exitCode === 42 || combinedInstall.includes("RODER_UNSUPPORTED_MUSL")) {
      const reason =
        "Sandbox uses Alpine/musl libc; remote-roder requires a glibc Linux image (e.g. blaxel/py-app:latest).";
      this.unsupportedKeys.set(key, reason);
      throw new RemoteRoderUnsupportedRuntimeError(reason);
    }
    if (installResult.exitCode !== 0) {
      throw new Error(
        `Could not install remote-roder in sandbox "${sandboxName}": ${combinedInstall.trim().slice(-240)}`,
      );
    }

    // 3. Check if remote-roder app-server is already running & healthy on 127.0.0.1:17373 with our token.
    const probeScript = [
      `if [ -r ${shellQuotePosixTunnel(REMOTE_RODER_TOKEN_PATH)} ] && (`,
      `  (command -v curl >/dev/null 2>&1 && curl -fsS http://127.0.0.1:${REMOTE_RODER_PORT}/readyz >/dev/null 2>&1) ||`,
      `  (command -v python3 >/dev/null 2>&1 && python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:${REMOTE_RODER_PORT}/readyz', timeout=2)" >/dev/null 2>&1)`,
      `); then`,
      `  printf 'REUSE:'`,
      `  cat ${shellQuotePosixTunnel(REMOTE_RODER_TOKEN_PATH)}`,
      `else`,
      `  echo 'NEED_START'`,
      `fi`,
    ].join("\n");
    const probe = await blaxelClient.runProcess(auth, sandboxUrl, {
      name: "roder-bridge-probe",
      command: `sh -c ${shellQuotePosixTunnel(probeScript)}`,
      workingDir,
      waitForCompletion: true,
      timeoutMs: 10_000,
    });
    const probeOut = (probe.stdout || probe.logs || "").trim();
    let remoteToken = "";
    if (probeOut.startsWith("REUSE:") && probeOut.slice("REUSE:".length).trim().length >= 16) {
      remoteToken = probeOut.slice("REUSE:".length).trim();
    } else {
      remoteToken = randomBytes(32).toString("base64url");
      const tokenSetupScript = [
        "set -eu",
        "umask 077",
        "mkdir -p /root/.roder",
        `printf '%s' ${shellQuotePosixTunnel(remoteToken)} > ${shellQuotePosixTunnel(REMOTE_RODER_TOKEN_PATH)}`,
      ].join("\n");
      await blaxelClient.runProcess(auth, sandboxUrl, {
        name: "roder-bridge-token",
        command: `sh -c ${shellQuotePosixTunnel(tokenSetupScript)}`,
        workingDir,
        waitForCompletion: true,
        timeoutMs: 10_000,
      });

      const launchCmd = [
        `export RODER_REMOTE_APP_SERVER_TOKEN=${shellQuotePosixTunnel(remoteToken)}`,
        `exec ${shellQuotePosixTunnel(REMOTE_RODER_BINARY_PATH)} app-server --remote --listen ws://0.0.0.0:${REMOTE_RODER_PORT} --auth-token env:RODER_REMOTE_APP_SERVER_TOKEN --print-qr=false`,
      ].join("; ");
      await blaxelClient.runProcess(auth, sandboxUrl, {
        name: REMOTE_RODER_PROCESS_NAME,
        command: `sh -c ${shellQuotePosixTunnel(launchCmd)}`,
        workingDir,
        waitForCompletion: false,
        keepAlive: true,
        timeoutMs: 0,
        restartOnFailure: true,
        maxRestarts: 5,
      });

      const waitReadyScript = [
        "for i in $(seq 1 40); do",
        `  if (command -v curl >/dev/null 2>&1 && curl -fsS http://127.0.0.1:${REMOTE_RODER_PORT}/readyz >/dev/null 2>&1) ||`,
        `     (command -v python3 >/dev/null 2>&1 && python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:${REMOTE_RODER_PORT}/readyz', timeout=2)" >/dev/null 2>&1); then`,
        '    echo "READY"',
        "    exit 0",
        "  fi",
        "  sleep 0.25",
        "done",
        "exit 1",
      ].join("\n");
      const ready = await blaxelClient.runProcess(auth, sandboxUrl, {
        name: "roder-bridge-ready",
        command: `sh -c ${shellQuotePosixTunnel(waitReadyScript)}`,
        workingDir,
        waitForCompletion: true,
        timeoutMs: 15_000,
      });
      if (ready.exitCode !== 0) {
        throw new Error(
          `Remote Roder app-server did not become ready on port ${REMOTE_RODER_PORT} in "${sandboxName}".`,
        );
      }
    }

    // 4a. First-party Tailscale tunnel injection (when configured & enabled).
    if (shouldAttemptTailscale && input.tailscaleAuth) {
      try {
        const tsIdentity = await this.bootstrapTailscaleInBlaxel({
          auth,
          sandboxName,
          sandboxUrl,
          workingDir,
          tailscaleAuth: input.tailscaleAuth,
        });
        const tsWsUrl = `ws://${tsIdentity.tailscaleIp}:${REMOTE_RODER_PORT}`;
        const tsConnection = new RemoteRoderTunnelConnection({
          wsUrl: tsWsUrl,
          remoteToken,
          createWebSocket: this.options.createWebSocket,
        });
        await tsConnection.connect();
        this.tailscaleErrors.delete(key);
        const { remoteWorkspaceId, remoteRootId } = await ensureRemoteServerWorkspace(
          tsConnection,
          workingDir,
          input.desktopRootName,
        );
        return this.registerActiveTunnel(key, {
          sandboxName,
          workingDir,
          wsUrl: tsWsUrl,
          transport: "tailscale",
          tailscaleIp: tsIdentity.tailscaleIp,
          tailscaleDnsName: tsIdentity.dnsName ?? undefined,
          remoteToken,
          remoteWorkspaceId,
          remoteRootId,
          connection: tsConnection,
          desktopWorkspaceId: input.desktopWorkspaceId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.tailscaleErrors.set(key, message);
        if (input.requireTailscale) {
          throw error;
        }
        console.warn(`[roder-tailscale-tunnel] Falling back to Blaxel WSS preview for "${sandboxName}": ${message}`);
      }
    }

    // 4b. Create/reuse private Blaxel TLS preview tunnel on port 17373.
    const preview = await blaxelClient.createPreview(auth, sandboxName, REMOTE_RODER_PORT, {
      name: REMOTE_RODER_PREVIEW_NAME,
      public: false,
    });
    const wsUrl = previewHttpUrlToWsUrl(preview.url);

    // 5. Connect double-authenticated WebSocket tunnel to remote-roder app-server!
    const connection = new RemoteRoderTunnelConnection({
      wsUrl,
      remoteToken,
      extraHeaders: {
        "X-Blaxel-Authorization": `Bearer ${auth.apiKey}`,
        ...(auth.workspace ? { "X-Blaxel-Workspace": auth.workspace } : {}),
      },
      createWebSocket: this.options.createWebSocket,
    });
    await connection.connect();

    // 6. Ensure remote workspace is registered on the remote Roder app-server!
    const { remoteWorkspaceId, remoteRootId } = await ensureRemoteServerWorkspace(
      connection,
      workingDir,
      input.desktopRootName,
    );

    return this.registerActiveTunnel(key, {
      sandboxName,
      workingDir,
      wsUrl,
      transport: "blaxel-preview",
      remoteToken,
      remoteWorkspaceId,
      remoteRootId,
      connection,
      desktopWorkspaceId: input.desktopWorkspaceId,
    });
  }

  private async bootstrapTailscaleInBlaxel(input: {
    auth: BlaxelAuth;
    sandboxName: string;
    sandboxUrl: string;
    workingDir: string;
    tailscaleAuth: ResolvedTailscaleAuth;
  }): Promise<{ tailscaleIp: string; dnsName: string | null }> {
    const { blaxelClient } = this.options;
    const { auth, sandboxName, sandboxUrl, workingDir, tailscaleAuth } = input;

    // 1. Fast probe: is userspace tailscaled already running and joined?
    const probe = await blaxelClient.runProcess(auth, sandboxUrl, {
      name: "roder-ts-probe",
      command: `sh -c ${shellQuotePosixTunnel(buildTailscaleStatusProbeScript())}`,
      workingDir,
      waitForCompletion: true,
      timeoutMs: 10_000,
    });
    const existingIdentity = parseRemoteTailscaleIdentity(probe.stdout || probe.logs || "");
    if (existingIdentity.running && existingIdentity.tailscaleIp) {
      return { tailscaleIp: existingIdentity.tailscaleIp, dnsName: existingIdentity.dnsName };
    }

    // 2. Install static tailscale + tailscaled binaries (works on glibc and musl without root).
    const install = await blaxelClient.runProcess(auth, sandboxUrl, {
      name: "roder-ts-install",
      command: `sh -c ${shellQuotePosixTunnel(buildTailscaleInstallScript())}`,
      workingDir,
      waitForCompletion: true,
      timeoutMs: 90_000,
    });
    if (install.exitCode !== 0) {
      const detail = `${install.stdout}\n${install.stderr}\n${install.logs}`.trim().slice(-240);
      throw new Error(`Could not install Tailscale in sandbox "${sandboxName}": ${detail}`);
    }

    // 3. Start userspace tailscaled daemon if socket isn't ready yet.
    if (existingIdentity.backendState === "NotRunning") {
      await blaxelClient.runProcess(auth, sandboxUrl, {
        name: TAILSCALE_DAEMON_PROCESS_NAME,
        command: `sh -c ${shellQuotePosixTunnel(buildTailscaledLaunchCommand())}`,
        workingDir,
        waitForCompletion: false,
        keepAlive: true,
        timeoutMs: 0,
        restartOnFailure: true,
        maxRestarts: 5,
      });
      const waitSocket = await blaxelClient.runProcess(auth, sandboxUrl, {
        name: "roder-ts-wait-sock",
        command: `sh -c ${shellQuotePosixTunnel(buildTailscaleWaitSocketScript())}`,
        workingDir,
        waitForCompletion: true,
        timeoutMs: 15_000,
      });
      if (waitSocket.exitCode !== 0) {
        throw new Error(`Userspace tailscaled did not start in sandbox "${sandboxName}".`);
      }
    }

    // 4. Resolve or mint ephemeral auth key (never persisted in sandbox).
    const authKey =
      tailscaleAuth.mode === "oauth"
        ? (
            await mintTailscaleEphemeralAuthKey({
              oauthClientId: tailscaleAuth.oauthClientId,
              oauthClientSecret: tailscaleAuth.oauthClientSecret,
              tags: tailscaleAuth.tags,
              tailnet: tailscaleAuth.tailnet,
              description: `roder-${sandboxName}`,
              fetchImpl: this.options.fetchImpl,
            })
          ).key
        : tailscaleAuth.authKey;

    // 5. Join tailnet with ephemeral hostname.
    const upResult = await blaxelClient.runProcess(auth, sandboxUrl, {
      name: "roder-ts-up",
      command: `sh -c ${shellQuotePosixTunnel(buildTailscaleUpScript(sandboxName, authKey))}`,
      workingDir,
      waitForCompletion: true,
      timeoutMs: 30_000,
    });
    if (upResult.exitCode !== 0) {
      const detail = `${upResult.stderr || upResult.logs || upResult.stdout}`.trim().slice(-240);
      throw new Error(`Could not join sandbox "${sandboxName}" to Tailscale: ${detail}`);
    }
    const joined = parseRemoteTailscaleIdentity(upResult.stdout || upResult.logs || "");
    if (!joined.running || !joined.tailscaleIp) {
      throw new Error(
        `Tailscale started in "${sandboxName}" but did not receive a tailnet IP (state: ${joined.backendState}).`,
      );
    }
    return { tailscaleIp: joined.tailscaleIp, dnsName: joined.dnsName };
  }

  private async bootstrapTailscaleOverSsh(input: {
    target: SshConnectionTarget;
    machineLabel: string;
    tailscaleAuth: ResolvedTailscaleAuth;
  }): Promise<{ tailscaleIp: string; dnsName: string | null }> {
    const sshClient = this.options.sshClient;
    if (!sshClient) {
      throw new Error("SSH client is not configured.");
    }
    const baseDir = "$HOME/.roder";

    // 1. Check whether Tailscale (userspace or system daemon) is already running on this server.
    const probe = await sshClient.execCommand(
      input.target,
      `sh -c ${shellQuotePosixTunnel(buildTailscaleStatusProbeScript(baseDir))}`,
      { timeoutMs: 15_000 },
    );
    const existing = parseRemoteTailscaleIdentity(probe.stdout);
    if (existing.running && existing.tailscaleIp) {
      return { tailscaleIp: existing.tailscaleIp, dnsName: existing.dnsName };
    }

    // 2. Install static tailscale + tailscaled into $HOME/.roder/bin/ (no sudo needed!).
    const install = await sshClient.execCommand(
      input.target,
      `sh -c ${shellQuotePosixTunnel(buildTailscaleInstallScript(undefined, baseDir))}`,
      { timeoutMs: 90_000 },
    );
    if (install.exitCode !== 0) {
      const detail = `${install.stderr || install.stdout}`.trim().slice(-240);
      throw new Error(`Could not install Tailscale on "${input.target.host}": ${detail}`);
    }

    // 3. Start detached userspace tailscaled if not running yet.
    if (existing.backendState === "NotRunning") {
      const launchDaemonScript = [
        "set -eu",
        'mkdir -p "$HOME/.roder/tailscale" "$HOME/.roder/run"',
        `nohup "$HOME/.roder/bin/tailscaled" --tun=userspace-networking --statedir="$HOME/.roder/tailscale" --socket="$HOME/.roder/run/tailscaled.sock" --socks5-server=127.0.0.1:1055 --outbound-http-proxy-listen=127.0.0.1:1055 </dev/null >"$HOME/.roder/run/tailscaled.log" 2>&1 &`,
        buildTailscaleWaitSocketScript(baseDir),
      ].join("\n");
      const started = await sshClient.execCommand(input.target, `sh -c ${shellQuotePosixTunnel(launchDaemonScript)}`, {
        timeoutMs: 25_000,
      });
      if (started.exitCode !== 0) {
        throw new Error(
          `Userspace tailscaled did not start on "${input.target.host}": ${(started.stderr || started.stdout).trim().slice(-240)}`,
        );
      }
    }

    // 4. Resolve or mint single-use ephemeral key & join tailnet.
    const authKey =
      input.tailscaleAuth.mode === "oauth"
        ? (
            await mintTailscaleEphemeralAuthKey({
              oauthClientId: input.tailscaleAuth.oauthClientId,
              oauthClientSecret: input.tailscaleAuth.oauthClientSecret,
              tags: input.tailscaleAuth.tags,
              tailnet: input.tailscaleAuth.tailnet,
              description: `roder-${input.machineLabel}`,
              fetchImpl: this.options.fetchImpl,
            })
          ).key
        : input.tailscaleAuth.authKey;

    const up = await sshClient.execCommand(
      input.target,
      `sh -c ${shellQuotePosixTunnel(buildTailscaleUpScript(input.machineLabel, authKey, baseDir))}`,
      { timeoutMs: 30_000 },
    );
    if (up.exitCode !== 0) {
      throw new Error(
        `Could not join "${input.target.host}" to Tailscale: ${(up.stderr || up.stdout).trim().slice(-240)}`,
      );
    }
    const joined = parseRemoteTailscaleIdentity(up.stdout);
    if (!joined.running || !joined.tailscaleIp) {
      throw new Error(
        `Tailscale started on "${input.target.host}" but did not receive a tailnet IP (state: ${joined.backendState}).`,
      );
    }
    return { tailscaleIp: joined.tailscaleIp, dnsName: joined.dnsName };
  }

  private async bootstrapAndConnectSshTarget(
    key: string,
    input: {
      desktopWorkspaceId: string;
      desktopRootName: string;
      target: SshConnectionTarget;
      workingDir: string;
      mode: "tailscale-peer" | "ssh-machine";
      tailscaleAuth?: ResolvedTailscaleAuth | null;
      preferTailscale?: boolean;
      requireTailscale?: boolean;
    },
  ): Promise<ActiveRemoteTunnel> {
    const sshClient = this.options.sshClient;
    if (!sshClient) {
      throw new RemoteRoderUnsupportedRuntimeError("SSH client is not configured.");
    }
    const { target, workingDir, mode } = input;
    const port = target.remoteRoderPort || REMOTE_RODER_PORT;
    const shouldAttemptTailscaleInjection =
      mode === "ssh-machine" &&
      Boolean(input.tailscaleAuth) &&
      (input.preferTailscale !== false || Boolean(input.requireTailscale));

    // 0. Fast-path reconnect if we already bootstrapped remote-roder (for direct Tailscale connections).
    const cached = this.cachedEndpoints.get(key);
    if (cached && cached.transport === "tailscale" && (!input.requireTailscale || cached.transport === "tailscale")) {
      try {
        const fastConnection = new RemoteRoderTunnelConnection({
          wsUrl: cached.wsUrl,
          remoteToken: cached.remoteToken,
          createWebSocket: this.options.createWebSocket,
        });
        await fastConnection.connect();
        const { remoteWorkspaceId, remoteRootId } = await ensureRemoteServerWorkspace(
          fastConnection,
          workingDir,
          input.desktopRootName,
        );
        return this.registerActiveTunnel(key, {
          sandboxName: target.dnsName || target.host,
          workingDir,
          wsUrl: cached.wsUrl,
          transport: "tailscale",
          tailscaleIp: cached.tailscaleIp,
          tailscaleDnsName: cached.tailscaleDnsName,
          remoteToken: cached.remoteToken,
          remoteWorkspaceId,
          remoteRootId,
          connection: fastConnection,
          desktopWorkspaceId: input.desktopWorkspaceId,
        });
      } catch {
        this.cachedEndpoints.delete(key);
      }
    }

    // 1. Detect or install remote-roder / roder on the remote server.
    const installScript = buildPeerRemoteRoderInstallScript(workingDir, this.options.downloadBaseUrl);
    const installRes = await sshClient.execCommand(target, `sh -c ${shellQuotePosixTunnel(installScript)}`, {
      timeoutMs: 90_000,
    });
    const combined = `${installRes.stdout}\n${installRes.stderr}`;
    if (
      installRes.exitCode === 42 ||
      combined.includes("RODER_UNSUPPORTED_PEER_OS") ||
      combined.includes("RODER_UNSUPPORTED_MUSL")
    ) {
      const reason =
        mode === "ssh-machine"
          ? "Server does not have a compatible remote-roder binary installed; using direct SSH workspace bridge."
          : "Peer does not have a compatible remote-roder binary installed; using direct Tailscale SSH workspace bridge.";
      this.unsupportedKeys.set(key, reason);
      throw new RemoteRoderUnsupportedRuntimeError(reason);
    }
    if (installRes.exitCode !== 0) {
      throw new Error(`Could not prepare remote-roder on "${target.host}": ${combined.trim().slice(-240)}`);
    }
    const binMatch = /RODER_BIN:([^\r\n]+)/u.exec(installRes.stdout);
    const remoteBin = binMatch?.[1]?.trim() || "$HOME/.roder/bin/remote-roder";

    // 2. Reuse running remote-roder on port or launch detached in background.
    // For pure SSH machines without Tailscale, bind 127.0.0.1 so no public port is exposed!
    const bindAddr = mode === "tailscale-peer" || shouldAttemptTailscaleInjection ? "0.0.0.0" : "127.0.0.1";
    const probeScript = [
      'token_path="$HOME/.roder/bridge.token"',
      `if [ -r "$token_path" ] && (`,
      `  (command -v curl >/dev/null 2>&1 && curl -fsS http://127.0.0.1:${port}/readyz >/dev/null 2>&1) ||`,
      `  (command -v python3 >/dev/null 2>&1 && python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:${port}/readyz', timeout=2)" >/dev/null 2>&1)`,
      `); then`,
      `  printf 'REUSE:'`,
      `  cat "$token_path"`,
      `else`,
      `  echo 'NEED_START'`,
      `fi`,
    ].join("\n");
    const probe = await sshClient.execCommand(target, `sh -c ${shellQuotePosixTunnel(probeScript)}`, {
      timeoutMs: 15_000,
    });
    const probeOut = probe.stdout.trim();
    let remoteToken = "";
    if (probeOut.startsWith("REUSE:") && probeOut.slice("REUSE:".length).trim().length >= 16) {
      remoteToken = probeOut.slice("REUSE:".length).trim();
    } else {
      remoteToken = randomBytes(32).toString("base64url");
      const startScript = [
        "set -eu",
        "umask 077",
        'mkdir -p "$HOME/.roder"',
        `printf '%s' ${shellQuotePosixTunnel(remoteToken)} > "$HOME/.roder/bridge.token"`,
        `export RODER_REMOTE_APP_SERVER_TOKEN=${shellQuotePosixTunnel(remoteToken)}`,
        `nohup ${shellQuotePosixTunnel(remoteBin)} app-server --remote --listen ws://${bindAddr}:${port} --auth-token env:RODER_REMOTE_APP_SERVER_TOKEN --print-qr=false </dev/null >"$HOME/.roder/remote-roder.log" 2>&1 &`,
        "for i in $(seq 1 40); do",
        `  if (command -v curl >/dev/null 2>&1 && curl -fsS http://127.0.0.1:${port}/readyz >/dev/null 2>&1) ||`,
        `     (command -v python3 >/dev/null 2>&1 && python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:${port}/readyz', timeout=2)" >/dev/null 2>&1); then`,
        '    echo "READY"',
        "    exit 0",
        "  fi",
        "  sleep 0.25",
        "done",
        'echo "remote-roder did not become ready" >&2',
        "exit 1",
      ].join("\n");
      const started = await sshClient.execCommand(target, `sh -c ${shellQuotePosixTunnel(startScript)}`, {
        timeoutMs: 25_000,
      });
      if (started.exitCode !== 0) {
        throw new Error(
          `Remote Roder app-server did not start on "${target.host}:${port}": ${(started.stderr || started.stdout).trim().slice(-240)}`,
        );
      }
    }

    // 3a. Tailscale peer OR SSH machine with injected Tailscale tunnel: connect directly over WireGuard!
    if (mode === "tailscale-peer") {
      const wsUrl = `ws://${target.tailscaleIp || target.host}:${port}`;
      const connection = new RemoteRoderTunnelConnection({
        wsUrl,
        remoteToken,
        createWebSocket: this.options.createWebSocket,
      });
      await connection.connect();
      const { remoteWorkspaceId, remoteRootId } = await ensureRemoteServerWorkspace(
        connection,
        workingDir,
        input.desktopRootName,
      );
      return this.registerActiveTunnel(key, {
        sandboxName: target.dnsName || target.host,
        workingDir,
        wsUrl,
        transport: "tailscale",
        tailscaleIp: target.tailscaleIp || target.host,
        tailscaleDnsName: target.dnsName,
        remoteToken,
        remoteWorkspaceId,
        remoteRootId,
        connection,
        desktopWorkspaceId: input.desktopWorkspaceId,
      });
    }

    if (shouldAttemptTailscaleInjection && input.tailscaleAuth) {
      try {
        const tsIdentity = await this.bootstrapTailscaleOverSsh({
          target,
          machineLabel: input.desktopRootName || target.host,
          tailscaleAuth: input.tailscaleAuth,
        });
        const tsWsUrl = `ws://${tsIdentity.tailscaleIp}:${port}`;
        const tsConnection = new RemoteRoderTunnelConnection({
          wsUrl: tsWsUrl,
          remoteToken,
          createWebSocket: this.options.createWebSocket,
        });
        await tsConnection.connect();
        this.tailscaleErrors.delete(key);
        const { remoteWorkspaceId, remoteRootId } = await ensureRemoteServerWorkspace(
          tsConnection,
          workingDir,
          input.desktopRootName,
        );
        return this.registerActiveTunnel(key, {
          sandboxName: target.host,
          workingDir,
          wsUrl: tsWsUrl,
          transport: "tailscale",
          tailscaleIp: tsIdentity.tailscaleIp,
          tailscaleDnsName: tsIdentity.dnsName ?? undefined,
          remoteToken,
          remoteWorkspaceId,
          remoteRootId,
          connection: tsConnection,
          desktopWorkspaceId: input.desktopWorkspaceId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.tailscaleErrors.set(key, message);
        if (input.requireTailscale) {
          throw error;
        }
        console.warn(`[roder-tailscale-tunnel] Falling back to SSH port-forward for "${target.host}": ${message}`);
      }
    }

    // 3b. Pure SSH machine: open encrypted local SSH port-forward to 127.0.0.1:<port> on the server!
    let forward: ActiveSshPortForward | null = null;
    try {
      forward = await sshClient.openLocalForward(target, port);
      const wsUrl = `ws://127.0.0.1:${forward.localPort}`;
      const connection = new RemoteRoderTunnelConnection({
        wsUrl,
        remoteToken,
        createWebSocket: this.options.createWebSocket,
      });
      await connection.connect();
      const { remoteWorkspaceId, remoteRootId } = await ensureRemoteServerWorkspace(
        connection,
        workingDir,
        input.desktopRootName,
      );
      const activeForward = forward;
      connection.once("close", () => {
        activeForward.close();
      });
      return this.registerActiveTunnel(key, {
        sandboxName: target.host,
        workingDir,
        wsUrl,
        transport: "ssh-forward",
        remoteToken,
        remoteWorkspaceId,
        remoteRootId,
        connection,
        desktopWorkspaceId: input.desktopWorkspaceId,
      });
    } catch (error) {
      forward?.close();
      throw error;
    }
  }

  private registerActiveTunnel(
    key: string,
    params: {
      sandboxName: string;
      workingDir: string;
      wsUrl: string;
      transport: RemoteTunnelTransport;
      tailscaleIp?: string;
      tailscaleDnsName?: string;
      remoteToken: string;
      remoteWorkspaceId: string;
      remoteRootId: string;
      connection: RemoteRoderTunnelConnection;
      desktopWorkspaceId: string;
    },
  ): ActiveRemoteTunnel {
    this.cachedEndpoints.set(key, {
      wsUrl: params.wsUrl,
      remoteToken: params.remoteToken,
      transport: params.transport,
      tailscaleIp: params.tailscaleIp,
      tailscaleDnsName: params.tailscaleDnsName,
    });
    const activeTunnel: ActiveRemoteTunnel = {
      key,
      sandboxName: params.sandboxName,
      workingDir: params.workingDir,
      wsUrl: params.wsUrl,
      transport: params.transport,
      tailscaleIp: params.tailscaleIp,
      tailscaleDnsName: params.tailscaleDnsName,
      remoteWorkspaceId: params.remoteWorkspaceId,
      remoteRootId: params.remoteRootId,
      connection: params.connection,
      desktopWorkspaceIds: new Set([params.desktopWorkspaceId]),
    };

    params.connection.on("notification", (notification: RemoteTunnelNotification) => {
      for (const desktopWorkspaceId of activeTunnel.desktopWorkspaceIds) {
        this.emit("notification", {
          desktopWorkspaceId,
          notification: rewriteNotificationToDesktop(notification, {
            remoteWorkspaceId: params.remoteWorkspaceId,
            remoteRootId: params.remoteRootId,
            desktopWorkspaceId,
          }),
        });
      }
    });
    params.connection.on("close", () => {
      if (this.tunnels.get(key) === activeTunnel) {
        this.tunnels.delete(key);
      }
    });

    this.tunnels.set(key, activeTunnel);
    return activeTunnel;
  }
}

export function tunnelKey(
  providerId: string,
  providerWorkspace: string,
  targetName: string,
  workingDir: string,
): string {
  return `${providerId}:${providerWorkspace}:${targetName}:${workingDir}`;
}

async function ensureRemoteServerWorkspace(
  connection: RemoteRoderTunnelConnection,
  workingDir: string,
  name: string,
): Promise<{ remoteWorkspaceId: string; remoteRootId: string }> {
  const normalizedTarget = workingDir.replace(/\/+$/u, "") || "/";
  const listed = (await connection.request("workspace/list", {})) as {
    workspaces?: Array<{ id: string; defaultRootId?: string; roots?: Array<{ id: string; path: string }> }>;
  };
  for (const ws of listed.workspaces ?? []) {
    const matchingRoot = (ws.roots ?? []).find((root) => (root.path.replace(/\/+$/u, "") || "/") === normalizedTarget);
    if (matchingRoot) {
      return { remoteWorkspaceId: ws.id, remoteRootId: matchingRoot.id };
    }
  }
  const created = (await connection.request("workspace/create", {
    name,
    roots: [{ path: workingDir, name }],
  })) as {
    workspace?: { id: string; defaultRootId?: string; roots?: Array<{ id: string; path: string }> };
  };
  const ws = created.workspace;
  const rootId = ws?.defaultRootId || ws?.roots?.[0]?.id;
  if (!ws?.id || !rootId) {
    throw new Error(`Remote Roder app-server did not create workspace for ${workingDir}.`);
  }
  return { remoteWorkspaceId: ws.id, remoteRootId: rootId };
}

export function rewriteNotificationToDesktop(
  notification: RemoteTunnelNotification,
  ids: { remoteWorkspaceId: string; remoteRootId: string; desktopWorkspaceId: string },
): RemoteTunnelNotification {
  if (
    notification.method === "workspace/files/statusChanged" &&
    notification.params &&
    typeof notification.params === "object"
  ) {
    const params = notification.params as Record<string, unknown>;
    const status = params.status;
    if (status && typeof status === "object") {
      const statusRecord = status as Record<string, unknown>;
      if (statusRecord.workspaceId === ids.remoteWorkspaceId) {
        return {
          method: notification.method,
          params: {
            ...params,
            status: rewriteRemoteFilesStatus(statusRecord, ids.desktopWorkspaceId),
          },
        };
      }
    }
  }
  return notification;
}

export function rewriteRemoteFilesStatus(
  status: Record<string, unknown>,
  desktopWorkspaceId: string,
  desktopRootId = "remote-root",
  desktopRootName?: string,
): Record<string, unknown> {
  const roots = Array.isArray(status.roots)
    ? status.roots.map((root) => {
        if (!root || typeof root !== "object") return root;
        const r = root as Record<string, unknown>;
        return {
          ...r,
          ...(r.rootId !== undefined ? { rootId: desktopRootId } : {}),
          ...(r.id !== undefined ? { id: desktopRootId } : {}),
          ...(desktopRootName ? { name: desktopRootName, rootName: desktopRootName } : {}),
        };
      })
    : status.roots;
  return {
    ...status,
    workspaceId: desktopWorkspaceId,
    ...(roots !== undefined ? { roots } : {}),
  };
}

export function rewriteRemoteFileEntry(
  entry: Record<string, unknown>,
  desktopRootId = "remote-root",
  desktopRootName?: string,
): Record<string, unknown> {
  return {
    ...entry,
    rootId: desktopRootId,
    ...(desktopRootName ? { rootName: desktopRootName } : {}),
  };
}

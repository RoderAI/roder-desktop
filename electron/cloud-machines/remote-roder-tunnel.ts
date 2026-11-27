import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import type { BlaxelClient } from "./blaxel-client";
import type { BlaxelAuth } from "./credentials";

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
        version: this.options.clientVersion ?? "0.1.13",
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

export type ActiveRemoteTunnel = {
  key: string;
  sandboxName: string;
  workingDir: string;
  wsUrl: string;
  remoteWorkspaceId: string;
  remoteRootId: string;
  connection: RemoteRoderTunnelConnection;
  desktopWorkspaceIds: Set<string>;
};

export type RemoteRoderTunnelManagerOptions = {
  blaxelClient: BlaxelClient;
  createWebSocket?: RemoteWebSocketFactory;
  downloadBaseUrl?: string;
  fetchImpl?: typeof fetch;
};

export class RemoteRoderTunnelManager extends EventEmitter {
  private readonly tunnels = new Map<string, ActiveRemoteTunnel>();
  private readonly connecting = new Map<string, Promise<ActiveRemoteTunnel>>();
  private readonly unsupportedKeys = new Map<string, string>();
  private readonly cachedEndpoints = new Map<string, { wsUrl: string; remoteToken: string }>();

  constructor(private readonly options: RemoteRoderTunnelManagerOptions) {
    super();
  }

  isUnsupported(key: string): string | null {
    return this.unsupportedKeys.get(key) ?? null;
  }

  getActiveTunnel(key: string): ActiveRemoteTunnel | null {
    const tunnel = this.tunnels.get(key);
    return tunnel && tunnel.connection.isOpen() ? tunnel : null;
  }

  closeAll(): void {
    for (const tunnel of this.tunnels.values()) {
      tunnel.connection.close();
    }
    this.tunnels.clear();
    this.unsupportedKeys.clear();
    this.cachedEndpoints.clear();
  }

  async ensureBlaxelTunnel(input: {
    desktopWorkspaceId: string;
    desktopRootName: string;
    auth: BlaxelAuth;
    sandboxName: string;
    sandboxUrl: string;
    workingDir: string;
  }): Promise<ActiveRemoteTunnel> {
    const key = tunnelKey("blaxel", input.auth.workspace, input.sandboxName, input.workingDir);
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

    const connectPromise = this.bootstrapAndConnectBlaxel(key, input).finally(() => {
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
    },
  ): Promise<ActiveRemoteTunnel> {
    const { blaxelClient } = this.options;
    const { auth, sandboxName, sandboxUrl, workingDir } = input;

    // 0. Fast-path reconnect if we already bootstrapped this sandbox's private preview & token.
    const cachedEndpoint = this.cachedEndpoints.get(key);
    if (cachedEndpoint) {
      try {
        const fastConnection = new RemoteRoderTunnelConnection({
          wsUrl: cachedEndpoint.wsUrl,
          remoteToken: cachedEndpoint.remoteToken,
          extraHeaders: {
            "X-Blaxel-Authorization": `Bearer ${auth.apiKey}`,
            ...(auth.workspace ? { "X-Blaxel-Workspace": auth.workspace } : {}),
          },
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

    // 4. Create/reuse private Blaxel TLS preview tunnel on port 17373!
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
      remoteToken,
      remoteWorkspaceId,
      remoteRootId,
      connection,
      desktopWorkspaceId: input.desktopWorkspaceId,
    });
  }

  private registerActiveTunnel(
    key: string,
    params: {
      sandboxName: string;
      workingDir: string;
      wsUrl: string;
      remoteToken: string;
      remoteWorkspaceId: string;
      remoteRootId: string;
      connection: RemoteRoderTunnelConnection;
      desktopWorkspaceId: string;
    },
  ): ActiveRemoteTunnel {
    this.cachedEndpoints.set(key, { wsUrl: params.wsUrl, remoteToken: params.remoteToken });
    const activeTunnel: ActiveRemoteTunnel = {
      key,
      sandboxName: params.sandboxName,
      workingDir: params.workingDir,
      wsUrl: params.wsUrl,
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

import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { parseSshMachineConfig, type SshMachineTargetConfig } from "./ssh-config";
import { parseTailscalePeerConfig } from "./tailscale";
import { shellQuotePosixSsh, TailscaleSshClient } from "./tailscale-ssh";

export const DEFAULT_TAILSCALE_GATEWAY_PORT = 17379;

const HOSTED_GATEWAY_CANDIDATES = [
  { providerId: "runloop", tokenEnv: "RUNLOOP_API_KEY", baseUrlEnv: "RUNLOOP_RUNNER_BASE_URL" },
  { providerId: "daytona", tokenEnv: "DAYTONA_API_KEY", baseUrlEnv: "DAYTONA_RUNNER_BASE_URL" },
  { providerId: "e2b", tokenEnv: "E2B_API_KEY", baseUrlEnv: "E2B_RUNNER_BASE_URL" },
  { providerId: "modal", tokenEnv: "MODAL_TOKEN_SECRET", baseUrlEnv: "MODAL_RUNNER_BASE_URL" },
  { providerId: "vercel", tokenEnv: "VERCEL_TOKEN", baseUrlEnv: "VERCEL_RUNNER_BASE_URL" },
  { providerId: "cloudflare", tokenEnv: "CLOUDFLARE_API_TOKEN", baseUrlEnv: "CLOUDFLARE_RUNNER_BASE_URL" },
] as const;

export type BackingGatewaySpec = (typeof HOSTED_GATEWAY_CANDIDATES)[number];

export type TailscaleRunnerGatewayOptions = {
  sshClient?: TailscaleSshClient;
  preferredPort?: number;
  authToken?: string;
};

type GatewaySession = {
  id: string;
  transport: "tailscale" | "ssh";
  peer: SshMachineTargetConfig;
};

const envVarKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export function selectBackingGatewayProvider(
  existingEnv: Record<string, string | undefined>,
  installedProviderIds?: readonly string[],
): BackingGatewaySpec {
  const installedSet = installedProviderIds ? new Set(installedProviderIds) : null;
  for (const candidate of HOSTED_GATEWAY_CANDIDATES) {
    if (installedSet && !installedSet.has(candidate.providerId)) continue;
    if (!existingEnv[candidate.tokenEnv]?.trim()) {
      return candidate;
    }
  }
  if (installedSet) {
    const installedFallback = HOSTED_GATEWAY_CANDIDATES.find((candidate) => installedSet.has(candidate.providerId));
    if (installedFallback) return installedFallback;
  }
  return HOSTED_GATEWAY_CANDIDATES[0];
}

export function encodeTailscaleSessionId(
  peer: SshMachineTargetConfig,
  transport: "tailscale" | "ssh" = "tailscale",
): string {
  const payload = Buffer.from(JSON.stringify({ ...peer, transport }), "utf8").toString("base64url");
  return `${transport === "ssh" ? "ssh_" : "ts_"}${payload}`;
}

export function decodeTailscaleSessionId(sessionId: string): SshMachineTargetConfig | null {
  const isSsh = sessionId.startsWith("ssh_");
  const isTs = sessionId.startsWith("ts_");
  if (!isSsh && !isTs) return null;
  try {
    const prefixLen = isSsh ? 4 : 3;
    const raw = Buffer.from(sessionId.slice(prefixLen), "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (isSsh || parsed.transport === "ssh") {
      return parseSshMachineConfig({
        ssh_host: parsed.host,
        tailscale_host: parsed.dnsName,
        tailscale_ip: parsed.tailscaleIp,
        ssh_user: parsed.sshUser,
        ssh_port: parsed.sshPort,
        identity_file: parsed.identityFile,
        proxy_jump: parsed.proxyJump,
        remote_roder_port: parsed.remoteRoderPort,
      });
    }
    return parseTailscalePeerConfig({
      tailscale_host: parsed.dnsName ?? parsed.host,
      tailscale_ip: parsed.tailscaleIp,
      ssh_user: parsed.sshUser,
      ssh_port: parsed.sshPort,
      remote_roder_port: parsed.remoteRoderPort,
    });
  } catch {
    return null;
  }
}

export function buildRemoteShellExecCommand(request: {
  program: string;
  args?: string[];
  cwd?: string | null;
  env?: Array<[string, string]>;
}): string {
  const parts: string[] = [];
  if (request.cwd && typeof request.cwd === "string" && request.cwd.trim()) {
    parts.push(`cd -- ${shellQuotePosixSsh(request.cwd.trim())}`);
  }
  if (Array.isArray(request.env)) {
    for (const entry of request.env) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const [key, value] = entry;
      if (typeof key !== "string" || typeof value !== "string") continue;
      if (!envVarKeyPattern.test(key)) continue;
      parts.push(`export ${key}=${shellQuotePosixSsh(value)}`);
    }
  }
  const argv = [request.program, ...(Array.isArray(request.args) ? request.args : [])]
    .map((arg) => shellQuotePosixSsh(String(arg)))
    .join(" ");
  parts.push(`exec ${argv}`);
  return `sh -c ${shellQuotePosixSsh(parts.join(" && "))}`;
}

export class TailscaleRunnerGateway {
  private readonly sshClient: TailscaleSshClient;
  private readonly ownsSshClient: boolean;
  private readonly preferredPort: number;
  private readonly authToken: string;
  private readonly sessions = new Map<string, GatewaySession>();
  private server: Server | null = null;
  private listeningPort: number | null = null;
  private backingSpec: BackingGatewaySpec = HOSTED_GATEWAY_CANDIDATES[0];

  constructor(options: TailscaleRunnerGatewayOptions = {}) {
    this.ownsSshClient = !options.sshClient;
    this.sshClient = options.sshClient ?? new TailscaleSshClient();
    this.preferredPort = options.preferredPort ?? DEFAULT_TAILSCALE_GATEWAY_PORT;
    this.authToken = options.authToken ?? randomBytes(32).toString("base64url");
  }

  get baseUrl(): string | null {
    return this.listeningPort ? `http://127.0.0.1:${this.listeningPort}` : null;
  }

  get token(): string {
    return this.authToken;
  }

  get backingProviderId(): string {
    return this.backingSpec.providerId;
  }

  getRunnerEnv(
    existingEnv: Record<string, string | undefined> = process.env,
    installedProviderIds?: readonly string[],
  ): Record<string, string> {
    if (!this.listeningPort) return {};
    this.backingSpec = selectBackingGatewayProvider(existingEnv, installedProviderIds);
    // Never overwrite a real user-configured key for the backing provider.
    if (existingEnv[this.backingSpec.tokenEnv]?.trim()) {
      return {};
    }
    return {
      [this.backingSpec.tokenEnv]: this.authToken,
      [this.backingSpec.baseUrlEnv]: `http://127.0.0.1:${this.listeningPort}`,
    };
  }

  async start(): Promise<{ baseUrl: string; port: number }> {
    if (this.server && this.listeningPort) {
      return { baseUrl: `http://127.0.0.1:${this.listeningPort}`, port: this.listeningPort };
    }
    const server = createServer((req, res) => {
      void this.handleRequest(req, res).catch((error) => {
        if (!res.headersSent) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      });
    });

    const port = await listenLoopback(server, this.preferredPort);
    this.server = server;
    this.listeningPort = port;
    return { baseUrl: `http://127.0.0.1:${port}`, port };
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.listeningPort = null;
    this.sessions.clear();
    if (this.ownsSshClient) {
      this.sshClient.closeAll();
    }
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private isAuthorized(req: IncomingMessage): boolean {
    const authHeader = req.headers.authorization;
    if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) return false;
    const supplied = Buffer.from(authHeader.slice("Bearer ".length).trim(), "utf8");
    const expected = Buffer.from(this.authToken, "utf8");
    if (supplied.length !== expected.length) return false;
    return timingSafeEqual(supplied, expected);
  }

  private resolveSession(sessionId: string): GatewaySession | null {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const decoded = decodeTailscaleSessionId(sessionId);
    if (!decoded) return null;
    const transport: "tailscale" | "ssh" = sessionId.startsWith("ssh_") ? "ssh" : "tailscale";
    const restored: GatewaySession = { id: sessionId, transport, peer: decoded };
    this.sessions.set(sessionId, restored);
    return restored;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.isAuthorized(req)) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    const method = (req.method ?? "GET").toUpperCase();
    const parsedUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = parsedUrl.pathname.replace(/\/+$/u, "") || "/";

    // POST /sessions — create a runner session bound to a Tailscale or SSH remote machine
    if (method === "POST" && pathname === "/sessions") {
      const body = await readJsonBody(req);
      const config =
        body.config && typeof body.config === "object" && !Array.isArray(body.config)
          ? (body.config as Record<string, unknown>)
          : {};
      const transport: "tailscale" | "ssh" = config.roder_transport === "ssh" ? "ssh" : "tailscale";
      const peer = transport === "ssh" ? parseSshMachineConfig(config) : parseTailscalePeerConfig(config);
      const check = await this.sshClient.execCommand(peer, "printf RODER_TS_OK", { timeoutMs: 15_000 });
      if (check.exitCode !== 0 || !check.stdout.includes("RODER_TS_OK")) {
        sendJson(res, 502, {
          error:
            check.stderr.trim() ||
            (transport === "ssh"
              ? `Could not connect to SSH machine "${peer.host}". Check hostname, username, port, and SSH key permissions.`
              : `Could not reach Tailscale machine "${peer.host}" over SSH. Enable Tailscale SSH or configure SSH keys.`),
        });
        return;
      }
      const sessionId = encodeTailscaleSessionId(peer, transport);
      this.sessions.set(sessionId, { id: sessionId, transport, peer });
      sendJson(res, 200, { session_id: sessionId });
      return;
    }

    const sessionMatch = /^\/sessions\/([^/]+)(?:\/(.*))?$/u.exec(pathname);
    if (!sessionMatch) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    const sessionId = decodeURIComponent(sessionMatch[1]);
    const subPath = sessionMatch[2] ?? "";
    const session = this.resolveSession(sessionId);
    if (!session) {
      sendJson(res, 404, { error: "Session not found" });
      return;
    }

    // GET /sessions/:id — resume / health check
    if (method === "GET" && subPath === "") {
      const check = await this.sshClient.execCommand(session.peer, "printf RODER_TS_OK", { timeoutMs: 15_000 });
      if (check.exitCode !== 0) {
        sendJson(res, 502, { error: check.stderr.trim() || `Tailscale peer "${session.peer.host}" is unreachable.` });
        return;
      }
      sendJson(res, 200, { session_id: session.id, status: "ready" });
      return;
    }

    // DELETE /sessions/:id — close session
    if (method === "DELETE" && subPath === "") {
      this.sessions.delete(sessionId);
      res.writeHead(204);
      res.end();
      return;
    }

    // POST /sessions/:id/commands — execute command on Tailscale peer
    if (method === "POST" && subPath === "commands") {
      const body = await readJsonBody(req);
      const commandId = typeof body.command_id === "string" && body.command_id ? body.command_id : "cmd";
      const program = typeof body.program === "string" ? body.program : "";
      if (!program) {
        sendJson(res, 400, { error: "program is required" });
        return;
      }
      const args = Array.isArray(body.args) ? body.args.map((entry) => String(entry)) : [];
      const cwd = typeof body.cwd === "string" ? body.cwd : null;
      const env = Array.isArray(body.env) ? (body.env as Array<[string, string]>) : [];
      const timeoutMs =
        typeof body.timeout_ms === "number" && Number.isFinite(body.timeout_ms) && body.timeout_ms > 0
          ? body.timeout_ms
          : 120_000;
      const remoteCommand = buildRemoteShellExecCommand({ program, args, cwd, env });
      const result = await this.sshClient.execCommand(session.peer, remoteCommand, {
        timeoutMs,
        commandId,
      });
      sendJson(res, 200, {
        command_id: commandId,
        exit_code: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      });
      return;
    }

    // DELETE /sessions/:id/commands/:commandId — cancel running command
    if (method === "DELETE" && subPath.startsWith("commands/")) {
      const commandId = decodeURIComponent(subPath.slice("commands/".length));
      const cancelled = this.sshClient.cancelCommand(commandId);
      sendJson(res, 200, { cancelled });
      return;
    }

    // GET /sessions/:id/files?path=... — read raw file bytes
    if (method === "GET" && subPath === "files") {
      const filePath = parsedUrl.searchParams.get("path") ?? "";
      if (!filePath || filePath.includes("\0")) {
        sendJson(res, 400, { error: "Invalid file path" });
        return;
      }
      try {
        const bytes = await this.sshClient.readFile(session.peer, filePath);
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(bytes.length),
        });
        res.end(bytes);
      } catch (error) {
        sendJson(res, 404, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    // PUT /sessions/:id/files?path=... — write raw file bytes
    if (method === "PUT" && subPath === "files") {
      const filePath = parsedUrl.searchParams.get("path") ?? "";
      if (!filePath || filePath.includes("\0")) {
        sendJson(res, 400, { error: "Invalid file path" });
        return;
      }
      const bytes = await readRawBody(req);
      await this.sshClient.writeFile(session.peer, filePath, bytes);
      res.writeHead(204);
      res.end();
      return;
    }

    // POST /sessions/:id/ports — return private Tailscale URL or open SSH local port forward
    if (method === "POST" && subPath === "ports") {
      const body = await readJsonBody(req);
      const port = typeof body.port === "number" ? body.port : Number.parseInt(String(body.port ?? ""), 10);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        sendJson(res, 400, { error: "Invalid port" });
        return;
      }
      if (session.transport === "ssh" && !session.peer.tailscaleIp) {
        const forward = await this.sshClient.openLocalForward(session.peer, port);
        sendJson(res, 200, { port, url: `http://127.0.0.1:${forward.localPort}` });
        return;
      }
      const host = session.peer.tailscaleIp || session.peer.dnsName || session.peer.host;
      sendJson(res, 200, { port, url: `http://${host}:${port}` });
      return;
    }

    // POST /sessions/:id/artifacts
    if (method === "POST" && subPath === "artifacts") {
      const body = await readJsonBody(req);
      sendJson(res, 200, {
        path: typeof body.path === "string" ? body.path : "",
        artifact_id: `ts-artifact-${Date.now()}`,
        url: null,
        metadata: {},
      });
      return;
    }

    // POST /sessions/:id/snapshots
    if (method === "POST" && subPath === "snapshots") {
      sendJson(res, 200, { snapshot: null });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  }
}

async function listenLoopback(server: Server, preferredPort: number): Promise<number> {
  try {
    return await bindOnce(server, preferredPort);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (preferredPort !== 0 && (code === "EADDRINUSE" || code === "EACCES")) {
      return bindOnce(server, 0);
    }
    throw error;
  }
}

function bindOnce(server: Server, port: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const addr = server.address() as AddressInfo | null;
      if (!addr) {
        reject(new Error("Tailscale runner gateway failed to bind."));
        return;
      }
      resolve(addr.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(body)),
  });
  res.end(body);
}

async function readRawBody(req: IncomingMessage, maxBytes = 64 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error("Request body exceeds size limit");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readRawBody(req, 4 * 1024 * 1024);
  if (raw.length === 0) return {};
  const parsed = JSON.parse(raw.toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected JSON object body");
  }
  return parsed as Record<string, unknown>;
}

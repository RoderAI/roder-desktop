import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const BOAT_OAUTH_CLIENT_ID = "boatapp_9Woeb3IHNmOx7NjetvWReTmi";
export const BOAT_OAUTH_PREFERRED_PORT = 1338;
export const BOAT_OAUTH_AUTHORIZE_URL = "https://boat.dev/api/boat/oauth2/authorize";
export const BOAT_OAUTH_TOKEN_URL = "https://boat.dev/api/boat/oauth2/token";
export const BOAT_OAUTH_REVOKE_URL = "https://boat.dev/api/boat/oauth2/revoke";
export const BOAT_API_BASE = "https://boat.dev/api/v1";

export const BOAT_OAUTH_SCOPES = [
  "account.read",
  "sandbox.read",
  "sandbox.create",
  "sandbox.update",
  "sandbox.stop",
  "sandbox.resume",
  "exec",
  "file.read",
  "file.write",
  "ssh",
  "desktop",
  "host",
] as const;

const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

export type BoatOAuthTokenResponse = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  expiresAt: number;
  scope: string;
  tokenType: string;
};

export type BoatOAuthUserProfile = {
  id: string | null;
  login: string | null;
  displayName: string | null;
  email: string | null;
};

export type BoatOAuthPhase = "idle" | "awaiting-browser" | "exchanging" | "completed" | "error";

export type BoatOAuthState = {
  phase: BoatOAuthPhase;
  message: string;
  authUrl: string | null;
  error: string | null;
};

const IDLE_STATE: BoatOAuthState = {
  phase: "idle",
  message: "",
  authUrl: null,
  error: null,
};

export function createPkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

export function buildBoatAuthorizeUrl(params: {
  clientId?: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: readonly string[];
  authorizeUrl?: string;
}): string {
  const url = new URL(params.authorizeUrl ?? BOAT_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId ?? BOAT_OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", (params.scopes ?? BOAT_OAUTH_SCOPES).join(" "));
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeBoatAuthorizationCode(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId?: string;
  tokenUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<BoatOAuthTokenResponse> {
  const fetchImpl = params.fetchImpl ?? globalThis.fetch;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
    client_id: params.clientId ?? BOAT_OAUTH_CLIENT_ID,
  });
  const response = await fetchImpl(params.tokenUrl ?? BOAT_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  return parseTokenResponse(response, "Boat OAuth token exchange failed");
}

export async function refreshBoatAccessToken(params: {
  refreshToken: string;
  clientId?: string;
  tokenUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<BoatOAuthTokenResponse> {
  const fetchImpl = params.fetchImpl ?? globalThis.fetch;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: params.clientId ?? BOAT_OAUTH_CLIENT_ID,
  });
  const response = await fetchImpl(params.tokenUrl ?? BOAT_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  return parseTokenResponse(response, "Boat OAuth token refresh failed");
}

export async function revokeBoatToken(params: {
  token: string;
  revokeUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = params.fetchImpl ?? globalThis.fetch;
  const body = new URLSearchParams({ token: params.token });
  await fetchImpl(params.revokeUrl ?? BOAT_OAUTH_REVOKE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  }).catch(() => undefined);
}

export async function fetchBoatUserProfile(params: {
  accessToken: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}): Promise<BoatOAuthUserProfile> {
  const fetchImpl = params.fetchImpl ?? globalThis.fetch;
  const base = (params.apiBase ?? BOAT_API_BASE).replace(/\/+$/u, "");
  const response = await fetchImpl(`${base}/me`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(await formatBoatError("Could not verify Boat account", response));
  }
  const parsed = (await response.json()) as { user?: Record<string, unknown> };
  const user = parsed?.user && typeof parsed.user === "object" ? parsed.user : {};
  return {
    id: typeof user.id === "string" && user.id.trim() ? user.id.trim() : null,
    login: typeof user.login === "string" && user.login.trim() ? user.login.trim() : null,
    displayName: typeof user.displayName === "string" && user.displayName.trim() ? user.displayName.trim() : null,
    email: typeof user.email === "string" && user.email.trim() ? user.email.trim() : null,
  };
}

export type BoatOAuthControllerOptions = {
  openExternal: (url: string) => Promise<void>;
  onAuthenticated: (result: { tokens: BoatOAuthTokenResponse; user: BoatOAuthUserProfile }) => Promise<void>;
  onStateChanged?: (state: BoatOAuthState) => void;
  clientId?: string;
  preferredPort?: number;
  authorizeUrl?: string;
  tokenUrl?: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
};

export class BoatOAuthController {
  private state: BoatOAuthState = IDLE_STATE;
  private server: Server | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;

  constructor(private readonly options: BoatOAuthControllerOptions) {}

  getState(): BoatOAuthState {
    return this.state;
  }

  async start(): Promise<BoatOAuthState> {
    await this.cancelInternal(false);
    const generation = ++this.generation;
    const expectedState = randomBytes(24).toString("base64url");
    const { codeVerifier, codeChallenge } = createPkcePair();
    let handledCallback = false;

    const server = createServer((req, res) => {
      void this.handleCallbackRequest(req, res, {
        generation,
        expectedState,
        codeVerifier,
        redirectUri,
        wasHandled: () => handledCallback,
        markHandled: () => {
          handledCallback = true;
        },
      });
    });

    const port = await listenLoopbackPort(server, this.options.preferredPort ?? BOAT_OAUTH_PREFERRED_PORT);
    const redirectUri = `http://localhost:${port}/`;

    if (this.generation !== generation) {
      await closeServer(server);
      return this.state;
    }

    this.server = server;
    const authUrl = buildBoatAuthorizeUrl({
      clientId: this.options.clientId,
      redirectUri,
      state: expectedState,
      codeChallenge,
      authorizeUrl: this.options.authorizeUrl,
    });

    this.timer = setTimeout(() => {
      if (this.generation !== generation) return;
      void this.closeActiveServer();
      const message = "Boat sign-in timed out. Try signing in again.";
      this.setState({
        phase: "error",
        message,
        authUrl: null,
        error: message,
      });
    }, OAUTH_TIMEOUT_MS);

    this.setState({
      phase: "awaiting-browser",
      message: "Finish signing in with Boat in your browser. Roder connects automatically once approved.",
      authUrl,
      error: null,
    });

    try {
      await this.options.openExternal(authUrl);
    } catch (error) {
      if (this.generation !== generation) return this.state;
      await this.closeActiveServer();
      const message = error instanceof Error ? error.message : "Could not open browser for Boat sign-in.";
      this.setState({
        phase: "error",
        message,
        authUrl,
        error: message,
      });
    }

    return this.state;
  }

  async cancel(): Promise<BoatOAuthState> {
    await this.cancelInternal(true);
    return this.state;
  }

  stop(): void {
    void this.cancelInternal(false);
  }

  private async handleCallbackRequest(
    req: IncomingMessage,
    res: ServerResponse,
    ctx: {
      generation: number;
      expectedState: string;
      codeVerifier: string;
      redirectUri: string;
      wasHandled: () => boolean;
      markHandled: () => void;
    },
  ): Promise<void> {
    const parsedUrl = new URL(req.url ?? "/", ctx.redirectUri);
    if (parsedUrl.pathname !== "/" && parsedUrl.pathname !== "/callback") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    if (ctx.wasHandled() || this.generation !== ctx.generation) {
      sendHtml(res, 200, "Already handled", "You can close this tab and return to Roder Desktop.");
      return;
    }

    const errorParam = parsedUrl.searchParams.get("error");
    const errorDescription = parsedUrl.searchParams.get("error_description");
    const returnedState = parsedUrl.searchParams.get("state") ?? "";
    const code = parsedUrl.searchParams.get("code") ?? "";

    if (!constantTimeEquals(returnedState, ctx.expectedState)) {
      sendHtml(
        res,
        400,
        "Sign-in could not be verified",
        "The OAuth state did not match. Try signing in again from Roder Desktop.",
      );
      return;
    }

    ctx.markHandled();

    if (errorParam) {
      const message =
        errorParam === "access_denied"
          ? "Boat sign-in was cancelled."
          : errorDescription?.trim() || `Boat sign-in failed (${errorParam}).`;
      sendHtml(res, 200, "Boat sign-in cancelled", `${message} You can close this tab and return to Roder Desktop.`);
      void this.closeActiveServer();
      if (this.generation === ctx.generation) {
        this.setState({
          phase: errorParam === "access_denied" ? "idle" : "error",
          message: errorParam === "access_denied" ? "" : message,
          authUrl: null,
          error: errorParam === "access_denied" ? null : message,
        });
      }
      return;
    }

    if (!code) {
      const message = "Boat did not return an authorization code. Try signing in again.";
      sendHtml(res, 400, "Sign-in incomplete", message);
      void this.closeActiveServer();
      if (this.generation === ctx.generation) {
        this.setState({ phase: "error", message, authUrl: null, error: message });
      }
      return;
    }

    sendHtml(res, 200, "Signed in to Boat", "Roder Desktop is finishing setup. You can close this tab now.");
    void this.closeActiveServer();

    if (this.generation !== ctx.generation) return;
    this.setState({
      phase: "exchanging",
      message: "Completing Boat sign-in…",
      authUrl: null,
      error: null,
    });

    try {
      const tokens = await exchangeBoatAuthorizationCode({
        code,
        codeVerifier: ctx.codeVerifier,
        redirectUri: ctx.redirectUri,
        clientId: this.options.clientId,
        tokenUrl: this.options.tokenUrl,
        fetchImpl: this.options.fetchImpl,
      });
      if (this.generation !== ctx.generation) return;
      const user = await fetchBoatUserProfile({
        accessToken: tokens.accessToken,
        apiBase: this.options.apiBase,
        fetchImpl: this.options.fetchImpl,
      }).catch((): BoatOAuthUserProfile => ({
        id: null,
        login: null,
        displayName: null,
        email: null,
      }));
      if (this.generation !== ctx.generation) return;
      await this.options.onAuthenticated({ tokens, user });
      if (this.generation !== ctx.generation) return;
      const accountLabel = user.login ? (user.login.includes("@") ? user.login : `@${user.login}`) : null;
      this.setState({
        phase: "completed",
        message: accountLabel ? `Signed in to Boat as ${accountLabel}.` : "Signed in to Boat.",
        authUrl: null,
        error: null,
      });
    } catch (error) {
      if (this.generation !== ctx.generation) return;
      const message = error instanceof Error ? error.message : String(error);
      this.setState({
        phase: "error",
        message,
        authUrl: null,
        error: message,
      });
    }
  }

  private async cancelInternal(notify: boolean): Promise<void> {
    this.generation += 1;
    await this.closeActiveServer();
    this.state = IDLE_STATE;
    if (notify) {
      this.options.onStateChanged?.(this.state);
    }
  }

  private async closeActiveServer(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const server = this.server;
    this.server = null;
    if (server) {
      await closeServer(server);
    }
  }

  private setState(next: BoatOAuthState): void {
    this.state = next;
    this.options.onStateChanged?.(next);
  }
}

async function parseTokenResponse(response: Response, prefix: string): Promise<BoatOAuthTokenResponse> {
  if (!response.ok) {
    throw new Error(await formatBoatError(prefix, response));
  }
  const body = (await response.json()) as Record<string, unknown>;
  const accessToken = typeof body.access_token === "string" ? body.access_token.trim() : "";
  if (!accessToken) {
    throw new Error(`${prefix}: missing access_token in response.`);
  }
  const refreshToken =
    typeof body.refresh_token === "string" && body.refresh_token.trim() ? body.refresh_token.trim() : null;
  const expiresIn =
    typeof body.expires_in === "number" && Number.isFinite(body.expires_in) && body.expires_in > 0
      ? Math.round(body.expires_in)
      : 3600;
  return {
    accessToken,
    refreshToken,
    expiresIn,
    expiresAt: Date.now() + expiresIn * 1000,
    scope: typeof body.scope === "string" ? body.scope : "",
    tokenType: typeof body.token_type === "string" ? body.token_type : "Bearer",
  };
}

async function formatBoatError(prefix: string, response: Response): Promise<string> {
  const detail = await response
    .text()
    .then((text) => {
      try {
        const parsed = JSON.parse(text) as {
          error_description?: unknown;
          message?: unknown;
          error?: unknown;
        };
        if (typeof parsed.error_description === "string" && parsed.error_description.trim()) {
          return parsed.error_description.trim();
        }
        if (typeof parsed.message === "string" && parsed.message.trim()) {
          return parsed.message.trim();
        }
        if (typeof parsed.error === "string" && parsed.error.trim()) {
          return parsed.error.trim();
        }
        if (parsed.error && typeof parsed.error === "object") {
          const nested = parsed.error as { message?: unknown; code?: unknown };
          if (typeof nested.message === "string" && nested.message.trim()) return nested.message.trim();
          if (typeof nested.code === "string" && nested.code.trim()) return nested.code.trim();
        }
      } catch {
        // plain text body
      }
      return text.trim().slice(0, 200);
    })
    .catch(() => "");
  return detail ? `${prefix} (${response.status}): ${detail}` : `${prefix} (${response.status}).`;
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left, "utf8");
  const rightBuf = Buffer.from(right, "utf8");
  if (leftBuf.length !== rightBuf.length || leftBuf.length === 0) {
    return false;
  }
  return timingSafeEqual(leftBuf, rightBuf);
}

async function listenLoopbackPort(server: Server, preferredPort: number): Promise<number> {
  try {
    return await bindPort(server, preferredPort);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (preferredPort !== 0 && (code === "EADDRINUSE" || code === "EACCES")) {
      return bindPort(server, 0);
    }
    throw error;
  }
}

function bindPort(server: Server, port: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const addr = server.address() as AddressInfo | null;
      if (!addr) {
        reject(new Error("Boat OAuth callback server failed to bind."));
        return;
      }
      resolve(addr.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections?.();
  });
}

function sendHtml(res: ServerResponse, status: number, title: string, body: string): void {
  const safeTitle = escapeHtml(title);
  const safeBody = escapeHtml(body);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle} — Roder</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #fafaf9; color: #1c1917; }
  @media (prefers-color-scheme: dark) { body { background: #141413; color: #f5f5f4; } .card { background: #1c1c1a; border-color: rgba(255,255,255,0.1); } p { color: #a8a29e; } }
  .card { max-width: 420px; padding: 28px 32px; border-radius: 16px; background: #ffffff; border: 1px solid rgba(0,0,0,0.08); box-shadow: 0 8px 30px rgba(0,0,0,0.06); text-align: center; }
  h1 { margin: 0 0 8px; font-size: 18px; font-weight: 600; }
  p { margin: 0; font-size: 14px; line-height: 1.5; color: #57534e; }
</style>
</head>
<body>
  <main class="card">
    <h1>${safeTitle}</h1>
    <p>${safeBody}</p>
  </main>
</body>
</html>`;
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(html)),
    "Cache-Control": "no-store",
    Connection: "close",
  });
  res.end(html);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

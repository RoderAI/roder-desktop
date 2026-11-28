import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  BOAT_OAUTH_CLIENT_ID,
  BOAT_OAUTH_SCOPES,
  BoatOAuthController,
  buildBoatAuthorizeUrl,
  createPkcePair,
  type BoatOAuthState,
} from "../electron/cloud-machines/boat-oauth";
import { BoatClient, isBoatSandboxStartingState, parseBoatMachineConfig } from "../electron/cloud-machines/boat-client";
import { CloudCredentialsService } from "../electron/cloud-machines/credentials";
import { TailscaleRunnerGateway } from "../electron/cloud-machines/tailscale-runner-gateway";
import { cloudMachineThreadParams } from "../electron/cloud-machines/thread-routing";

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Boat OAuth PKCE flow", () => {
  test("builds valid S256 PKCE pair and Boat authorize URL with registered client ID", () => {
    const { codeVerifier, codeChallenge } = createPkcePair();
    const expectedChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    expect(codeChallenge).toBe(expectedChallenge);
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);

    const url = new URL(
      buildBoatAuthorizeUrl({
        redirectUri: "http://localhost:1338/",
        state: "state-123",
        codeChallenge,
      }),
    );
    expect(url.origin + url.pathname).toBe("https://boat.dev/api/boat/oauth2/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(BOAT_OAUTH_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:1338/");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("code_challenge")).toBe(codeChallenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe(BOAT_OAUTH_SCOPES.join(" "));
  });

  test("rejects mismatched state and exchanges valid loopback callback without client_secret", async () => {
    const states: BoatOAuthState[] = [];
    let openedUrl = "";
    let tokenBody = "";
    const onAuthenticated = vi.fn<(result: unknown) => Promise<void>>(async () => undefined);

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/oauth2/token")) {
        tokenBody = typeof init?.body === "string" ? init.body : "";
        return makeJsonResponse({
          access_token: "boat_at_fresh_123",
          refresh_token: "boat_rt_fresh_456",
          expires_in: 3600,
          scope: "account.read sandbox.read",
          token_type: "Bearer",
        });
      }
      if (url.endsWith("/me")) {
        return makeJsonResponse({
          user: { id: "u_1", login: "boatpilot", displayName: "Boat Pilot", email: "pilot@boat.dev" },
        });
      }
      return makeJsonResponse({ error: "unexpected" }, 404);
    });

    const controller = new BoatOAuthController({
      preferredPort: 0,
      openExternal: async (url) => {
        openedUrl = url;
      },
      onAuthenticated,
      onStateChanged: (next) => states.push(next),
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    try {
      const started = await controller.start();
      expect(started.phase).toBe("awaiting-browser");
      expect(openedUrl).toBe(started.authUrl);

      const authParsed = new URL(openedUrl);
      const redirectUri = authParsed.searchParams.get("redirect_uri")!;
      const expectedState = authParsed.searchParams.get("state")!;
      const expectedChallenge = authParsed.searchParams.get("code_challenge")!;

      // Reject wrong state without closing the listener
      const badRes = await fetch(`${redirectUri}?code=evil&state=wrong-state`);
      expect(badRes.status).toBe(400);
      expect(onAuthenticated).not.toHaveBeenCalled();

      // Send valid callback
      const okRes = await fetch(`${redirectUri}?code=boat_code_xyz&state=${encodeURIComponent(expectedState)}`);
      expect(okRes.status).toBe(200);

      await vi.waitFor(() => {
        expect(controller.getState().phase).toBe("completed");
      });

      const params = new URLSearchParams(tokenBody);
      expect(params.get("grant_type")).toBe("authorization_code");
      expect(params.get("code")).toBe("boat_code_xyz");
      expect(params.get("client_id")).toBe(BOAT_OAUTH_CLIENT_ID);
      expect(params.get("redirect_uri")).toBe(redirectUri);
      expect(params.has("client_secret")).toBe(false);

      const verifier = params.get("code_verifier")!;
      expect(createHash("sha256").update(verifier).digest("base64url")).toBe(expectedChallenge);

      expect(onAuthenticated).toHaveBeenCalledWith({
        tokens: expect.objectContaining({
          accessToken: "boat_at_fresh_123",
          refreshToken: "boat_rt_fresh_456",
        }),
        user: {
          id: "u_1",
          login: "boatpilot",
          displayName: "Boat Pilot",
          email: "pilot@boat.dev",
        },
      });
      expect(states.some((entry) => entry.phase === "exchanging")).toBe(true);
    } finally {
      controller.stop();
    }
  });

  test("returns to idle cleanly when user denies consent on Boat", async () => {
    let openedUrl = "";
    const controller = new BoatOAuthController({
      preferredPort: 0,
      openExternal: async (url) => {
        openedUrl = url;
      },
      onAuthenticated: async () => undefined,
    });

    try {
      await controller.start();
      const authParsed = new URL(openedUrl);
      const redirectUri = authParsed.searchParams.get("redirect_uri")!;
      const expectedState = authParsed.searchParams.get("state")!;
      const res = await fetch(`${redirectUri}?error=access_denied&state=${encodeURIComponent(expectedState)}`);
      expect(res.status).toBe(200);
      await vi.waitFor(() => {
        expect(controller.getState().phase).toBe("idle");
      });
    } finally {
      controller.stop();
    }
  });
});

describe("Boat rotating token refresh serialization", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  test("concurrent refreshes share a single in-flight refresh request and persist the rotated refresh token", async () => {
    const dir = await mkdtemp(join(tmpdir(), "roder-boat-creds-"));
    tempDirs.push(dir);
    const service = new CloudCredentialsService({
      filePath: join(dir, "cloud-credentials.bin"),
      encrypt: (value) => Buffer.from(value, "utf8"),
      decrypt: (value) => value.toString("utf8"),
      encryptionAvailable: () => true,
    });

    await service.saveBoatOAuth({
      accessToken: "boat_at_expiring",
      refreshToken: "boat_rt_v1",
      expiresAt: Date.now() + 10_000, // inside 5-minute refresh window
      userLogin: "pilot",
    });

    let refreshCalls = 0;
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      refreshCalls += 1;
      const body = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("boat_rt_v1");
      expect(body.has("client_secret")).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 25));
      return makeJsonResponse({
        access_token: "boat_at_rotated_v2",
        refresh_token: "boat_rt_rotated_v2",
        expires_in: 3600,
        scope: "account.read sandbox.read",
        token_type: "Bearer",
      });
    });

    const [tokenA, tokenB] = await Promise.all([
      service.resolveBoatAccessToken({ fetchImpl: fetchMock, baseEnv: {} }),
      service.resolveBoatAccessToken({ fetchImpl: fetchMock, baseEnv: {} }),
    ]);

    expect(refreshCalls).toBe(1);
    expect(tokenA).toBe("boat_at_rotated_v2");
    expect(tokenB).toBe("boat_at_rotated_v2");
    expect(await service.getBoatRefreshToken()).toBe("boat_rt_rotated_v2");
  });

  test("falls back to BOAT_API_KEY env var when no saved Boat credentials exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "roder-boat-env-"));
    tempDirs.push(dir);
    const service = new CloudCredentialsService({
      filePath: join(dir, "cloud-credentials.bin"),
      encrypt: (value) => Buffer.from(value, "utf8"),
      decrypt: (value) => value.toString("utf8"),
      encryptionAvailable: () => true,
    });

    const env = { BOAT_API_KEY: "boat_env_secret_1234" };
    const status = await service.getBoatStatus(env);
    expect(status.configured).toBe(true);
    expect(status.mode).toBe("api-key");
    expect(status.source).toBe("env");
    expect(await service.resolveBoatAccessToken({ baseEnv: env })).toBe("boat_env_secret_1234");
  });
});

describe("BoatClient and Boat runner gateway", () => {
  test("validates Boat sandbox config and retries once on 401 with forced refresh", async () => {
    expect(parseBoatMachineConfig({ sandbox_id: "bx_23456789", sandbox_name: "dev-boat" })).toEqual({
      sandboxId: "bx_23456789",
      sandboxName: "dev-boat",
    });
    expect(() => parseBoatMachineConfig({ sandbox_id: "invalid" })).toThrow(/sandbox_id/i);
    expect(isBoatSandboxStartingState("cloning")).toBe(true);
    expect(isBoatSandboxStartingState("provisioning")).toBe(true);
    expect(isBoatSandboxStartingState("idle")).toBe(false);

    let token = "stale_token";
    const getAccessToken = vi.fn<(options?: { forceRefresh?: boolean }) => Promise<string | null>>(async (options) => {
      if (options?.forceRefresh) token = "refreshed_token";
      return token;
    });

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const auth = new Headers(init?.headers).get("Authorization");
      if (auth === "Bearer stale_token") {
        return makeJsonResponse({ error: "expired" }, 401);
      }
      if (url.includes("/sandboxes") && (init?.method ?? "GET") === "GET") {
        return makeJsonResponse({
          sandboxes: [
            {
              id: "bx_23456789",
              name: "dev-boat",
              state: "idle",
              url: "https://bx_23456789.boat.dev",
              desktopAvailable: true,
              desktopUrl: "https://boat.dev/desktop/bx_23456789",
            },
          ],
        });
      }
      return makeJsonResponse({ error: "not found" }, 404);
    });

    const client = new BoatClient({
      getAccessToken,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const sandboxes = await client.listSandboxes();
    expect(sandboxes).toHaveLength(1);
    expect(sandboxes[0]).toMatchObject({
      id: "bx_23456789",
      name: "dev-boat",
      state: "idle",
      desktopAvailable: true,
      desktopUrl: "https://boat.dev/desktop/bx_23456789",
    });
    expect(getAccessToken).toHaveBeenCalledWith({ forceRefresh: true });
  });

  test("routes boat runner threads through desktop gateway and serves sessions, commands, files, and ports", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.endsWith("/sandboxes/bx_99887766") && method === "GET") {
        return makeJsonResponse({ id: "bx_99887766", name: "boat-dev", state: "idle" });
      }
      if (url.endsWith("/sandboxes/bx_99887766/commands") && method === "POST") {
        return makeJsonResponse({ exitCode: 0, stdout: "hello from boat\n", stderr: "", timedOut: false });
      }
      if (url.includes("/sandboxes/bx_99887766/files?") && method === "GET") {
        return makeJsonResponse({
          content: Buffer.from("boat file body", "utf8").toString("base64"),
          encoding: "base64",
        });
      }
      if (url.endsWith("/sandboxes/bx_99887766/files") && method === "PUT") {
        return makeJsonResponse({ ok: true });
      }
      if (url.endsWith("/sandboxes/bx_99887766/host") && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { localhost?: boolean };
        if (body.localhost === true) {
          return makeJsonResponse(
            { error: "The sandbox could not relay this port to localhost. Bind the service to 0.0.0.0." },
            500,
          );
        }
        return makeJsonResponse({
          port: 3000,
          url: "https://3000-bx_99887766.boat.dev",
          isProtected: false,
          access: "public",
          localhost: false,
        });
      }
      if (url.endsWith("/sandboxes/bx_99887766/sshkey") && method === "POST") {
        return makeJsonResponse({
          machineIp: "2001:41d0:1004:204d:100::28",
          sshUser: "user",
          sshEndpoint: "51.255.92.77:19040",
        });
      }
      return makeJsonResponse({ error: `unhandled ${method} ${url}` }, 404);
    });

    const boatClient = new BoatClient({
      getAccessToken: async () => "boat_token_ok",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const gateway = new TailscaleRunnerGateway({ boatClient });

    try {
      const { baseUrl } = await gateway.start();
      const token = gateway.token;
      const threadParams = await cloudMachineThreadParams(
        { desktopCloudMachineId: "boat-1", prompt: "hello" },
        async () => ({
          providerId: "boat",
          workspace: "/home/user/repo",
          config: { sandbox_id: "bx_99887766", sandbox_name: "boat-dev" },
        }),
        async () => null,
        "linux",
        async (_id, runner) => ({
          providerId: gateway.backingProviderId,
          workspace: runner.workspace,
          config: {
            ...runner.config,
            base_url: baseUrl,
            roder_transport: "boat",
            machine_name: "boat-dev",
          },
        }),
      );
      const routed = threadParams.runner as { providerId: string; config: Record<string, unknown> };

      expect(routed.providerId).toBe("runloop");
      expect(routed.config?.roder_transport).toBe("boat");
      expect(routed.config?.base_url).toBe(baseUrl);

      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };

      const sessionRes = await fetch(`${baseUrl}/sessions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ config: routed.config }),
      });
      expect(sessionRes.status).toBe(200);
      const { session_id: sessionId } = (await sessionRes.json()) as { session_id: string };
      expect(sessionId.startsWith("boat_")).toBe(true);

      const cmdRes = await fetch(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}/commands`, {
        method: "POST",
        headers,
        body: JSON.stringify({ command_id: "c1", program: "echo", args: ["hi"], cwd: "/home/user" }),
      });
      expect(cmdRes.status).toBe(200);
      expect(await cmdRes.json()).toMatchObject({ exit_code: 0, stdout: "hello from boat\n" });

      const readRes = await fetch(
        `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/files?path=${encodeURIComponent("/home/user/a.txt")}`,
        { headers },
      );
      expect(readRes.status).toBe(200);
      expect(await readRes.text()).toBe("boat file body");

      const writeRes = await fetch(
        `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/files?path=${encodeURIComponent("/home/user/b.txt")}`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
          body: "updated",
        },
      );
      expect(writeRes.status).toBe(204);

      const portRes = await fetch(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}/ports`, {
        method: "POST",
        headers,
        body: JSON.stringify({ port: 3000 }),
      });
      expect(portRes.status).toBe(200);
      expect(await portRes.json()).toMatchObject({ port: 3000, url: "https://3000-bx_99887766.boat.dev" });

      const sshTarget = await boatClient.configureSshKey("bx_99887766", "ssh-ed25519 AAAATEST");
      expect(sshTarget).toMatchObject({
        machineIp: "2001:41d0:1004:204d:100::28",
        sshHost: "51.255.92.77",
        sshPort: 19040,
        sshUser: "user",
      });
    } finally {
      await gateway.stop();
    }
  });
});

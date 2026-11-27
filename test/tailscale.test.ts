import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { redactSecrets } from "../electron/app-server-redaction";
import { CloudCredentialsService, maskCredentialPreview } from "../electron/cloud-machines/credentials";
import {
  buildTailscaledLaunchCommand,
  buildTailscaleInstallScript,
  buildTailscaleUpScript,
  detectLocalTailscale,
  mintTailscaleEphemeralAuthKey,
  normalizeTailscaleTags,
  parseRemoteTailscaleIdentity,
  parseTailscalePeerConfig,
  parseTailscaleStatusJson,
  sanitizeTailscaleHostname,
  validateTailscaleAuthKey,
} from "../electron/cloud-machines/tailscale";
import { buildTailscaleSshArgs } from "../electron/cloud-machines/tailscale-ssh";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setupCredentials() {
  const dir = await mkdtemp(join(tmpdir(), "roder-ts-creds-"));
  tempDirs.push(dir);
  const key = randomBytes(32);
  const options = {
    filePath: join(dir, "cloud-credentials.enc"),
    encryptionAvailable: () => true,
    encrypt: (text: string) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decrypt: (buffer: Buffer) => {
      const cipher = createDecipheriv("aes-256-gcm", key, buffer.subarray(0, 12));
      cipher.setAuthTag(buffer.subarray(12, 28));
      return Buffer.concat([cipher.update(buffer.subarray(28)), cipher.final()]).toString("utf8");
    },
  };
  return { options, service: new CloudCredentialsService(options) };
}

test("parses tailscale status --json, sorts online peers first, and filters Mullvad exit nodes", () => {
  const raw = JSON.stringify({
    Version: "1.104.2",
    BackendState: "Running",
    MagicDNSSuffix: "drum-sunfish.ts.net",
    CurrentTailnet: { Name: "user@example.com", MagicDNSSuffix: "drum-sunfish.ts.net" },
    CertDomains: ["iusearchbtw.drum-sunfish.ts.net"],
    Self: {
      HostName: "iusearchbtw",
      DNSName: "iusearchbtw.drum-sunfish.ts.net.",
      OS: "linux",
      TailscaleIPs: ["100.76.53.91", "fd7a::1"],
      Capabilities: ["https", "https://tailscale.com/cap/ssh"],
    },
    Peer: {
      p1: {
        ID: "n1",
        HostName: "The5090",
        DNSName: "the5090.drum-sunfish.ts.net.",
        OS: "windows",
        TailscaleIPs: ["100.121.112.122"],
        Online: false,
        Active: false,
        LastSeen: "2026-10-12T08:34:24Z",
      },
      p2: {
        ID: "n2",
        HostName: "devbox",
        DNSName: "devbox.drum-sunfish.ts.net.",
        OS: "linux",
        TailscaleIPs: ["100.90.10.20"],
        Online: true,
        Active: true,
        Tags: ["tag:roder"],
      },
      mullvad: {
        ID: "m1",
        HostName: "us-sjc-wg-001",
        DNSName: "us-sjc-wg-001.mullvad.ts.net.",
        OS: "linux",
        TailscaleIPs: ["100.64.0.1"],
        Online: true,
      },
    },
  });

  const status = parseTailscaleStatusJson(raw, "/usr/bin/tailscale");
  expect(status.running).toBe(true);
  expect(status.self).toEqual({
    hostName: "iusearchbtw",
    dnsName: "iusearchbtw.drum-sunfish.ts.net",
    tailscaleIp: "100.76.53.91",
    os: "linux",
    sshCapable: true,
    httpsEnabled: true,
  });
  expect(status.peers).toHaveLength(2);
  expect(status.peers[0]).toMatchObject({
    hostName: "devbox",
    dnsName: "devbox.drum-sunfish.ts.net",
    tailscaleIp: "100.90.10.20",
    online: true,
    tags: ["tag:roder"],
  });
  expect(status.peers[1]).toMatchObject({ hostName: "The5090", online: false });
});

test("detectLocalTailscale returns not-installed when binary is missing and Stopped on CLI error", async () => {
  const missing = await detectLocalTailscale({ env: { PATH: "" }, exists: () => false });
  expect(missing.installed).toBe(false);
  expect(missing.running).toBe(false);

  const stopped = await detectLocalTailscale({
    env: { PATH: "/usr/bin" },
    exists: (p) => p === "/usr/bin/tailscale",
    execFileImpl: async () => {
      throw new Error("tailscaled is not running");
    },
  });
  expect(stopped.installed).toBe(true);
  expect(stopped.running).toBe(false);
  expect(stopped.error).toContain("not running");
});

test("sanitizes hostnames, normalizes tags, and validates auth keys", () => {
  expect(sanitizeTailscaleHostname("My_Sandbox 01")).toBe("roder-my-sandbox-01");
  expect(sanitizeTailscaleHostname("roder-dev")).toBe("roder-dev");
  expect(normalizeTailscaleTags("roder, tag:dev, roder")).toEqual(["tag:roder", "tag:dev"]);
  expect(() => normalizeTailscaleTags("tag:bad tag!")).toThrow(/Invalid Tailscale tag/);
  expect(validateTailscaleAuthKey("  tskey-auth-k12345CNTRL-secret  ")).toBe("tskey-auth-k12345CNTRL-secret");
  expect(() => validateTailscaleAuthKey("not-a-key")).toThrow(/tskey-auth-/);
});

test("mints single-use ephemeral preauthorized keys via Tailscale OAuth v2 API", async () => {
  const calls: Array<{ url: string; method?: string; body?: string; auth?: string | null }> = [];
  const fetchImpl = vi.fn<typeof fetch>(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method: init?.method,
      body: typeof init?.body === "string" ? init.body : undefined,
      auth: headers.get("Authorization"),
    });
    if (url.endsWith("/oauth/token")) {
      return new Response(JSON.stringify({ access_token: "ts-access-tok", expires_in: 3600 }), { status: 200 });
    }
    if (url.includes("/tailnet/-/keys")) {
      return new Response(JSON.stringify({ id: "k123", key: "tskey-auth-ephemeral-xyz" }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;

  const minted = await mintTailscaleEphemeralAuthKey({
    oauthClientId: "kClient123",
    oauthClientSecret: "tskey-client-secret-abc",
    tags: ["roder"],
    fetchImpl,
  });

  expect(minted.key).toBe("tskey-auth-ephemeral-xyz");
  expect(calls).toHaveLength(2);
  expect(calls[0]?.body).toContain("client_id=kClient123");
  expect(calls[1]?.auth).toBe("Bearer ts-access-tok");
  const keyBody = JSON.parse(calls[1]?.body ?? "{}") as {
    capabilities: {
      devices: { create: { ephemeral: boolean; reusable: boolean; preauthorized: boolean; tags: string[] } };
    };
  };
  expect(keyBody.capabilities.devices.create).toEqual({
    reusable: false,
    ephemeral: true,
    preauthorized: true,
    tags: ["tag:roder"],
  });
});

test("generates rootless userspace tailscaled scripts and safe SSH arguments", () => {
  const installScript = buildTailscaleInstallScript();
  expect(installScript).toContain("pkgs.tailscale.com/stable/");
  expect(installScript).toContain("/root/.roder/bin/tailscaled");

  const daemonCmd = buildTailscaledLaunchCommand();
  expect(daemonCmd).toContain("--tun=userspace-networking");
  expect(daemonCmd).toContain("--socket='/root/.roder/run/tailscaled.sock'");

  const upScript = buildTailscaleUpScript("my-sandbox", "tskey-auth-test-123");
  expect(upScript).toContain("umask 077");
  expect(upScript).toContain('--auth-key="file:$key_file"');
  expect(upScript).toContain("--hostname='roder-my-sandbox'");
  expect(upScript).toContain("--accept-dns=false");
  expect(upScript).toContain('rm -f "$key_file"');

  expect(
    parseRemoteTailscaleIdentity(
      'noise\n{"BackendState":"Running","Self":{"TailscaleIPs":["100.88.1.2"],"DNSName":"roder-x.ts.net."}}',
    ),
  ).toEqual({
    running: true,
    tailscaleIp: "100.88.1.2",
    dnsName: "roder-x.ts.net",
    backendState: "Running",
  });

  const peer = parseTailscalePeerConfig({
    tailscale_host: "devbox.drum-sunfish.ts.net.",
    tailscale_ip: "100.90.10.20",
    ssh_user: "pz",
    ssh_port: 2222,
  });
  expect(peer).toEqual({
    host: "100.90.10.20",
    tailscaleIp: "100.90.10.20",
    dnsName: "devbox.drum-sunfish.ts.net",
    sshUser: "pz",
    sshPort: 2222,
    remoteRoderPort: 17373,
  });
  expect(() => parseTailscalePeerConfig({ tailscale_host: "-oProxyCommand=evil" })).toThrow(/valid/i);
  expect(() => parseTailscalePeerConfig({ tailscale_host: "devbox", ssh_user: "-root" })).toThrow(/SSH username/i);

  const sshArgs = buildTailscaleSshArgs(peer, { remoteCommand: "echo hi" });
  expect(sshArgs).toContain("BatchMode=yes");
  expect(sshArgs).toContain("-p");
  expect(sshArgs).toContain("2222");
  expect(sshArgs.slice(-3)).toEqual(["--", "pz@100.90.10.20", "echo hi"]);
});

test("encrypts Tailscale OAuth and auth-key credentials at rest, masks previews, and redacts diagnostics", async () => {
  const { options, service } = await setupCredentials();
  const authKey = "tskey-auth-kSecret999-abcdef123456";

  const authStatus = await service.saveTailscaleAuthKey({ authKey, preferForSandboxes: true });
  expect(authStatus).toMatchObject({
    configured: true,
    mode: "auth-key",
    source: "saved",
    preview: maskCredentialPreview(authKey),
    preferForSandboxes: true,
  });
  expect(authStatus.preview).not.toContain("Secret999");

  const ciphertext = await readFile(options.filePath, "utf8");
  expect(ciphertext).not.toContain(authKey);
  expect((await stat(options.filePath)).mode & 0o777).toBe(0o600);

  const toggled = await service.setTailscalePreferForSandboxes(false);
  expect(toggled.preferForSandboxes).toBe(false);

  const oauthSecret = "tskey-client-kOAuthSecret888-zzzz";
  const oauthStatus = await service.saveTailscaleOAuth({
    oauthClientId: "kClientId123",
    oauthClientSecret: oauthSecret,
    tags: ["roder", "tag:sandbox"],
    tailnet: "example.com",
  });
  expect(oauthStatus).toMatchObject({
    configured: true,
    mode: "oauth",
    oauthClientId: "kClientId123",
    tags: ["tag:roder", "tag:sandbox"],
    tailnet: "example.com",
    preferForSandboxes: true,
  });
  expect(oauthStatus.preview).not.toContain("OAuthSecret888");

  const resolved = await service.resolveTailscaleAuth({});
  expect(resolved).toEqual({
    mode: "oauth",
    oauthClientId: "kClientId123",
    oauthClientSecret: oauthSecret,
    tags: ["tag:roder", "tag:sandbox"],
    tailnet: "example.com",
    preferForSandboxes: true,
  });

  await service.clearProvider("tailscale");
  expect(await service.resolveTailscaleAuth({})).toBeNull();
  const envResolved = await service.resolveTailscaleAuth({ TAILSCALE_AUTH_KEY: "tskey-auth-env-123" });
  expect(envResolved).toEqual({ mode: "auth-key", authKey: "tskey-auth-env-123", preferForSandboxes: true });

  expect(redactSecrets({ authKey, oauthClientSecret: oauthSecret, host: "devbox" })).toEqual({
    authKey: "[redacted]",
    oauthClientSecret: "[redacted]",
    host: "devbox",
  });
});

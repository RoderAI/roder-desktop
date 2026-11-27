import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { BlaxelClient } from "../electron/cloud-machines/blaxel-client";
import { CloudCredentialsService } from "../electron/cloud-machines/credentials";
import { RemoteRoderTunnelManager } from "../electron/cloud-machines/remote-roder-tunnel";
import { remoteWorkspaceIdForMachine, RemoteWorkspaceService } from "../electron/cloud-machines/remote-workspace";
import { CloudMachinesService } from "../electron/cloud-machines/service";
import {
  detectLocalSshEnvironment,
  parseQuickSshTarget,
  parseSshConfigText,
  parseSshMachineConfig,
} from "../electron/cloud-machines/ssh-config";
import { TailscaleRunnerGateway } from "../electron/cloud-machines/tailscale-runner-gateway";
import { buildTailscaleSshArgs, TailscaleSshClient } from "../electron/cloud-machines/tailscale-ssh";
import { effectiveRunnerProviderId, parseQuickSshInput, remoteRunnerTargetName } from "../src/lib/cloud-machines";

const tempDirs: string[] = [];
const gateways: TailscaleRunnerGateway[] = [];
afterEach(async () => {
  await Promise.all(gateways.splice(0).map((g) => g.stop()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createCryptoOptions(filePath: string) {
  const key = randomBytes(32);
  return {
    filePath,
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
}

test("parses ~/.ssh/config hosts, detects private key paths safely, and parses quick SSH inputs", async () => {
  const configText = `
# Global defaults should be ignored as standalone hosts
Host *
  ServerAliveInterval 60

Host hetzner-prod prod
  HostName 203.0.113.10
  User root
  Port 2222
  IdentityFile ~/.ssh/Hetzner
  ProxyJump bastion@jump.example.com

Host mac-mini
  HostName 192.168.1.50
  User pz
`;
  const parsed = parseSshConfigText(configText);
  expect(parsed).toEqual([
    {
      alias: "hetzner-prod",
      hostName: "203.0.113.10",
      user: "root",
      port: 2222,
      identityFile: "~/.ssh/Hetzner",
      proxyJump: "bastion@jump.example.com",
    },
    {
      alias: "prod",
      hostName: "203.0.113.10",
      user: "root",
      port: 2222,
      identityFile: "~/.ssh/Hetzner",
      proxyJump: "bastion@jump.example.com",
    },
    {
      alias: "mac-mini",
      hostName: "192.168.1.50",
      user: "pz",
      port: 22,
      identityFile: null,
      proxyJump: null,
    },
  ]);

  const homeDir = await mkdtemp(join(tmpdir(), "roder-ssh-home-"));
  tempDirs.push(homeDir);
  await mkdir(join(homeDir, ".ssh"), { recursive: true });
  await writeFile(join(homeDir, ".ssh", "config"), configText, "utf8");
  await writeFile(join(homeDir, ".ssh", "Hetzner"), "PRIVATE-KEY-NEVER-READ", "utf8");
  await writeFile(join(homeDir, ".ssh", "Hetzner.pub"), "ssh-ed25519 AAAA", "utf8");
  await writeFile(join(homeDir, ".ssh", "known_hosts"), "example.com ssh-ed25519 AAAA", "utf8");

  const env = await detectLocalSshEnvironment({
    homeDir,
    env: { PATH: "/usr/bin" },
    exists: (p) => p === "/usr/bin/ssh",
  });
  expect(env.installed).toBe(true);
  expect(env.hosts).toHaveLength(3);
  expect(env.identityFiles).toEqual(["~/.ssh/Hetzner"]);
  expect(JSON.stringify(env)).not.toContain("PRIVATE-KEY-NEVER-READ");

  for (const parser of [parseQuickSshTarget, parseQuickSshInput]) {
    expect(parser("ssh -p 2222 -i ~/.ssh/Hetzner -J jump.local ubuntu@dev.example.com")).toEqual({
      host: "dev.example.com",
      user: "ubuntu",
      port: 2222,
      identityFile: "~/.ssh/Hetzner",
      proxyJump: "jump.local",
    });
    expect(parser("root@203.0.113.10:2200")).toEqual({
      host: "203.0.113.10",
      user: "root",
      port: 2200,
    });
  }
});

test("validates SSH machine config, blocks flag injection, and builds safe SSH args with macOS-safe ControlPath", async () => {
  const cfg = parseSshMachineConfig(
    {
      ssh_host: "hetzner-prod",
      ssh_user: "deploy",
      ssh_port: 2222,
      identity_file: "~/.ssh/Hetzner",
      proxy_jump: "bastion@jump.example.com",
    },
    "/Users/alice",
  );
  expect(cfg).toMatchObject({
    host: "hetzner-prod",
    sshUser: "deploy",
    sshPort: 2222,
    identityFile: "/Users/alice/.ssh/Hetzner",
    proxyJump: "bastion@jump.example.com",
    remoteRoderPort: 17373,
  });

  expect(() => parseSshMachineConfig({ ssh_host: "-oProxyCommand=bad" })).toThrow(/valid/i);
  expect(() => parseSshMachineConfig({ ssh_host: "ok", identity_file: "-evil" })).toThrow(/must not start/i);
  expect(() => parseSshMachineConfig({ ssh_host: "ok", proxy_jump: "-evil" })).toThrow(/ProxyJump/i);

  const args = buildTailscaleSshArgs(cfg, {
    disableControlMaster: true,
    noRemoteCommand: true,
    localForward: { localPort: 45123, remotePort: 17373 },
  });
  expect(args).toContain("-N");
  expect(args).toContain("-L");
  expect(args).toContain("127.0.0.1:45123:127.0.0.1:17373");
  expect(args).toContain("ControlMaster=no");
  expect(args).toContain("ControlPath=none");
  expect(args).not.toContain("ControlMaster=auto");
  expect(args).toContain("-i");
  expect(args).toContain("/Users/alice/.ssh/Hetzner");
  expect(args).toContain("IdentitiesOnly=yes");
  expect(args).toContain("-J");
  expect(args).toContain("bastion@jump.example.com");
  expect(args.slice(-2)).toEqual(["--", "deploy@hetzner-prod"]);

  const baseDir = await mkdtemp(join(tmpdir(), "roder-ts-ctrl-"));
  tempDirs.push(baseDir);
  const macLikeSubdir = join(baseDir, "0123456789abcdef0123456789abcdef", "T", "rts-1");
  const client = new TailscaleSshClient({ controlDir: macLikeSubdir });
  const socketPath = client.controlPathFor(cfg);
  expect(socketPath).toBeTruthy();
  expect(socketPath!.length).toBeLessThan(104);
  client.closeAll();

  expect(effectiveRunnerProviderId({ providerId: "runloop", config: { roder_transport: "ssh" } })).toBe("ssh");
  expect(
    remoteRunnerTargetName({
      providerId: "runloop",
      workspace: "/srv/app",
      config: { roder_transport: "ssh", ssh_host: "hetzner-prod" },
    }),
  ).toBe("hetzner-prod");
});

test("SSH machine tunnels remote-roder over encrypted local SSH forward with zero exposed ports, and supports Tailscale injection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "roder-ssh-ws-"));
  tempDirs.push(dir);
  const credentials = new CloudCredentialsService(createCryptoOptions(join(dir, "creds.enc")));
  const machines = new CloudMachinesService(createCryptoOptions(join(dir, "machines.enc")));
  const { machine } = await machines.save({
    name: "hetzner",
    providerId: "ssh",
    workspace: "/srv/app",
    config: { ssh_host: "203.0.113.10", ssh_user: "ubuntu", ssh_port: 22 },
  });

  const sshCommands: string[] = [];
  let forwardClosed = false;
  const sshStub = {
    execCommand: vi.fn<TailscaleSshClient["execCommand"]>(async (_peer, cmd) => {
      sshCommands.push(cmd);
      if (cmd.includes("RODER_BIN:")) {
        return {
          exitCode: 0,
          stdout: "RODER_BIN:/home/ubuntu/.roder/bin/remote-roder\n",
          stderr: "",
          timedOut: false,
          cancelled: false,
        };
      }
      if (cmd.includes("REUSE:")) {
        return {
          exitCode: 0,
          stdout: "REUSE:ssh_bridge_token_0123456789abcdef\n",
          stderr: "",
          timedOut: false,
          cancelled: false,
        };
      }
      if (cmd.includes("RODER:YES")) {
        return {
          exitCode: 0,
          stdout: "OS:Linux\nDIR:YES\nRODER:YES\nTS:NO\n",
          stderr: "",
          timedOut: false,
          cancelled: false,
        };
      }
      if (cmd.includes("BackendState")) {
        return {
          exitCode: 0,
          stdout: '{"BackendState":"NotRunning"}\n',
          stderr: "",
          timedOut: false,
          cancelled: false,
        };
      }
      if (cmd.includes("TAILSCALE_READY")) {
        return { exitCode: 0, stdout: "TAILSCALE_READY\n", stderr: "", timedOut: false, cancelled: false };
      }
      if (cmd.includes("SOCKET_READY")) {
        return { exitCode: 0, stdout: "SOCKET_READY\n", stderr: "", timedOut: false, cancelled: false };
      }
      if (cmd.includes("--auth-key=")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            BackendState: "Running",
            Self: { TailscaleIPs: ["100.111.22.33"], DNSName: "roder-hetzner.drum-sunfish.ts.net." },
          }),
          stderr: "",
          timedOut: false,
          cancelled: false,
        };
      }
      return { exitCode: 0, stdout: "OK\n", stderr: "", timedOut: false, cancelled: false };
    }),
    openLocalForward: vi.fn<TailscaleSshClient["openLocalForward"]>(async (_peer, remotePort) => ({
      localPort: remotePort === 17373 ? 49173 : 49300,
      remotePort,
      close: () => {
        forwardClosed = true;
      },
    })),
    readFile: vi.fn<TailscaleSshClient["readFile"]>(async () => Buffer.from("ok")),
    writeFile: vi.fn<TailscaleSshClient["writeFile"]>(async () => undefined),
    cancelCommand: vi.fn<TailscaleSshClient["cancelCommand"]>(() => false),
    closeAll: vi.fn<TailscaleSshClient["closeAll"]>(),
  } as unknown as TailscaleSshClient;

  const capturedWsUrls: string[] = [];
  const tunnelManager = new RemoteRoderTunnelManager({
    blaxelClient: new BlaxelClient(),
    sshClient: sshStub,
    createWebSocket: (url) => {
      capturedWsUrls.push(url);
      const emitter = new EventEmitter();
      const ws = {
        readyState: 1,
        addEventListener: (event: string, listener: (arg?: unknown) => void) => emitter.on(event, listener),
        send: (raw: string) => {
          const msg = JSON.parse(raw) as { id: number; method: string };
          queueMicrotask(() => {
            if (msg.method === "initialize") {
              emitter.emit("message", { data: JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { ok: true } }) });
            } else if (msg.method === "workspace/list") {
              emitter.emit("message", {
                data: JSON.stringify({
                  jsonrpc: "2.0",
                  id: msg.id,
                  result: { workspaces: [{ id: "ws_ssh_1", roots: [{ id: "r_ssh_1", path: "/srv/app" }] }] },
                }),
              });
            } else if (msg.method === "workspace/files/children") {
              emitter.emit("message", {
                data: JSON.stringify({
                  jsonrpc: "2.0",
                  id: msg.id,
                  result: { status: { workspaceId: "ws_ssh_1", state: "ready", roots: [] }, entries: [] },
                }),
              });
            }
          });
        },
        close: () => {
          ws.readyState = 3;
          emitter.emit("close", { code: 1000 });
        },
      };
      queueMicrotask(() => emitter.emit("open"));
      return ws as unknown as WebSocket;
    },
  });

  const service = new RemoteWorkspaceService({
    blaxelClient: new BlaxelClient(),
    credentialsService: credentials,
    machinesService: machines,
    readThreadRunner: async () => null,
    sshClient: sshStub,
    tunnelManager,
    detectLocalTailscale: async () => ({
      installed: true,
      running: true,
      backendState: "Running",
      version: "1.104.2",
      binaryPath: "/usr/bin/tailscale",
      self: {
        hostName: "iusearchbtw",
        dnsName: "iusearchbtw.drum-sunfish.ts.net",
        tailscaleIp: "100.76.53.91",
        os: "linux",
        sshCapable: true,
        httpsEnabled: true,
      },
      tailnetName: "user@example.com",
      magicDnsSuffix: "drum-sunfish.ts.net",
      peers: [],
    }),
  });

  // 1. Test SSH machine profile
  const testRes = await service.testProfile({
    providerId: "ssh",
    workspace: "/srv/app",
    config: { ssh_host: "203.0.113.10", ssh_user: "ubuntu", ssh_port: 22 },
  });
  expect(testRes.ok).toBe(true);
  expect(testRes.message).toContain("over SSH");

  // 2. Pure SSH mode opens local SSH forward (zero public ports)
  const wsId = remoteWorkspaceIdForMachine(machine.id);
  await service.proxyRequest("workspace/files/children", { workspaceId: wsId, rootId: "remote-root" });
  expect(capturedWsUrls[0]).toBe("ws://127.0.0.1:49173");
  expect((await service.getStatus(wsId)).bridgeMode).toBe("ssh-tunnel");

  // Port preview over pure SSH opens a managed local forward
  const sshPreview = await service.openPreviewPort(wsId, 3000);
  expect(sshPreview).toEqual({ url: "http://127.0.0.1:49300", port: 3000, transport: "ssh-forward" });

  // 3. Inject Tailscale into the SSH machine on demand
  await credentials.saveTailscaleAuthKey({ authKey: "tskey-auth-kSshInject123", preferForSandboxes: true });
  const tsStatus = await service.setupTailscaleTunnel(wsId);
  expect(forwardClosed).toBe(true);
  expect(capturedWsUrls[1]).toBe("ws://100.111.22.33:17373");
  expect(tsStatus).toMatchObject({
    providerId: "ssh",
    bridgeMode: "tailscale-tunnel",
    tailscaleActive: true,
    tailscaleIp: "100.111.22.33",
    tailscaleDnsName: "roder-hetzner.drum-sunfish.ts.net",
  });
  // Verify non-root $HOME/.roder was used for SSH Tailscale injection!
  expect(sshCommands.some((cmd) => cmd.includes("$HOME/.roder/bin/tailscaled"))).toBe(true);

  // Port preview now uses the direct Tailscale IP!
  const tsPreview = await service.openPreviewPort(wsId, 3000);
  expect(tsPreview).toEqual({ url: "http://100.111.22.33:3000", port: 3000, transport: "tailscale" });

  // 4. Loopback runner gateway executes SSH-transport sessions and exposes ports via SSH forward
  const gateway = new TailscaleRunnerGateway({ sshClient: sshStub, preferredPort: 0 });
  gateways.push(gateway);
  const { baseUrl } = await gateway.start();
  const auth = { Authorization: `Bearer ${gateway.token}`, "Content-Type": "application/json" };
  (sshStub.execCommand as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    exitCode: 0,
    stdout: "RODER_TS_OK",
    stderr: "",
    timedOut: false,
    cancelled: false,
  });
  const created = await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      config: { roder_transport: "ssh", ssh_host: "203.0.113.10", ssh_user: "ubuntu", ssh_port: 22 },
    }),
  });
  const { session_id: sshSessionId } = (await created.json()) as { session_id: string };
  expect(sshSessionId.startsWith("ssh_")).toBe(true);
  const gwPort = await fetch(`${baseUrl}/sessions/${encodeURIComponent(sshSessionId)}/ports`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ port: 8080 }),
  });
  expect(await gwPort.json()).toEqual({ port: 8080, url: "http://127.0.0.1:49300" });

  service.closeAll();
});

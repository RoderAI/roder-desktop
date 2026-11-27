import { afterEach, expect, test, vi } from "vitest";
import {
  buildRemoteShellExecCommand,
  decodeTailscaleSessionId,
  encodeTailscaleSessionId,
  selectBackingGatewayProvider,
  TailscaleRunnerGateway,
} from "../electron/cloud-machines/tailscale-runner-gateway";
import type { TailscaleSshClient } from "../electron/cloud-machines/tailscale-ssh";

const gateways: TailscaleRunnerGateway[] = [];
afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.stop()));
});

test("selects an unused hosted gateway provider without clobbering user credentials", () => {
  expect(selectBackingGatewayProvider({})).toMatchObject({ providerId: "runloop", tokenEnv: "RUNLOOP_API_KEY" });
  expect(selectBackingGatewayProvider({ RUNLOOP_API_KEY: "user-key" })).toMatchObject({
    providerId: "daytona",
    tokenEnv: "DAYTONA_API_KEY",
  });
  expect(selectBackingGatewayProvider({ RUNLOOP_API_KEY: "u1", DAYTONA_API_KEY: "u2" }, ["e2b"])).toMatchObject({
    providerId: "e2b",
  });
});

test("encodes/decodes resilient Tailscale session IDs and builds safe shell commands", () => {
  const peer = {
    host: "100.90.10.20",
    tailscaleIp: "100.90.10.20",
    dnsName: "devbox.drum-sunfish.ts.net",
    sshUser: "pz",
    sshPort: 2222,
    remoteRoderPort: 17373,
  };
  const encoded = encodeTailscaleSessionId(peer);
  expect(encoded.startsWith("ts_")).toBe(true);
  expect(decodeTailscaleSessionId(encoded)).toEqual(peer);
  expect(decodeTailscaleSessionId("invalid")).toBeNull();

  const cmd = buildRemoteShellExecCommand({
    program: "git",
    args: ["status", "--short"],
    cwd: "/home/pz/my repo",
    env: [
      ["NODE_ENV", "test"],
      ["BAD;KEY", "ignored"],
    ],
  });
  expect(cmd).toContain("cd --");
  expect(cmd).toContain("export NODE_ENV=");
  expect(cmd).not.toContain("BAD;KEY");
  expect(cmd).toContain("exec");
});

test("TailscaleRunnerGateway enforces Bearer auth and executes session/command/file/port operations", async () => {
  const files = new Map<string, Buffer>([["/home/pz/app/README.md", Buffer.from("hello tailscale\n", "utf8")]]);
  const sshStub = {
    execCommand: vi.fn<TailscaleSshClient["execCommand"]>(async (_peer, cmd: string) => {
      if (cmd.includes("RODER_TS_OK")) {
        return { exitCode: 0, stdout: "RODER_TS_OK", stderr: "", timedOut: false, cancelled: false };
      }
      return { exitCode: 0, stdout: `ran:${cmd}`, stderr: "", timedOut: false, cancelled: false };
    }),
    readFile: vi.fn<TailscaleSshClient["readFile"]>(async (_peer, path: string) => {
      const found = files.get(path);
      if (!found) throw new Error("ENOENT");
      return found;
    }),
    writeFile: vi.fn<TailscaleSshClient["writeFile"]>(async (_peer, path: string, data: Buffer) => {
      files.set(path, Buffer.from(data));
    }),
    cancelCommand: vi.fn<TailscaleSshClient["cancelCommand"]>(() => true),
    closeAll: vi.fn<TailscaleSshClient["closeAll"]>(),
  } as unknown as TailscaleSshClient;

  const gateway = new TailscaleRunnerGateway({ sshClient: sshStub, preferredPort: 0 });
  gateways.push(gateway);
  const { baseUrl } = await gateway.start();
  const authHeaders = { Authorization: `Bearer ${gateway.token}` };

  // Reject missing / invalid tokens
  const unauth = await fetch(`${baseUrl}/sessions`, { method: "POST", body: "{}" });
  expect(unauth.status).toBe(401);
  const badAuth = await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: { Authorization: "Bearer wrong-token" },
    body: "{}",
  });
  expect(badAuth.status).toBe(401);

  // Create session
  const createdRes = await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      destination_id: "tailscale",
      provider_id: "runloop",
      config: { tailscale_host: "devbox.drum-sunfish.ts.net", tailscale_ip: "100.90.10.20", ssh_user: "pz" },
    }),
  });
  expect(createdRes.status).toBe(200);
  const { session_id: sessionId } = (await createdRes.json()) as { session_id: string };
  expect(sessionId.startsWith("ts_")).toBe(true);

  // Resume session check
  const resumeRes = await fetch(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}`, { headers: authHeaders });
  expect(resumeRes.status).toBe(200);

  // Run command
  const cmdRes = await fetch(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}/commands`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ command_id: "c1", program: "echo", args: ["hi"], cwd: "/home/pz/app" }),
  });
  expect(cmdRes.status).toBe(200);
  const cmdJson = (await cmdRes.json()) as { command_id: string; exit_code: number; stdout: string };
  expect(cmdJson.command_id).toBe("c1");
  expect(cmdJson.exit_code).toBe(0);
  expect(cmdJson.stdout).toContain("echo");

  // Cancel command
  const cancelRes = await fetch(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}/commands/c1`, {
    method: "DELETE",
    headers: authHeaders,
  });
  expect(cancelRes.status).toBe(200);
  expect(await cancelRes.json()).toEqual({ cancelled: true });

  // Read & write files
  const readRes = await fetch(
    `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/files?path=${encodeURIComponent("/home/pz/app/README.md")}`,
    { headers: authHeaders },
  );
  expect(readRes.status).toBe(200);
  expect(await readRes.text()).toBe("hello tailscale\n");

  const writeRes = await fetch(
    `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/files?path=${encodeURIComponent("/home/pz/app/new.txt")}`,
    { method: "PUT", headers: authHeaders, body: "written over tailscale" },
  );
  expect(writeRes.status).toBe(204);
  expect(files.get("/home/pz/app/new.txt")?.toString("utf8")).toBe("written over tailscale");

  // Expose private tailnet port
  const portRes = await fetch(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}/ports`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ port: 5173 }),
  });
  expect(portRes.status).toBe(200);
  expect(await portRes.json()).toEqual({ port: 5173, url: "http://100.90.10.20:5173" });

  // Close session
  const closeRes = await fetch(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    headers: authHeaders,
  });
  expect(closeRes.status).toBe(204);
});

import { EventEmitter } from "node:events";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { BlaxelClient, encodeBlaxelPath } from "../electron/cloud-machines/blaxel-client";
import { BlaxelTerminalSession, buildBlaxelTerminalWsUrl } from "../electron/cloud-machines/blaxel-terminal";
import { CloudCredentialsService } from "../electron/cloud-machines/credentials";
import {
  buildRemoteRoderInstallScript,
  previewHttpUrlToWsUrl,
  RemoteRoderTunnelManager,
} from "../electron/cloud-machines/remote-roder-tunnel";
import {
  paginateUnifiedDiff,
  parseFindIndexOutput,
  parseRemoteGitStatusOutput,
  remoteWorkspaceIdForMachine,
  remoteWorkspaceIdForThread,
  RemoteWorkspaceService,
} from "../electron/cloud-machines/remote-workspace";
import { CloudMachinesService } from "../electron/cloud-machines/service";

const tempDirs: string[] = [];
afterEach(async () => {
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

test("encodeBlaxelPath preserves the leading slash and encodes path segments", () => {
  expect(encodeBlaxelPath("/workspace")).toBe("/workspace");
  expect(encodeBlaxelPath("/workspace/my file/index.ts")).toBe("/workspace/my%20file/index.ts");
  expect(encodeBlaxelPath("/")).toBe("/");
});

test("RemoteWorkspaceService serves Files, Search, Read, and Git Review over Blaxel API", async () => {
  const dir = await mkdtemp(join(tmpdir(), "roder-remote-ws-"));
  tempDirs.push(dir);
  const credentialsService = new CloudCredentialsService(createCryptoOptions(join(dir, "creds.enc")));
  const machinesService = new CloudMachinesService(createCryptoOptions(join(dir, "machines.enc")));
  await credentialsService.saveBlaxel({ apiKey: "bl_test_key_1234567890", workspace: "vexscm" });
  const { machine } = await machinesService.save({
    name: "Blaxel Dev",
    providerId: "blaxel",
    workspace: "/workspace",
    config: { sandbox_name: "demo-sbx", working_dir: "/workspace", workspace: "vexscm" },
  });

  let processCallCount = 0;
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";

    if (url === "https://api.blaxel.ai/v0/sandboxes/demo-sbx") {
      return new Response(
        JSON.stringify({
          metadata: { name: "demo-sbx", workspace: "vexscm", url: "https://sbx-demo.bl.run" },
          spec: { region: "us-pdx-1" },
          status: "DEPLOYED",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url === "https://sbx-demo.bl.run/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === "https://sbx-demo.bl.run/filesystem//workspace") {
      return new Response(
        JSON.stringify({
          path: "/workspace",
          name: "workspace",
          files: [{ path: "/workspace/README.md", name: "README.md", size: 14 }],
          subdirectories: [
            { path: "/workspace/.git", name: ".git" },
            { path: "/workspace/src", name: "src" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url === "https://sbx-demo.bl.run/filesystem//workspace/README.md") {
      return new Response("# Remote Demo\n", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    if (url === "https://sbx-demo.bl.run/filesystem//workspace/logo.png") {
      return new Response(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]), {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      });
    }
    if (url === "https://sbx-demo.bl.run/process" && method === "POST") {
      processCallCount += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as { command?: string };
      // First process call simulates standby 503 to verify automatic /health wake & retry!
      if (processCallCount === 1) {
        return new Response("waking", { status: 503 });
      }
      if (body.command?.includes("RODER_FILES")) {
        return new Response(
          JSON.stringify({
            exitCode: 0,
            stdout: ".\n./src\n===RODER_FILES===\n./README.md\n./src/app.ts\n",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (body.command?.includes("RODER_STATUS")) {
        return new Response(
          JSON.stringify({
            exitCode: 0,
            stdout: [
              "===RODER_ROOT===",
              "/workspace",
              "===RODER_BRANCH===",
              "main",
              "===RODER_BASE===",
              "origin/main",
              "===RODER_STATUS===",
              " M src/app.ts",
              "?? notes.txt",
              "===RODER_STAGED_NUMSTAT===",
              "===RODER_UNSTAGED_NUMSTAT===",
              "4\t1\tsrc/app.ts",
              "===RODER_UNTRACKED_COUNTS===",
              "2\tnotes.txt",
            ].join("\n"),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (body.command?.includes("git diff")) {
        return new Response(
          JSON.stringify({
            exitCode: 0,
            stdout: "diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1,2 @@\n-old\n+new\n+more\n",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
    }
    return new Response("Not Found", { status: 404 });
  });

  const blaxelClient = new BlaxelClient({ fetchImpl: fetchMock });
  const service = new RemoteWorkspaceService({
    blaxelClient,
    credentialsService,
    machinesService,
    readThreadRunner: async () => null,
  });

  service.observeResponse("thread/start", {
    thread: {
      id: "th-remote-1",
      runner: {
        providerId: "blaxel",
        workspace: "/workspace",
        config: { sandbox_name: "demo-sbx", working_dir: "/workspace", workspace: "vexscm" },
      },
    },
  });

  const wsId = remoteWorkspaceIdForThread("th-remote-1");

  // 1. Root enumeration & directory listing (skips .git, dirs before files)
  const roots = await service.listWorkspaceFileChildren({ workspaceId: wsId });
  expect(roots.entries).toHaveLength(1);
  expect(roots.entries[0]).toMatchObject({ rootId: "remote-root", path: "", kind: "directory", hasChildren: true });

  const children = await service.listWorkspaceFileChildren({ workspaceId: wsId, rootId: "remote-root" });
  expect(children.entries.map((entry) => `${entry.kind}:${entry.path}`)).toEqual(["directory:src", "file:README.md"]);

  // 2. File read (UTF-8 & binary) + path traversal guard
  const readme = await service.readWorkspaceFile({ workspaceId: wsId, path: "README.md" });
  expect(readme.encoding).toBe("utf8");
  expect(readme.text).toBe("# Remote Demo\n");

  const binary = await service.readWorkspaceFile({ workspaceId: wsId, path: "logo.png" });
  expect(binary.encoding).toBe("binary");

  await expect(service.readWorkspaceFile({ workspaceId: wsId, path: "../etc/passwd" })).rejects.toThrow(/within/i);

  // 3. Query search (also proves 503 standby retry worked!)
  const query = await service.queryWorkspaceFiles({ workspaceId: wsId, query: "app" });
  expect(query.matches[0]?.entry.path).toBe("src/app.ts");
  expect(query.indexedFileCount).toBe(2);

  // 4. Git changes list & unified diff read
  const changes = await service.listVcsChanges({ workspaceId: wsId });
  expect(changes.status.activeLine?.name).toBe("main");
  expect(changes.files).toEqual([
    expect.objectContaining({
      path: "src/app.ts",
      status: "modified",
      areas: ["unstaged"],
      additions: 4,
      deletions: 1,
    }),
    expect.objectContaining({
      path: "notes.txt",
      status: "untracked",
      areas: ["untracked"],
      additions: 2,
      deletions: 0,
    }),
  ]);

  const diff = await service.readVcsChange({ workspaceId: wsId, path: "src/app.ts", area: "unstaged" });
  expect(diff.binary).toBe(false);
  expect(diff.content).toContain("+new");

  // 5. Machine-backed remote workspace ID resolution (for /new staging)
  const machineWsId = remoteWorkspaceIdForMachine(machine.id);
  const machineStatus = await service.workspaceFilesStatus(machineWsId);
  expect(machineStatus.status.state).toBe("ready");
  expect(machineStatus.status.roots[0]?.name).toBe("Blaxel Dev");
});

test("parseFindIndexOutput, parseRemoteGitStatusOutput, and paginateUnifiedDiff handle edge cases", () => {
  const index = parseFindIndexOutput(".\n./a\n./a/b\n===RODER_FILES===\n./a/b/c.ts\n");
  expect(index.directoryCount).toBe(2);
  expect(index.fileCount).toBe(1);

  const git = parseRemoteGitStatusOutput(
    [
      "===RODER_ROOT===",
      "/workspace",
      "===RODER_BRANCH===",
      "(unborn)",
      "===RODER_STATUS===",
      "A  new-file.ts",
      "R  old.ts -> renamed.ts",
      "===RODER_STAGED_NUMSTAT===",
      "10\t0\tnew-file.ts",
      "-\t-\trenamed.ts",
    ].join("\n"),
    "/workspace",
  );
  expect(git.files[0]).toMatchObject({ path: "new-file.ts", status: "added", areas: ["staged"], additions: 10 });
  expect(git.files[1]).toMatchObject({ path: "renamed.ts", oldPath: "old.ts", status: "renamed", binary: true });

  const binaryDiff = paginateUnifiedDiff("img.png", "Binary files a/img.png and b/img.png differ\n", 0, 100);
  expect(binaryDiff.binary).toBe(true);
  expect(binaryDiff.content).toBeNull();
});

test("BlaxelTerminalSession connects over wss /terminal/ws with header auth and workingDir (no token in URL)", () => {
  const wsUrl = buildBlaxelTerminalWsUrl({
    sandboxUrl: "https://sbx-demo.bl.run",
    cols: 120,
    rows: 36,
    sessionId: "roder-test",
    workingDir: "/workspace",
  });
  expect(wsUrl).toBe("wss://sbx-demo.bl.run/terminal/ws?cols=120&rows=36&sessionId=roder-test&workingDir=%2Fworkspace");
  expect(wsUrl).not.toContain("token=");

  const sent: string[] = [];
  let capturedHeaders: Record<string, string> = {};
  const fakeSocket = new EventEmitter() as unknown as WebSocket & {
    readyState: number;
    send: (data: string) => void;
    close: () => void;
    addEventListener: (event: string, listener: (payload?: unknown) => void) => void;
  };
  fakeSocket.readyState = 0;
  fakeSocket.send = (data: string) => sent.push(data);
  fakeSocket.close = () => {
    fakeSocket.readyState = 3;
    (fakeSocket as unknown as EventEmitter).emit("close", { code: 1000 });
  };
  fakeSocket.addEventListener = (event: string, listener: (payload?: unknown) => void) => {
    (fakeSocket as unknown as EventEmitter).on(event, listener);
  };

  const session = new BlaxelTerminalSession({
    sandboxUrl: "https://sbx-demo.bl.run",
    auth: { apiKey: "bl_secret_ws_key", workspace: "vexscm" },
    sessionId: "roder-test",
    workingDir: "/workspace",
    cols: 80,
    rows: 24,
    createWebSocket: (_url, headers) => {
      capturedHeaders = headers;
      return fakeSocket;
    },
  });

  expect(capturedHeaders).toEqual({
    Authorization: "Bearer bl_secret_ws_key",
    "X-Blaxel-Workspace": "vexscm",
  });

  const received: string[] = [];
  session.on("data", (chunk: string) => received.push(chunk));

  // Queued write before open should flush on open
  session.write("ls\n");
  fakeSocket.readyState = 1;
  (fakeSocket as unknown as EventEmitter).emit("open");
  expect(sent).toEqual([JSON.stringify({ type: "input", data: "ls\n" })]);

  session.resize(100, 40);
  expect(sent[1]).toBe(JSON.stringify({ type: "resize", cols: 100, rows: 40 }));

  (fakeSocket as unknown as EventEmitter).emit("message", {
    data: JSON.stringify({ type: "output", data: "hello.txt\r\n" }),
  });
  expect(received).toEqual(["hello.txt\r\n"]);
  session.kill();
});

test("RemoteWorkspaceService injects remote-roder over a private Blaxel WSS tunnel and translates workspace IDs & notifications", async () => {
  expect(previewHttpUrlToWsUrl("https://abc.preview.bl.run/")).toBe("wss://abc.preview.bl.run");
  expect(buildRemoteRoderInstallScript("/workspace")).toContain("remote-roder-${target}");

  const dir = await mkdtemp(join(tmpdir(), "roder-remote-tunnel-"));
  tempDirs.push(dir);
  const credentialsService = new CloudCredentialsService(createCryptoOptions(join(dir, "creds.enc")));
  const machinesService = new CloudMachinesService(createCryptoOptions(join(dir, "machines.enc")));
  await credentialsService.saveBlaxel({ apiKey: "bl_tunnel_key_123456", workspace: "vexscm" });

  const processNames: string[] = [];
  let previewRequestBody: Record<string, unknown> | null = null;
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "https://api.blaxel.ai/v0/sandboxes/glibc-sbx") {
      return new Response(
        JSON.stringify({
          metadata: { name: "glibc-sbx", workspace: "vexscm", url: "https://sbx-glibc.bl.run" },
          spec: { region: "us-pdx-1" },
          status: "DEPLOYED",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url === "https://api.blaxel.ai/v0/sandboxes/glibc-sbx/previews" && init?.method === "POST") {
      previewRequestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          metadata: { name: "roder-app-server" },
          spec: { port: 17373, public: false, url: "https://priv-tunnel.preview.bl.run" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url === "https://sbx-glibc.bl.run/health") {
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }
    if (url === "https://sbx-glibc.bl.run/filesystem//workspace") {
      return new Response(JSON.stringify({ path: "/workspace" }), { status: 200 });
    }
    if (url === "https://sbx-glibc.bl.run/process") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { name?: string };
      if (body.name) processNames.push(body.name);
      if (body.name === "roder-bridge-probe") {
        return new Response(JSON.stringify({ exitCode: 0, stdout: "NEED_START\n" }), { status: 200 });
      }
      return new Response(JSON.stringify({ exitCode: 0, stdout: "READY\n" }), { status: 200 });
    }
    return new Response("Not Found", { status: 404 });
  });

  let capturedWsUrl = "";
  let capturedHeaders: Record<string, string> = {};
  let capturedProtocols: string[] = [];
  const fakeSocket = new EventEmitter() as unknown as WebSocket & {
    readyState: number;
    send: (data: string) => void;
    close: () => void;
    addEventListener: (event: string, listener: (payload?: unknown) => void) => void;
  };
  fakeSocket.readyState = 0;
  fakeSocket.addEventListener = (event: string, listener: (payload?: unknown) => void) => {
    (fakeSocket as unknown as EventEmitter).on(event, listener);
  };
  fakeSocket.close = () => {
    fakeSocket.readyState = 3;
    (fakeSocket as unknown as EventEmitter).emit("close", { code: 1000 });
  };

  const remoteRpcCalls: Array<{ method: string; params: Record<string, unknown> }> = [];
  fakeSocket.send = (raw: string) => {
    const req = JSON.parse(raw) as { id: number; method: string; params: Record<string, unknown> };
    remoteRpcCalls.push({ method: req.method, params: req.params });
    let result: unknown = {};
    if (req.method === "initialize") {
      result = { cwd: "/workspace", remote: { authenticated: true } };
    } else if (req.method === "workspace/list") {
      result = { workspaces: [] };
    } else if (req.method === "workspace/create") {
      result = {
        workspace: {
          id: "ws_remote_99",
          defaultRootId: "root_remote_99",
          roots: [{ id: "root_remote_99", path: "/workspace", name: "glibc-sbx" }],
        },
      };
    } else if (req.method === "workspace/files/children") {
      result = {
        status: {
          workspaceId: "ws_remote_99",
          state: "ready",
          stale: false,
          roots: [{ rootId: "root_remote_99", name: "workspace" }],
          fileCount: 1,
          directoryCount: 0,
        },
        entries: [
          {
            rootId: "root_remote_99",
            rootName: "workspace",
            path: "README.md",
            name: "README.md",
            kind: "file",
            hasChildren: false,
          },
        ],
      };
    } else if (req.method === "vcs/changes/list") {
      result = {
        status: {
          provider: { id: "git", displayName: "Git" },
          workspace: { root: "/workspace", id: "root_remote_99" },
          changedFileCount: 1,
        },
        files: [
          { path: "README.md", status: "modified", areas: ["unstaged"], additions: 2, deletions: 0, binary: false },
        ],
        totals: { files: 1, additions: 2, deletions: 0 },
      };
    }
    queueMicrotask(() => {
      (fakeSocket as unknown as EventEmitter).emit("message", {
        data: JSON.stringify({ jsonrpc: "2.0", id: req.id, result }),
      });
    });
  };

  const blaxelClient = new BlaxelClient({ fetchImpl: fetchMock });
  const tunnelManager = new RemoteRoderTunnelManager({
    blaxelClient,
    createWebSocket: (url, init) => {
      capturedWsUrl = url;
      capturedHeaders = init.headers;
      capturedProtocols = init.protocols;
      queueMicrotask(() => {
        fakeSocket.readyState = 1;
        (fakeSocket as unknown as EventEmitter).emit("open");
      });
      return fakeSocket;
    },
  });
  const service = new RemoteWorkspaceService({
    blaxelClient,
    credentialsService,
    machinesService,
    tunnelManager,
    readThreadRunner: async () => null,
  });

  service.observeResponse("thread/start", {
    thread: {
      id: "th-tunnel-1",
      runner: {
        providerId: "blaxel",
        workspace: "/workspace",
        config: { sandbox_name: "glibc-sbx", working_dir: "/workspace", workspace: "vexscm" },
      },
    },
  });

  const desktopWsId = remoteWorkspaceIdForThread("th-tunnel-1");
  const notifications: unknown[] = [];
  service.on("notification", (n) => notifications.push(n));

  const children = (await service.proxyRequest("workspace/files/children", {
    workspaceId: desktopWsId,
    rootId: "remote-root",
  })) as { status: { workspaceId: string }; entries: Array<{ rootId: string; path: string }> };

  // Proves binary install -> daemon start -> private Blaxel preview -> double-authenticated WSS tunnel -> workspace ID rewriting!
  expect(processNames).toContain("roder-bridge-install");
  expect(processNames).toContain("roder-app-server");
  expect(previewRequestBody).toEqual({
    metadata: { name: "roder-app-server" },
    spec: { port: 17373, public: false },
  });
  expect(capturedWsUrl).toBe("wss://priv-tunnel.preview.bl.run");
  expect(capturedHeaders["X-Blaxel-Authorization"]).toBe("Bearer bl_tunnel_key_123456");
  expect(capturedHeaders["X-Blaxel-Workspace"]).toBe("vexscm");
  expect(capturedHeaders.Authorization).toMatch(/^Bearer /);
  expect(capturedProtocols[0]).toBe("roder.remote.v1");

  expect(remoteRpcCalls.map((call) => call.method)).toEqual([
    "initialize",
    "workspace/list",
    "workspace/create",
    "workspace/files/children",
  ]);
  expect(remoteRpcCalls[3]?.params).toEqual({ workspaceId: "ws_remote_99", rootId: "root_remote_99" });
  expect(children.status.workspaceId).toBe(desktopWsId);
  expect(children.entries[0]).toMatchObject({ rootId: "remote-root", path: "README.md" });

  // Verify remote notifications are translated back to desktop's synthetic workspaceId!
  (fakeSocket as unknown as EventEmitter).emit("message", {
    data: JSON.stringify({
      method: "workspace/files/statusChanged",
      params: { status: { workspaceId: "ws_remote_99", state: "ready", stale: false, roots: [] } },
    }),
  });
  expect(notifications).toEqual([
    {
      method: "workspace/files/statusChanged",
      params: { status: { workspaceId: desktopWsId, state: "ready", stale: false, roots: [] } },
    },
  ]);

  // Verify VCS calls reuse the same open tunnel without re-bootstrapping!
  const vcs = (await service.proxyRequest("vcs/changes/list", {
    workspaceId: desktopWsId,
    rootId: "remote-root",
  })) as { files: Array<{ path: string }>; status: { workspace: { id: string } } };
  expect(vcs.files[0]?.path).toBe("README.md");
  expect(vcs.status.workspace.id).toBe("remote-root");

  const status = await service.getStatus(desktopWsId);
  expect(status.bridgeMode).toBe("remote-roder-tunnel");

  service.closeAll();
});

test("BlaxelClient.createPreview reuses an existing matching preview without hitting 409", async () => {
  const calls: string[] = [];
  const client = new BlaxelClient({
    fetchImpl: async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (method === "GET" && url.endsWith("/sandboxes/demo-sbx/previews/roder-app-server")) {
        return new Response(
          JSON.stringify({
            metadata: { name: "roder-app-server" },
            spec: { port: 17373, public: false, url: "https://existing.preview.bl.run" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "should not create duplicate" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  const preview = await client.createPreview({ apiKey: "bl_key_123", workspace: "vexscm" }, "demo-sbx", 17373, {
    name: "roder-app-server",
    public: false,
  });
  expect(preview).toEqual({ url: "https://existing.preview.bl.run", name: "roder-app-server" });
  expect(calls).toEqual(["GET https://api.blaxel.ai/v0/sandboxes/demo-sbx/previews/roder-app-server"]);
});

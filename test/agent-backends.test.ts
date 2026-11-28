import { EventEmitter } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentBackendsManager,
  findAntigravityRuntime,
  findCodexRuntime,
  resolveAntigravitySetupCommand,
  resolveCodexSetupCommand,
  runtimePathExtraEnv,
  type AgentBackendsSnapshot,
  type ExternalBackendClient,
} from "../electron/roder/agent-backends";
import type { ExternalAgentBackendId } from "../electron/roder/desktop-backend";

// oxlint-disable-next-line typescript/no-explicit-any -- loose signature for test doubles
type AnyFn = (...args: any[]) => any;

class FakeBackendClient extends EventEmitter implements ExternalBackendClient {
  start = vi.fn<AnyFn>().mockResolvedValue({ state: "ready" });
  request = vi.fn<AnyFn>();
  stop = vi.fn<AnyFn>().mockResolvedValue(undefined);
}

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "roder-agent-backends-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("CLI runtime discovery", () => {
  it("prefers Roder's managed Antigravity runtime over agy on PATH", () => {
    const root = makeTempDir();
    const managedDir = join(root, "roder", "tools", "antigravity", "linux_amd64");
    const versionDir = join(managedDir, "versions", "1.5.18");
    const managedBin = join(versionDir, "antigravity");
    mkdirSync(versionDir, { recursive: true });
    writeFileSync(managedBin, "#!/bin/sh\necho 1.5.18\n");
    chmodSync(managedBin, 0o755);
    writeFileSync(join(managedDir, "active.json"), JSON.stringify({ release: "1.5.18" }));

    const pathDir = join(root, "bin");
    const pathBin = join(pathDir, "agy");
    mkdirSync(pathDir, { recursive: true });
    writeFileSync(pathBin, "#!/bin/sh\necho 1.5.1\n");
    chmodSync(pathBin, 0o755);

    const found = findAntigravityRuntime({
      env: { RODER_CONFIG_DIR: join(root, "roder"), PATH: pathDir },
      homeDir: root,
      platform: "linux",
      arch: "x64",
    });

    expect(found).toBe(managedBin);
  });

  it("ignores unsafe release names in active.json and falls back to common user install directories", () => {
    const root = makeTempDir();
    const managedDir = join(root, "roder", "tools", "antigravity", "darwin_arm64");
    mkdirSync(managedDir, { recursive: true });
    writeFileSync(join(managedDir, "active.json"), JSON.stringify({ release: "../escape" }));

    const miseShims = join(root, ".local", "share", "mise", "shims");
    const agyBin = join(miseShims, "agy");
    mkdirSync(miseShims, { recursive: true });
    writeFileSync(agyBin, "#!/bin/sh\necho 1.5.18\n");
    chmodSync(agyBin, 0o755);

    const found = findAntigravityRuntime({
      env: { RODER_CONFIG_DIR: join(root, "roder"), PATH: "/usr/bin:/bin" },
      homeDir: root,
      platform: "darwin",
      arch: "arm64",
    });

    expect(found).toBe(agyBin);
    expect(runtimePathExtraEnv({ PATH: "/usr/bin:/bin" }, found)).toEqual({
      PATH: `${miseShims}:/usr/bin:/bin`,
    });
  });

  it("discovers codex CLI in common user install folders for packaged macOS/Linux launches", () => {
    const root = makeTempDir();
    const wrappersDir = join(root, ".local", "share", "mise", "command-wrappers", "bin");
    const codexBin = join(wrappersDir, "codex");
    mkdirSync(wrappersDir, { recursive: true });
    writeFileSync(codexBin, "#!/bin/sh\necho 0.172.0\n");
    chmodSync(codexBin, 0o755);

    const found = findCodexRuntime({
      env: { PATH: "/usr/bin:/bin" },
      homeDir: root,
      platform: "darwin",
    });
    expect(found).toBe(codexBin);
  });
});

describe("Setup commands", () => {
  it("resolves Antigravity login vs guided install commands", () => {
    expect(
      resolveAntigravitySetupCommand({
        binaryPath: "/app/resources/bin/roder",
        runtimePath: "/usr/local/bin/agy",
        mode: "login",
      }),
    ).toEqual({
      executable: "/app/resources/bin/roder",
      args: ["auth", "login", "antigravity"],
      mode: "login",
    });

    expect(
      resolveAntigravitySetupCommand({
        binaryPath: "/app/resources/bin/roder",
        runtimePath: null,
        mode: "login",
      }),
    ).toEqual({
      executable: "/app/resources/bin/roder",
      args: ["--backend", "antigravity"],
      mode: "install",
    });
  });

  it("resolves Codex login command and throws a clear install error when codex CLI is missing", () => {
    expect(resolveCodexSetupCommand({ runtimePath: "/usr/local/bin/codex" })).toEqual({
      executable: "/usr/local/bin/codex",
      args: ["login"],
    });
    expect(() => resolveCodexSetupCommand({ runtimePath: null })).toThrow(/npm i -g @openai\/codex/);
  });
});

describe("AgentBackendsManager", () => {
  it("supports selecting, persisting, and switching between Roder, Codex, and Antigravity backends", async () => {
    const storagePath = join(makeTempDir(), "agent-backends.json");
    const codexClient = new FakeBackendClient();
    const antigravityClient = new FakeBackendClient();

    codexClient.request.mockImplementation(async (method: string) => {
      if (method === "model/list") {
        return {
          models: [
            {
              id: "gpt-6.2-sol",
              name: "GPT-6.2-Sol",
              modelProvider: "codex",
              defaultReasoningEffort: "high",
              reasoningEfforts: ["low", "medium", "high"],
              isDefault: true,
            },
          ],
        };
      }
      throw new Error(`Unexpected codex method ${method}`);
    });
    antigravityClient.request.mockImplementation(async (method: string) => {
      if (method === "model/list") {
        return {
          models: [
            {
              id: "gemini-3.1-pro",
              name: "Gemini 3.1 Pro",
              modelProvider: "antigravity",
              defaultReasoningEffort: "high",
              reasoningEfforts: ["low", "high"],
              isDefault: true,
            },
          ],
        };
      }
      throw new Error(`Unexpected antigravity method ${method}`);
    });

    const snapshots: AgentBackendsSnapshot[] = [];
    const manager = new AgentBackendsManager({
      createClient: (backend) => (backend === "codex" ? codexClient : antigravityClient),
      findRuntime: (backend) => (backend === "codex" ? "/usr/local/bin/codex" : "/usr/local/bin/agy"),
      storagePath,
      onChanged: (snapshot) => snapshots.push(snapshot),
    });

    expect(manager.getActiveBackend()).toBe("roder");

    const codexSnap = await manager.selectBackend("codex");
    expect(codexSnap.activeBackend).toBe("codex");
    expect(codexSnap.backends.codex).toMatchObject({
      connected: true,
      modelCount: 1,
      models: [{ id: "gpt-6.2-sol", modelProvider: "codex" }],
    });

    const agSnap = await manager.selectBackend("antigravity");
    expect(agSnap.activeBackend).toBe("antigravity");
    expect(agSnap.backends.antigravity).toMatchObject({
      connected: true,
      modelCount: 1,
      models: [{ id: "gemini-3.1-pro", modelProvider: "antigravity" }],
    });

    // Persisted activeBackend survives restart.
    const reloaded = new AgentBackendsManager({
      createClient: (backend) => (backend === "codex" ? codexClient : antigravityClient),
      findRuntime: () => "/usr/local/bin/agy",
      storagePath,
    });
    await reloaded.hydrate();
    expect(reloaded.getActiveBackend()).toBe("antigravity");
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
  });

  it("routes threads, history reads, approvals, and persistence independently for Codex and Antigravity", async () => {
    const storagePath = join(makeTempDir(), "agent-backends.json");
    const clients: Record<ExternalAgentBackendId, FakeBackendClient> = {
      codex: new FakeBackendClient(),
      antigravity: new FakeBackendClient(),
    };

    for (const backend of ["codex", "antigravity"] as const) {
      const modelId = backend === "codex" ? "gpt-6.2-sol" : "gemini-3.1-pro";
      const threadId = backend === "codex" ? "codex-thread-1" : "ag-thread-1";
      clients[backend].request.mockImplementation(async (method: string, params: Record<string, unknown>) => {
        if (method === "model/list") {
          return { models: [{ id: modelId, name: modelId, modelProvider: backend, isDefault: true }] };
        }
        if (method === "thread/start") {
          return {
            model: modelId,
            modelProvider: backend,
            reasoning: "high",
            cwd: params.cwd,
            workspaceId: params.workspaceId,
            rootId: params.rootId,
            thread: {
              id: threadId,
              preview: "",
              modelProvider: backend,
              model: modelId,
              createdAt: 1700000000,
              updatedAt: 1700000000,
              status: { type: "idle", activeTurnId: null, activeFlags: [] },
              cwd: params.cwd,
              workspaceId: params.workspaceId,
              rootId: params.rootId,
            },
          };
        }
        if (method === "thread/read") {
          return {
            thread: {
              id: params.threadId,
              preview: "",
              modelProvider: backend,
              model: modelId,
              createdAt: 1700000000,
              updatedAt: 1700000020,
              status: { type: "idle", activeTurnId: null, activeFlags: [] },
              cwd: "",
              workspaceId: "",
              rootId: "",
              turns: [],
            },
          };
        }
        if (method === "turn/start") return { turnId: `${backend}-turn-1` };
        if (method === "thread/resolve_approval") return { resolved: true };
        if (method === "thread/archive") return { threadId: params.threadId, archived: true };
        throw new Error(`Unexpected ${backend} method ${method}`);
      });
    }

    const manager = new AgentBackendsManager({
      createClient: (backend) => clients[backend],
      findRuntime: (backend) => `/usr/local/bin/${backend === "codex" ? "codex" : "agy"}`,
      storagePath,
    });

    await expect(
      manager.handleRequest("codex", "thread/start", { desktopCloudMachineId: "machine-1" }),
    ).rejects.toThrow(/remote cloud machines/i);

    const codexStarted = (await manager.handleRequest("codex", "thread/start", {
      model: "gpt-6.2-sol",
      workspaceId: "ws-1",
      rootId: "root-1",
      cwd: "/repo/app",
      initialPrompt: "Run Codex backend",
    })) as { thread: { id: string; agentBackend: string } };
    expect(codexStarted.thread).toMatchObject({ id: "codex-thread-1", agentBackend: "codex" });

    const agStarted = (await manager.handleRequest("antigravity", "thread/start", {
      model: "gemini-3.1-pro",
      workspaceId: "ws-1",
      rootId: "root-1",
      cwd: "/repo/app",
      initialPrompt: "Run Antigravity backend",
    })) as { thread: { id: string; agentBackend: string } };
    expect(agStarted.thread).toMatchObject({ id: "ag-thread-1", agentBackend: "antigravity" });

    // Approvals route back to the exact sidecar that emitted them.
    clients.codex.emit("notification", {
      method: "thread/approval_requested",
      params: { threadId: "codex-thread-1", approvalId: "codex-appr-1" },
    });
    clients.antigravity.emit("notification", {
      method: "thread/approval_requested",
      params: { threadId: "ag-thread-1", approvalId: "ag-appr-1" },
    });
    expect(manager.backendForApproval("codex-appr-1")).toBe("codex");
    expect(manager.backendForApproval("ag-appr-1")).toBe("antigravity");
    await manager.handleRequest("codex", "thread/resolve_approval", { approvalId: "codex-appr-1", approved: true });
    expect(manager.backendForApproval("codex-appr-1")).toBeNull();

    // Restarted manager hydrates BOTH Codex and Antigravity threads and translates thread/history/read.
    const restarted = new AgentBackendsManager({
      createClient: (backend) => clients[backend],
      findRuntime: () => "/usr/local/bin/tool",
      storagePath,
    });
    await restarted.hydrate();
    expect(restarted.backendForThread("codex-thread-1")).toBe("codex");
    expect(restarted.backendForThread("ag-thread-1")).toBe("antigravity");

    const mergedList = restarted.mergeThreadList({ data: [] }, { limit: 50 });
    expect(mergedList.data?.map((thread) => `${thread.agentBackend}:${thread.id}`).sort()).toEqual([
      "antigravity:ag-thread-1",
      "codex:codex-thread-1",
    ]);

    const codexHistory = (await restarted.handleRequest("codex", "thread/history/read", {
      threadId: "codex-thread-1",
    })) as { thread: { workspaceId: string; rootId: string; cwd: string; agentBackend: string }; hasMore: boolean };
    expect(codexHistory).toMatchObject({
      hasMore: false,
      thread: { workspaceId: "ws-1", rootId: "root-1", cwd: "/repo/app", agentBackend: "codex" },
    });

    await restarted.handleRequest("codex", "thread/archive", { threadId: "codex-thread-1" });
    expect(restarted.backendForThread("codex-thread-1")).toBeNull();
  });

  it("falls back to roder and clears models when logging out of the active backend", async () => {
    const client = new FakeBackendClient();
    client.request.mockResolvedValue({
      models: [{ id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", modelProvider: "antigravity" }],
    });
    const runLogoutCommand = vi.fn<(backend: ExternalAgentBackendId) => Promise<void>>().mockResolvedValue(undefined);
    const manager = new AgentBackendsManager({
      createClient: () => client,
      findRuntime: () => "/usr/local/bin/agy",
      runLogoutCommand,
    });

    await manager.selectBackend("antigravity");
    expect(manager.getActiveBackend()).toBe("antigravity");

    const afterLogout = await manager.logoutBackend("antigravity");
    expect(client.stop).toHaveBeenCalledOnce();
    expect(runLogoutCommand).toHaveBeenCalledWith("antigravity");
    expect(afterLogout.activeBackend).toBe("roder");
    expect(afterLogout.backends.antigravity.connected).toBe(false);
  });

  it("steers an active Antigravity turn by interrupting, waiting for completion, and starting the steered turn", async () => {
    const client = new FakeBackendClient();
    let activeTurn: string | null = "ag-turn-1";
    const forwarded: Array<{ method: string; params: unknown }> = [];
    const seenMethods: string[] = [];

    client.request.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      seenMethods.push(method);
      if (method === "model/list") {
        return {
          models: [{ id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", modelProvider: "antigravity", isDefault: true }],
        };
      }
      if (method === "turn/steer") {
        throw new Error("Antigravity already has an active turn");
      }
      if (method === "turn/interrupt") {
        setTimeout(() => {
          activeTurn = null;
          client.emit("notification", {
            method: "turn/completed",
            params: { threadId: "ag-thread-1", turn: { id: "ag-turn-1", status: "interrupted" } },
          });
          client.emit("notification", {
            method: "thread/status/changed",
            params: { threadId: "ag-thread-1", status: { type: "idle", activeTurnId: null, activeFlags: [] } },
          });
        }, 10);
        return { turnId: params?.turnId ?? "ag-turn-1" };
      }
      if (method === "turn/start") {
        if (activeTurn) {
          throw new Error("Antigravity already has an active turn");
        }
        activeTurn = "ag-turn-2";
        return { turnId: "ag-turn-2" };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    const manager = new AgentBackendsManager({
      createClient: () => client,
      findRuntime: () => "/usr/local/bin/agy",
      onNotification: (payload) => forwarded.push(payload),
    });

    await manager.selectBackend("antigravity");
    const steered = (await manager.handleRequest("antigravity", "turn/steer", {
      threadId: "ag-thread-1",
      expectedTurnId: "ag-turn-1",
      prompt: "is it implemented?",
    })) as { turnId: string };

    expect(steered).toEqual({ turnId: "ag-turn-2" });
    expect(seenMethods).toEqual(["model/list", "turn/steer", "turn/interrupt", "turn/start"]);
    // Intermediate idle thread/status/changed is suppressed while steering replaces the turn.
    expect(forwarded.some((item) => item.method === "thread/status/changed")).toBe(false);
    expect(forwarded.some((item) => item.method === "turn/completed")).toBe(true);

    // Direct turn/start also recovers seamlessly if Antigravity still holds an active turn.
    const started = (await manager.handleRequest("antigravity", "turn/start", {
      threadId: "ag-thread-1",
      prompt: "switch focus now",
    })) as { turnId: string };
    expect(started).toEqual({ turnId: "ag-turn-2" });
  });
});

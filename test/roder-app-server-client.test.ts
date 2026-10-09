import type { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

type MockStream = EventEmitter & { setEncoding: (encoding: string) => void };
type MockStdin = EventEmitter & {
  write: (line: string, callback?: (error?: Error | null) => void) => boolean;
};
type MockChildProcess = EventEmitter & {
  stdin: MockStdin;
  stdout: MockStream;
  stderr: MockStream;
  kill: () => void;
  writtenMethods: string[];
};
type SpawnMock = (
  command: string,
  args: string[],
  options: { env?: Record<string, string | undefined> },
) => MockChildProcess;
type SpawnSyncMock = (
  command: string,
  args: string[],
  options: { env?: Record<string, string | undefined>; timeout?: number },
) => { status: number; stdout: string };

const mockState = vi.hoisted(() => ({
  app: {
    isPackaged: false,
    getVersion: vi.fn<() => string>(() => "9.8.7"),
  },
  existsSync: vi.fn<() => boolean>(() => true),
  spawned: [] as Array<{
    command: string;
    args: string[];
    options: { env?: Record<string, string | undefined> };
  }>,
  spawnSyncCalls: [] as Array<{
    command: string;
    args: string[];
    options: { env?: Record<string, string | undefined>; timeout?: number };
  }>,
  schemaManifest: {
    methods: [
      { method: "initialize" },
      { method: "thread/list" },
      { method: "vcs/changes/list" },
      { method: "vcs/changes/read" },
      { method: "workspace/changes/list" },
    ],
  },
  requests: [] as Array<{
    id: number;
    method: string;
    params: unknown;
  }>,
  children: [] as MockChildProcess[],
  // Methods in this set are written to stdin but never answered, so tests can
  // exercise timeouts and late replies.
  silentMethods: new Set<string>(),
}));

vi.mock("electron", () => ({
  app: mockState.app,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: mockState.existsSync,
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { EventEmitter: NodeEventEmitter } = await import("node:events");

  return {
    ...actual,
    spawn: vi.fn<SpawnMock>((command, args, options) => {
      const stdout = new NodeEventEmitter() as MockStream;
      const stderr = new NodeEventEmitter() as MockStream;
      const stdin = new NodeEventEmitter() as MockStdin;
      const child = new NodeEventEmitter() as MockChildProcess;

      stdout.setEncoding = vi.fn<(encoding: string) => void>();
      stderr.setEncoding = vi.fn<(encoding: string) => void>();
      child.stdout = stdout;
      child.stderr = stderr;
      child.kill = vi.fn<() => void>();
      child.writtenMethods = [];
      stdin.write = vi.fn<MockStdin["write"]>((line, callback) => {
        const request = JSON.parse(line.trim());
        mockState.requests.push(request);
        child.writtenMethods.push(request.method);
        queueMicrotask(() => {
          callback?.();
          if (!mockState.silentMethods.has(request.method)) {
            stdout.emit("data", `${JSON.stringify({ id: request.id, result: { ok: true } })}\n`);
          }
        });
        return true;
      });
      child.stdin = stdin;

      mockState.spawned.push({ command, args, options });
      mockState.children.push(child);
      return child;
    }),
    spawnSync: vi.fn<SpawnSyncMock>((command, args, options) => {
      mockState.spawnSyncCalls.push({ command, args, options });
      return { status: 0, stdout: JSON.stringify(mockState.schemaManifest) };
    }),
  };
});

beforeEach(() => {
  vi.resetModules();
  mockState.app.isPackaged = false;
  mockState.app.getVersion.mockReturnValue("9.8.7");
  mockState.existsSync.mockReturnValue(true);
  mockState.spawned.length = 0;
  mockState.spawnSyncCalls.length = 0;
  mockState.requests.length = 0;
  mockState.children.length = 0;
  mockState.silentMethods.clear();
  Object.defineProperty(process, "resourcesPath", {
    value: "/tmp/roder-test-resources",
    configurable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function respond(child: MockChildProcess, id: number, result: unknown): void {
  child.stdout.emit("data", `${JSON.stringify({ id, result })}\n`);
}

function lastRequestId(method: string): number {
  const request = [...mockState.requests].reverse().find((entry) => entry.method === method);
  if (!request) {
    throw new Error(`no ${method} request was written`);
  }
  return request.id;
}

test("forwards inference routing decision notifications from the app-server", async () => {
  const { RoderAppServerClient } = await import("../electron/roder/app-server-client");

  const client = new RoderAppServerClient();
  const notifications: unknown[] = [];
  client.on("notification", (notification) => notifications.push(notification));
  await client.start();

  const child = mockState.children[0];
  child.stdout.emit(
    "data",
    `${JSON.stringify({
      method: "inference/routing/decision",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        defaultSelection: { provider: "openai", model: "gpt-5.5" },
        selectedSelection: { provider: "anthropic", model: "claude-sonnet-5" },
        decision: {
          routerId: "local",
          outcome: "escalated",
          reason: "Large diff and test failure signals",
        },
        timestamp: "2026-06-08T12:00:00Z",
      },
    })}\n`,
  );

  expect(notifications).toEqual([
    {
      method: "inference/routing/decision",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        defaultSelection: { provider: "openai", model: "gpt-5.5" },
        selectedSelection: { provider: "anthropic", model: "claude-sonnet-5" },
        decision: {
          routerId: "local",
          outcome: "escalated",
          reason: "Large diff and test failure signals",
        },
        timestamp: "2026-06-08T12:00:00Z",
      },
    },
  ]);
});

test("starts the app-server over stdio and initializes desktop capabilities", async () => {
  const { RoderAppServerClient } = await import("../electron/roder/app-server-client");

  const client = new RoderAppServerClient();
  const status = await client.start();

  expect(status.state).toBe("ready");
  expect(status.appServerMethods).toEqual([
    "initialize",
    "thread/list",
    "vcs/changes/list",
    "vcs/changes/read",
    "workspace/changes/list",
  ]);
  expect(mockState.spawnSyncCalls).toEqual([
    expect.objectContaining({
      args: ["app-server", "schema", "--format", "manifest"],
      options: expect.objectContaining({
        timeout: 5000,
        env: process.env,
      }),
    }),
  ]);
  expect(mockState.spawned).toEqual([
    expect.objectContaining({
      args: ["app-server", "--listen", "stdio://"],
      options: expect.objectContaining({
        env: process.env,
      }),
    }),
  ]);
  expect(mockState.requests).toEqual([
    {
      id: 1,
      method: "initialize",
      params: {
        clientInfo: {
          name: "roder-desktop",
          title: "Roder Desktop",
          version: "9.8.7",
        },
        capabilities: {
          experimentalApi: true,
        },
      },
    },
  ]);
});

test("a stopped engine's late exit does not clobber its replacement after restart", async () => {
  const { RoderAppServerClient } = await import("../electron/roder/app-server-client");

  const client = new RoderAppServerClient();
  await client.start();
  const oldChild = mockState.children[0];
  await client.restart();
  const newChild = mockState.children[1];

  oldChild.emit("exit", 0, null);

  expect(client.status().state).toBe("ready");
  expect(await client.request("thread/list", {})).toEqual({ ok: true });
  expect(mockState.spawned).toHaveLength(2);
  expect(newChild.writtenMethods).toContain("thread/list");
});

test("a stopped engine's late exit does not reject requests in flight on its replacement", async () => {
  const { RoderAppServerClient } = await import("../electron/roder/app-server-client");

  const client = new RoderAppServerClient();
  await client.start();
  const oldChild = mockState.children[0];
  await client.restart();
  const newChild = mockState.children[1];

  mockState.silentMethods.add("thread/list");
  const pending = client.request("thread/list", {});
  oldChild.emit("exit", 0, null);
  respond(newChild, lastRequestId("thread/list"), { threads: [] });

  await expect(pending).resolves.toEqual({ threads: [] });
});

test("a partial line left by a stopped engine does not corrupt its replacement's output", async () => {
  const { RoderAppServerClient } = await import("../electron/roder/app-server-client");

  const client = new RoderAppServerClient();
  await client.start();
  mockState.children[0].stdout.emit("data", '{"id":99,"res');

  await client.restart();

  expect(client.status().state).toBe("ready");
});

test("a stdin error with no other listener rejects the pending request without throwing", async () => {
  const { RoderAppServerClient } = await import("../electron/roder/app-server-client");

  const client = new RoderAppServerClient();
  await client.start();
  const child = mockState.children[0];

  mockState.silentMethods.add("thread/list");
  const pending = client.request("thread/list", {});
  const epipe = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });

  expect(() => child.stdin.emit("error", epipe)).not.toThrow();
  await expect(pending).rejects.toThrow("write EPIPE");
});

test("stdout and stderr stream errors are reported as stderr events instead of thrown", async () => {
  const { RoderAppServerClient } = await import("../electron/roder/app-server-client");

  const client = new RoderAppServerClient();
  const stderrChunks: string[] = [];
  client.on("stderr", (chunk: string) => stderrChunks.push(chunk));
  await client.start();
  const child = mockState.children[0];

  expect(() => child.stdout.emit("error", new Error("stdout pipe broke"))).not.toThrow();
  expect(() => child.stderr.emit("error", new Error("stderr pipe broke"))).not.toThrow();

  const reported = stderrChunks.join("");
  expect(reported).toContain("stdout pipe broke");
  expect(reported).toContain("stderr pipe broke");
});

test("rejects a short-latency request whose response never arrives once its timeout passes", async () => {
  const { RoderAppServerClient } = await import("../electron/roder/app-server-client");

  const client = new RoderAppServerClient();
  await client.start();
  vi.useFakeTimers();

  mockState.silentMethods.add("thread/start");
  const pending = client.request("thread/start", { workspaceId: "ws_1" });
  const settled = vi.fn<(outcome: unknown) => void>();
  pending.then(settled, settled);

  await vi.advanceTimersByTimeAsync(59_999);
  expect(settled).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(1);
  await expect(pending).rejects.toThrow("roder app-server thread/start timed out after 60000ms");
});

test("leaves long-running methods outside the timeout table without a deadline", async () => {
  const { RoderAppServerClient } = await import("../electron/roder/app-server-client");

  const client = new RoderAppServerClient();
  await client.start();
  vi.useFakeTimers();

  mockState.silentMethods.add("thread/compact");
  const pending = client.request("thread/compact", { threadId: "thread-1" });
  const settled = vi.fn<(outcome: unknown) => void>();
  pending.then(settled, settled);

  await vi.advanceTimersByTimeAsync(10 * 60_000);
  expect(settled).not.toHaveBeenCalled();

  respond(mockState.children[0], lastRequestId("thread/compact"), { compacted: true });
  await expect(pending).resolves.toEqual({ compacted: true });
});

test("does not leave a deadline timer behind after a timely response", async () => {
  const { RoderAppServerClient } = await import("../electron/roder/app-server-client");

  const client = new RoderAppServerClient();
  await client.start();
  vi.useFakeTimers();

  await expect(client.request("thread/read", { threadId: "thread-1" })).resolves.toEqual({
    ok: true,
  });
  expect(vi.getTimerCount()).toBe(0);
});

test("kills an engine whose initialize never answers and reports the failure", async () => {
  const { RoderAppServerClient } = await import("../electron/roder/app-server-client");

  const client = new RoderAppServerClient();
  vi.useFakeTimers();
  mockState.silentMethods.add("initialize");

  const startOutcome = client.start().then(
    () => "started",
    (error: Error) => error.message,
  );
  await vi.advanceTimersByTimeAsync(30_000);
  await expect(startOutcome).resolves.toBe("roder app-server initialize timed out after 30000ms");

  const [child] = mockState.children;
  expect(child.kill).toHaveBeenCalledTimes(1);
  expect(client.status()).toEqual(
    expect.objectContaining({
      state: "error",
      message: "roder app-server initialize timed out after 30000ms",
    }),
  );

  // The killed engine's late exit must not overwrite the error status.
  child.emit("exit", null, "SIGTERM");
  expect(client.status().state).toBe("error");
});

test("starts a fresh engine on the next request after a failed initialize", async () => {
  const { RoderAppServerClient } = await import("../electron/roder/app-server-client");

  const client = new RoderAppServerClient();
  vi.useFakeTimers();
  mockState.silentMethods.add("initialize");

  const startOutcome = client.start().then(
    () => "started",
    (error: Error) => error.message,
  );
  await vi.advanceTimersByTimeAsync(30_000);
  await expect(startOutcome).resolves.toBe("roder app-server initialize timed out after 30000ms");

  mockState.silentMethods.delete("initialize");
  await expect(client.request("thread/list", {})).resolves.toEqual({ ok: true });
  expect(mockState.spawned).toHaveLength(2);
  expect(client.status().state).toBe("ready");
});

test("keeps the stopped status when stop interrupts startup", async () => {
  const { RoderAppServerClient } = await import("../electron/roder/app-server-client");

  const client = new RoderAppServerClient();
  mockState.silentMethods.add("initialize");

  const startOutcome = client.start().then(
    () => "started",
    (error: Error) => error.message,
  );
  await client.stop();
  await expect(startOutcome).resolves.toBe("roder app-server stopped");

  expect(client.status().state).toBe("stopped");
});

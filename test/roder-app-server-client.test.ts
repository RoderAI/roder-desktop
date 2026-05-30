import type { EventEmitter } from "node:events";
import { beforeEach, expect, test, vi } from "vitest";

type MockStream = EventEmitter & { setEncoding: (encoding: string) => void };
type MockChildProcess = EventEmitter & {
  stdin: { write: (line: string, callback?: (error?: Error | null) => void) => boolean };
  stdout: MockStream;
  stderr: MockStream;
  kill: () => void;
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
      { method: "git/changes/list" },
      { method: "git/changes/read" },
      { method: "workspace/changes/list" },
    ],
  },
  requests: [] as Array<{
    id: number;
    method: string;
    params: unknown;
  }>,
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
      const child = new NodeEventEmitter() as MockChildProcess;

      stdout.setEncoding = vi.fn<(encoding: string) => void>();
      stderr.setEncoding = vi.fn<(encoding: string) => void>();
      child.stdout = stdout;
      child.stderr = stderr;
      child.kill = vi.fn<() => void>();
      child.stdin = {
        write: vi.fn<MockChildProcess["stdin"]["write"]>((line, callback) => {
          const request = JSON.parse(line.trim());
          mockState.requests.push(request);
          queueMicrotask(() => {
            callback?.();
            stdout.emit("data", `${JSON.stringify({ id: request.id, result: { ok: true } })}\n`);
          });
          return true;
        }),
      };

      mockState.spawned.push({ command, args, options });
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
  Object.defineProperty(process, "resourcesPath", {
    value: "/tmp/roder-test-resources",
    configurable: true,
  });
});

test("starts the app-server over stdio and initializes desktop capabilities", async () => {
  const { RoderAppServerClient } = await import("../electron/roder/app-server-client");

  const client = new RoderAppServerClient();
  const status = await client.start();

  expect(status.state).toBe("ready");
  expect(status.appServerMethods).toEqual([
    "initialize",
    "thread/list",
    "git/changes/list",
    "git/changes/read",
    "workspace/changes/list",
  ]);
  expect(mockState.spawnSyncCalls).toEqual([
    expect.objectContaining({
      args: ["app-server", "schema", "--format", "manifest"],
      options: expect.objectContaining({
        timeout: 5000,
        env: expect.objectContaining({
          RODER_DESKTOP: "1",
        }),
      }),
    }),
  ]);
  expect(mockState.spawned).toEqual([
    expect.objectContaining({
      args: ["app-server", "--listen", "stdio://"],
      options: expect.objectContaining({
        env: expect.objectContaining({
          RODER_DESKTOP: "1",
        }),
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

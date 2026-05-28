import { beforeEach, expect, test, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  app: {
    isPackaged: false,
    getVersion: vi.fn(() => "9.8.7"),
  },
  existsSync: vi.fn(() => true),
  spawned: [] as Array<{
    command: string;
    args: string[];
    options: { env?: Record<string, string | undefined> };
  }>,
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
  const { EventEmitter } = await import("node:events");

  return {
    ...actual,
    spawn: vi.fn((command: string, args: string[], options: { env?: Record<string, string | undefined> }) => {
      const stdout = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
      const stderr = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
      const child = new EventEmitter() as EventEmitter & {
        stdin: { write: (line: string, callback?: (error?: Error | null) => void) => boolean };
        stdout: typeof stdout;
        stderr: typeof stderr;
        kill: () => void;
      };

      stdout.setEncoding = vi.fn();
      stderr.setEncoding = vi.fn();
      child.stdout = stdout;
      child.stderr = stderr;
      child.kill = vi.fn();
      child.stdin = {
        write: vi.fn((line: string, callback?: (error?: Error | null) => void) => {
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
  };
});

beforeEach(() => {
  vi.resetModules();
  mockState.app.isPackaged = false;
  mockState.app.getVersion.mockReturnValue("9.8.7");
  mockState.existsSync.mockReturnValue(true);
  mockState.spawned.length = 0;
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

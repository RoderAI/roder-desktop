import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, expect, test, vi } from "vitest";
import { createCodexImageClient, createCodexImageGenerator } from "../electron/persistent-agents/codex-image-generator";

const transport = vi.hoisted(() => ({ factory: null as null | (() => unknown) }));
vi.mock("node:child_process", () => ({ spawn: () => transport.factory!() }));

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
const canary = "fake-credential-canary-must-not-leave-native-client";

async function fixture(configResponse: unknown, rpcError = false) {
  const directory = await mkdtemp(join(tmpdir(), "codex-redaction-test-"));
  directories.push(directory);
  const requests: { method: string; params: Record<string, unknown> }[] = [];
  transport.factory = () => {
    const stdout = new PassThrough();
    const child = Object.assign(new EventEmitter(), {
      stdout,
      stderr: new PassThrough(),
      exitCode: null as number | null,
      signalCode: null as string | null,
      stdin: undefined as unknown as Writable,
      kill: () => true,
    });
    child.kill = () => {
      child.exitCode = 0;
      child.emit("exit", 0);
      return true;
    };
    child.stdin = new Writable({
      write(bytes, _encoding, callback) {
        const request = JSON.parse(bytes.toString()) as {
          id?: number;
          method: string;
          params: Record<string, unknown>;
        };
        requests.push(request);
        if (request.id !== undefined)
          queueMicrotask(() => {
            let result: unknown = {};
            if (request.method === "initialize") result = { codexHome: directory };
            if (request.method === "account/read") result = { account: { type: "chatgpt" } };
            if (request.method === "modelProvider/capabilities/read") result = { imageGeneration: true };
            if (request.method === "config/read") result = configResponse;
            if (request.method === "thread/start")
              result = { thread: { id: "job-thread" }, modelProvider: "not-native" };
            const response =
              request.method === "config/read" && rpcError
                ? { id: request.id, error: { code: -32000, message: canary, data: { credential: canary } } }
                : { id: request.id, result };
            stdout.write(`${JSON.stringify(response)}\n`);
          });
        callback();
      },
    });
    return child;
  };
  return { directory, requests, generator: createCodexImageGenerator({ directory, timeoutMs: 1000 }) };
}

test("config/read returns exactly the name whitelist at the native-client boundary", async () => {
  const { directory } = await fixture({
    config: { mcp_servers: { example: { env: { SECRET: canary } } }, credential: canary },
    origins: { canary },
    layers: [{ canary }],
  });
  const client = createCodexImageClient("codex", directory);
  try {
    const metadata = await client.request("config/read", { includeLayers: false, cwd: directory });
    expect(metadata).toEqual({ nameList: ["example"] });
    expect(JSON.stringify(metadata)).not.toContain(canary);
  } finally {
    client.close();
  }
});

test("native config transport releases only server names, never credentials, origins or config layers", async () => {
  const { generator, requests } = await fixture({
    config: { mcp_servers: { example: { command: "must-not-run", env: { SECRET: canary } } }, api_key: canary },
    origins: { secret: canary },
    layers: [{ secret: canary }],
  });
  await expect(generator.generate({ prompt: "A friendly transparent character" })).rejects.toThrow(
    /native ChatGPT provider/,
  );
  const read = requests.find((request) => request.method === "config/read")!;
  expect(read.params).toEqual({ includeLayers: false, cwd: expect.any(String) });
  const started = requests.find((request) => request.method === "thread/start")!;
  expect(started.params.config).toMatchObject({ mcp_servers: { example: { enabled: false } } });
  expect(started.params.environments).toEqual([]);
  expect(JSON.stringify(requests)).not.toContain(canary);
  expect(requests.some((request) => request.method === "mcpServerStatus/list")).toBe(false);
  expect(requests.some((request) => request.method === "turn/start")).toBe(false);
});

test("config RPC errors cannot leak credential-bearing messages or data", async () => {
  const { generator, requests } = await fixture({}, true);
  const error = await generator.generate({ prompt: "A creature" }).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).not.toContain(canary);
  expect(
    requests.some((request) => request.method === "thread/start" || request.method === "mcpServerStatus/list"),
  ).toBe(false);
});

test("malformed effective configs and MCP maps fail closed without leaking their contents", async () => {
  for (const configResponse of [
    null,
    { config: [] },
    { config: { mcp_servers: canary } },
    { config: { mcp_servers: [] } },
    { config: { mcp_servers: null } },
  ]) {
    const { generator, requests } = await fixture(configResponse);
    const error = await generator.generate({ prompt: "A creature" }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(canary);
    expect(
      requests.some((request) => request.method === "thread/start" || request.method === "mcpServerStatus/list"),
    ).toBe(false);
  }
});

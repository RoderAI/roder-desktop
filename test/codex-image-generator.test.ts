import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
  CodexImageModelUnsupportedError,
  createCodexImageGenerator,
  type CodexImageClient,
} from "../electron/persistent-agents/codex-image-generator";

const directories: string[] = [];
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DQAAAEgQGALFXOsAAAAABJRU5ErkJggg==",
  "base64",
);
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});

async function setup(timeoutMs?: number) {
  const directory = await mkdtemp(join(tmpdir(), "codex-image-test-"));
  directories.push(directory);
  const listeners = new Set<(method: string, params: unknown) => void>();
  const emit = (method: string, params: unknown) => {
    for (const listener of listeners) listener(method, params);
  };
  let image: Record<string, unknown> = {
    id: "image-one",
    type: "imageGeneration",
    status: "completed",
    result: png.toString("base64"),
  };
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async (method) => {
    if (method === "initialize") return { userAgent: "codex-cli/0.164.0", codexHome: directory };
    if (method === "account/read") return { account: { type: "chatgpt" } };
    if (method === "modelProvider/capabilities/read") return { imageGeneration: true };
    if (method === "config/read") return { nameList: ["configured-server"] };
    if (method === "thread/start") return { thread: { id: "image-thread" }, modelProvider: "openai" };
    if (method === "turn/start") {
      queueMicrotask(() => {
        emit("item/completed", { threadId: "image-thread", turnId: "image-turn", item: image });
        emit("turn/completed", {
          threadId: "image-thread",
          turn: { id: "image-turn", status: "completed", items: [] },
        });
      });
      return { turn: { id: "image-turn" } };
    }
    if (method === "turn/interrupt") return {};
    throw Error("Unexpected request");
  });
  const close = vi.fn<() => void>();
  const notify = vi.fn<(method: string, params?: unknown) => void>();
  const client: CodexImageClient = {
    request,
    notify,
    close,
    onNotification: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const connect = vi.fn<(directory: string) => Promise<CodexImageClient>>(async () => client);
  const generator = createCodexImageGenerator({ directory, timeoutMs, connect });
  return {
    directory,
    generator,
    request,
    close,
    connect,
    notify,
    emit,
    setImage: (item: Record<string, unknown>) => {
      image = item;
    },
  };
}

test("probe uses native stored-login APIs without starting inference and reports exact model selection unavailable", async () => {
  const { generator, request, close, notify, directory } = await setup();
  expect(await generator.probe()).toMatchObject({
    authenticated: true,
    imageGeneration: true,
    supportsRequestedModel: false,
    verifiedImageModel: null,
  });
  expect(request.mock.calls.map(([method]) => method)).toEqual([
    "initialize",
    "account/read",
    "modelProvider/capabilities/read",
  ]);
  expect(request).toHaveBeenCalledWith("account/read", { refreshToken: false });
  expect(notify).toHaveBeenCalledWith("initialized");
  expect(close).toHaveBeenCalled();
  expect(await readdir(directory)).toEqual([]);
});

test("strict Flare requests fail closed before creating a client or spending on an unverifiable generation", async () => {
  const { generator, connect } = await setup();
  const request = generator.generate({ prompt: "A friendly creature", model: "gpt-image-2.5-flare" });
  await expect(request).rejects.toBeInstanceOf(CodexImageModelUnsupportedError);
  await expect(request).rejects.toMatchObject({ code: "CODEX_IMAGE_MODEL_UNVERIFIED" });
  expect(connect).not.toHaveBeenCalled();
});

test("API-key login is not accepted as Codex subscription authentication", async () => {
  const { generator, request } = await setup();
  request.mockImplementation(async (method) => (method === "account/read" ? { account: { type: "apiKey" } } : {}));
  expect(await generator.probe()).toMatchObject({
    authenticated: false,
    imageGeneration: false,
    supportsRequestedModel: false,
  });
  expect(request).not.toHaveBeenCalledWith("modelProvider/capabilities/read", expect.anything());
  await expect(generator.generate({ prompt: "One creature" })).rejects.toThrow(/ChatGPT/);
  expect(request).not.toHaveBeenCalledWith("thread/start", expect.anything());
  expect(request).not.toHaveBeenCalledWith("turn/start", expect.anything());
});

test("cancellation closes a stalled capability probe without retries", async () => {
  const { generator, request, close, directory } = await setup();
  const controller = new AbortController();
  request.mockImplementation(async () => {
    queueMicrotask(() => controller.abort());
    return new Promise(() => {});
  });
  await expect(generator.probe({ signal: controller.signal })).rejects.toThrow(/cancelled/);
  expect(request).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalled();
  expect(await readdir(directory)).toEqual([]);
});

test("a timed-out capability probe is bounded and never starts a model turn", async () => {
  const { generator, request, close } = await setup(10);
  request.mockImplementation(() => new Promise(() => {}));
  await expect(generator.probe()).rejects.toThrow(/timed out/);
  expect(request).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalled();
});

test("already-cancelled generation and probes never create a subprocess", async () => {
  const { generator, connect } = await setup();
  const controller = new AbortController();
  controller.abort();
  await expect(generator.probe({ signal: controller.signal })).rejects.toThrow(/cancelled/);
  await expect(
    generator.generate({ prompt: "A creature", model: "gpt-image-2.5-flare", signal: controller.signal }),
  ).rejects.toThrow(/cancelled/);
  expect(connect).not.toHaveBeenCalled();
});

test("managed generation captures a real image item, disables unrelated capabilities and never infers model provenance", async () => {
  const { generator, request, directory, setImage } = await setup();
  setImage({
    id: "image-one",
    type: "imageGeneration",
    status: "completed",
    result: png.toString("base64"),
    revisedPrompt: "This was generated with GPT Image 2.5 Flare",
  });
  const result = await generator.generate({ prompt: "One friendly creature with transparent background" });
  expect(result).toEqual({ bytes: png, model: null, artifactId: "image-one" });
  expect(request).toHaveBeenCalledWith(
    "thread/start",
    expect.objectContaining({
      ephemeral: true,
      sandbox: "read-only",
      approvalPolicy: "never",
      runtimeWorkspaceRoots: expect.any(Array),
      environments: [],
      dynamicTools: [],
      config: expect.objectContaining({
        project_doc_max_bytes: 0,
        mcp_servers: { "configured-server": { enabled: false } },
        features: expect.objectContaining({ shell_tool: false, hooks: false, plugins: false, image_generation: true }),
      }),
    }),
  );
  expect(request.mock.calls.filter(([method]) => method === "turn/start")).toHaveLength(1);
  expect(request).not.toHaveBeenCalledWith("mcpServerStatus/list", expect.anything());
  expect(await readdir(directory)).toEqual([]);
});

test("managed generation can read its emitted saved artifact but rejects path escapes and symlinks", async () => {
  const { generator, directory, setImage } = await setup();
  const imageDirectory = join(directory, "generated_images", "image-thread");
  await mkdir(imageDirectory, { recursive: true });
  const savedPath = join(imageDirectory, "image-one.png");
  await writeFile(savedPath, png);
  setImage({ id: "image-one", type: "imageGeneration", status: "completed", fileId: "file-one", savedPath });
  expect((await generator.generate({ prompt: "One creature" })).bytes).toEqual(png);
  setImage({
    id: "image-one",
    type: "imageGeneration",
    status: "completed",
    fileId: "file-one",
    savedPath: join(directory, "outside.png"),
  });
  await expect(generator.generate({ prompt: "One creature" })).rejects.toThrow(/authorized/);
  await rm(savedPath);
  const outside = join(directory, "outside.png");
  await writeFile(outside, png);
  await symlink(outside, savedPath);
  setImage({ id: "image-one", type: "imageGeneration", status: "completed", fileId: "file-one", savedPath });
  await expect(generator.generate({ prompt: "One creature" })).rejects.toThrow(/symlink|escapes/);
});

test("bad or oversized image results are rejected without retrying the model turn", async () => {
  const { generator, request, setImage } = await setup();
  for (const result of [Buffer.from("not a PNG").toString("base64"), "A".repeat(15 * 1024 * 1024)]) {
    setImage({ id: "image-one", type: "imageGeneration", status: "completed", result });
    await expect(generator.generate({ prompt: "One creature" })).rejects.toThrow(/PNG|limit/);
  }
  expect(request.mock.calls.filter(([method]) => method === "turn/start")).toHaveLength(2);
});

test("managed job cancellation interrupts its own turn, closes the client, and never retries", async () => {
  const { generator, request, close } = await setup();
  const original = request.getMockImplementation()!;
  const controller = new AbortController();
  request.mockImplementation(async (method, params) => {
    if (method === "turn/start") {
      setImmediate(() => controller.abort());
      return { turn: { id: "image-turn" } };
    }
    return original(method, params);
  });
  await expect(generator.generate({ prompt: "One creature", signal: controller.signal })).rejects.toThrow(/cancelled/);
  expect(request).toHaveBeenCalledWith("turn/interrupt", { threadId: "image-thread", turnId: "image-turn" });
  expect(request.mock.calls.filter(([method]) => method === "turn/start")).toHaveLength(1);
  expect(close).toHaveBeenCalled();
});

test("unrelated tool execution or missing image output fails closed and interrupts the turn", async () => {
  const { generator, request, setImage } = await setup();
  setImage({ id: "shell", type: "commandExecution", status: "completed" });
  await expect(generator.generate({ prompt: "One creature" })).rejects.toThrow(/non-image tool/);
  expect(request).toHaveBeenCalledWith("turn/interrupt", { threadId: "image-thread", turnId: "image-turn" });
  setImage({ id: "message", type: "agentMessage", text: "I made an image" });
  await expect(generator.generate({ prompt: "One creature" })).rejects.toThrow(/without an image/);
});

test("native-provider and ChatGPT-only settings cannot silently inherit a custom API inference provider", async () => {
  const { generator, request } = await setup();
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (method, params) =>
    method === "thread/start"
      ? { thread: { id: "image-thread" }, modelProvider: "custom-api" }
      : original(method, params),
  );
  await expect(generator.generate({ prompt: "One creature" })).rejects.toThrow(/native ChatGPT provider/);
  expect(request).toHaveBeenCalledWith(
    "thread/start",
    expect.objectContaining({
      modelProvider: "openai",
      config: expect.objectContaining({ model_provider: "openai", forced_login_method: "chatgpt" }),
    }),
  );
  expect(request).not.toHaveBeenCalledWith("turn/start", expect.anything());
});

test("malformed redacted tool metadata stops generation before a thread or turn starts", async () => {
  const { generator, request } = await setup();
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (method, params) =>
    method === "config/read" ? { nameList: "invalid" } : original(method, params),
  );
  await expect(generator.generate({ prompt: "One creature" })).rejects.toThrow(/metadata/);
  expect(request).not.toHaveBeenCalledWith("thread/start", expect.anything());
});

test("a generation deadline interrupts the started turn instead of retrying it", async () => {
  const { generator, request } = await setup(30);
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (method, params) =>
    method === "turn/start" ? { turn: { id: "image-turn" } } : original(method, params),
  );
  await expect(generator.generate({ prompt: "One creature" })).rejects.toThrow(/timed out/);
  expect(request).toHaveBeenCalledWith("turn/interrupt", { threadId: "image-thread", turnId: "image-turn" });
  expect(request.mock.calls.filter(([method]) => method === "turn/start")).toHaveLength(1);
});

test("a second image call is rejected and a concurrent generation cannot overlap", async () => {
  const { generator, request, emit, connect } = await setup();
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (method, params) =>
    method === "turn/start" ? { turn: { id: "image-turn" } } : original(method, params),
  );
  const first = generator.generate({ prompt: "One creature" });
  await vi.waitFor(() => expect(request).toHaveBeenCalledWith("turn/start", expect.anything()));
  await expect(generator.generate({ prompt: "Another creature" })).rejects.toThrow(/already running/);
  emit("item/started", {
    threadId: "image-thread",
    turnId: "image-turn",
    item: { id: "first", type: "imageGeneration", status: "in_progress" },
  });
  emit("item/started", {
    threadId: "image-thread",
    turnId: "image-turn",
    item: { id: "second", type: "imageGeneration", status: "in_progress" },
  });
  await expect(first).rejects.toThrow(/more than one image/);
  expect(connect).toHaveBeenCalledTimes(1);
});

test("PNG checksum corruption cannot be accepted as a valid artifact", async () => {
  const { generator, setImage } = await setup();
  const corrupted = Buffer.from(png);
  corrupted[corrupted.length - 1] ^= 1;
  setImage({ id: "image-one", type: "imageGeneration", status: "completed", result: corrupted.toString("base64") });
  await expect(generator.generate({ prompt: "One creature" })).rejects.toThrow(/checksum/);
});

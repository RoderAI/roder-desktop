import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test, vi } from "vitest";
import {
  createPersistentAgentSpriteManager,
  createSpriteImageNormalizer,
  type GeneratedSprite,
} from "../electron/persistent-agents/sprites";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
const persona = { id: "pa-one", name: "Pip", mission: "Patiently review releases and spot tiny regressions" };
const bytes = Buffer.from("test-validated-png");
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "pa-sprites-"));
  directories.push(directory);
  const generateOpenAi = vi
    .fn<(prompt: string) => Promise<GeneratedSprite>>()
    .mockResolvedValue({ bytes, model: "gpt-image-2.5-flare", artifactId: "api-request" });
  const generateCodex = vi
    .fn<(prompt: string) => Promise<GeneratedSprite>>()
    .mockRejectedValue(Error("Codex sign-in required"));
  const normalizeImage = vi.fn<() => Buffer>(() => bytes);
  const options = { directory, generateOpenAi, generateCodex, normalizeImage };
  const manager = createPersistentAgentSpriteManager(options);
  await manager.initialize();
  return { directory, generateOpenAi, generateCodex, normalizeImage, manager, options };
}

test("explicitly generates a real OpenAI character and persists scoped PNG bytes and provenance", async () => {
  const { manager, generateOpenAi, directory } = await setup();
  await manager.retry(persona, "openai");
  await manager.whenIdle();
  expect(manager.get(persona.id)).toMatchObject({
    status: "ready",
    attempts: 1,
    generationProvider: "openai",
    asset: { provider: "openai", model: "gpt-image-2.5-flare", width: 256, height: 256, artifactId: "api-request" },
  });
  expect(generateOpenAi.mock.calls[0][0]).toContain(persona.mission);
  expect(await manager.read(persona.id)).toEqual({ mimeType: "image/png", bytesBase64: bytes.toString("base64") });
  expect(await readFile(join(directory, manager.get(persona.id)!.asset!.fileName))).toEqual(bytes);
  await expect(manager.read("../outside")).rejects.toThrow(/agent id/i);
});

test("creation uses Codex by default and never falls back to API billing when Codex needs sign-in", async () => {
  const { manager, generateCodex, generateOpenAi } = await setup();
  await manager.enqueue(persona);
  await manager.whenIdle();
  expect(generateCodex).toHaveBeenCalledTimes(1);
  expect(generateOpenAi).not.toHaveBeenCalled();
  expect(manager.get(persona.id)).toMatchObject({
    status: "needs_credentials",
    generationProvider: "codex",
    asset: null,
  });
  expect(manager.get(persona.id)?.error).toMatch(/sign in to Codex/i);
});

test("Codex result provenance is taken from verified adapter metadata, not the character prompt", async () => {
  const { manager, generateCodex, generateOpenAi } = await setup();
  generateCodex.mockResolvedValue({ bytes, model: "gpt-image-2.5-flare", artifactId: "codex-generation" });
  await manager.enqueue(persona);
  await manager.whenIdle();
  expect(generateOpenAi).not.toHaveBeenCalled();
  expect(manager.get(persona.id)).toMatchObject({
    status: "ready",
    asset: { provider: "codex", model: "gpt-image-2.5-flare", artifactId: "codex-generation" },
  });
});

test("missing credentials never invoke generation or accept the engine's fake default", async () => {
  const { manager, generateCodex, generateOpenAi } = await setup();
  generateOpenAi.mockRejectedValue(Error("API key missing"));
  await manager.retry(persona, "openai");
  await manager.whenIdle();
  expect(manager.get(persona.id)).toMatchObject({ status: "needs_credentials", asset: null });
  expect(generateCodex).not.toHaveBeenCalled();
  await manager.enqueue(persona);
  await manager.whenIdle();
  expect(generateOpenAi).toHaveBeenCalledTimes(1);
});

test("restarts do not retry paid jobs and explicit retry preserves an old good asset on failure", async () => {
  const { manager, generateOpenAi, options } = await setup();
  await manager.retry(persona, "openai");
  await manager.whenIdle();
  const asset = manager.get(persona.id)!.asset;
  const recovered = createPersistentAgentSpriteManager(options);
  await recovered.initialize();
  await recovered.enqueue(persona);
  expect(generateOpenAi).toHaveBeenCalledTimes(1);
  generateOpenAi.mockRejectedValue(Error("401 secret-value-must-not-leak"));
  await recovered.retry(persona, "openai");
  await recovered.whenIdle();
  expect(recovered.get(persona.id)).toMatchObject({ status: "needs_credentials", asset });
  expect(JSON.stringify(recovered.get(persona.id))).not.toContain("secret-value");
  expect(await recovered.read(persona.id)).not.toBeNull();
});

test("rejects fake generated output rather than labeling a placeholder as ready", async () => {
  const { manager, generateOpenAi } = await setup();
  generateOpenAi.mockResolvedValue({ bytes, model: "fake-image", artifactId: null });
  await manager.retry(persona, "openai");
  await manager.whenIdle();
  expect(manager.get(persona.id)).toMatchObject({ status: "failed", asset: null });
});

test("queues without waiting for image generation and runs only one generation at a time", async () => {
  const { manager, generateOpenAi } = await setup();
  let finish!: (value: GeneratedSprite) => void;
  const pending = new Promise<GeneratedSprite>((resolve) => {
    finish = resolve;
  });
  generateOpenAi.mockReturnValueOnce(pending);
  await manager.retry(persona, "openai");
  await vi.waitFor(() => expect(generateOpenAi).toHaveBeenCalledTimes(1));
  await manager.retry({ ...persona, id: "pa-two" }, "openai");
  expect(generateOpenAi).toHaveBeenCalledTimes(1);
  finish({ bytes, model: "gpt-image-2.5-flare", artifactId: null });
  await manager.whenIdle();
  expect(generateOpenAi).toHaveBeenCalledTimes(2);
  expect(manager.get("pa-two")?.status).toBe("ready");
});

test("interrupted generation recovers visibly failed without another generation call", async () => {
  const { manager, generateOpenAi, options } = await setup();
  let finish!: (value: GeneratedSprite) => void;
  generateOpenAi.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await manager.retry(persona, "openai");
  await vi.waitFor(() => expect(generateOpenAi).toHaveBeenCalledTimes(1));
  manager.stop();
  const recovered = createPersistentAgentSpriteManager(options);
  await recovered.initialize();
  expect(recovered.get(persona.id)).toMatchObject({ status: "failed", asset: null });
  expect(recovered.get(persona.id)?.error).toMatch(/interrupted/);
  await recovered.enqueue(persona);
  expect(generateOpenAi).toHaveBeenCalledTimes(1);
  finish({ bytes, model: "gpt-image-2.5-flare", artifactId: null });
  await manager.whenIdle();
});

test("stopping while the generating state is being persisted never starts a delayed paid job", async () => {
  const { options, generateOpenAi } = await setup();
  const manager = createPersistentAgentSpriteManager({
    ...options,
    notify: () => {
      if (manager.get(persona.id)?.status === "generating") manager.stop();
    },
  });
  await manager.initialize();
  await manager.retry(persona, "openai");
  await manager.whenIdle();
  expect(generateOpenAi).not.toHaveBeenCalled();
});

test("a missing saved asset advances the public cache version once and does not trigger endless refetches", async () => {
  const { manager, directory } = await setup();
  await manager.retry(persona, "openai");
  await manager.whenIdle();
  const previous = manager.get(persona.id)!;
  await rm(join(directory, previous.asset!.fileName));
  expect(await manager.read(persona.id)).toBeNull();
  const failed = manager.get(persona.id)!;
  expect(failed).toMatchObject({ status: "failed", asset: null });
  expect(failed.updatedAt).toBeGreaterThan(previous.updatedAt);
  expect(await manager.read(persona.id)).toBeNull();
  expect(manager.get(persona.id)?.updatedAt).toBe(failed.updatedAt);
});

test("an unreported or legacy model is not relabeled as GPT Image 2.5", async () => {
  const { manager, generateCodex, generateOpenAi, options } = await setup();
  generateCodex
    .mockResolvedValueOnce({ bytes, model: null, artifactId: null })
    .mockResolvedValueOnce({ bytes, model: "gpt-image-2", artifactId: "legacy" });
  await manager.enqueue(persona);
  await manager.whenIdle();
  expect(manager.get(persona.id)).toMatchObject({ status: "ready", asset: { model: null, provider: "codex" } });
  const recovered = createPersistentAgentSpriteManager(options);
  await recovered.initialize();
  expect(recovered.get(persona.id)).toMatchObject({ status: "ready", asset: { model: null, provider: "codex" } });
  expect(await recovered.read(persona.id)).not.toBeNull();
  expect(generateCodex).toHaveBeenCalledTimes(1);
  await manager.retry(persona);
  await manager.whenIdle();
  expect(manager.get(persona.id)).toMatchObject({
    status: "ready",
    asset: { model: "gpt-image-2", provider: "codex" },
  });
  expect(generateOpenAi).not.toHaveBeenCalled();
});

test("managed Codex generation failures do not trigger an API fallback or fabricate an image", async () => {
  const { manager, generateCodex, generateOpenAi, normalizeImage } = await setup();
  generateCodex.mockRejectedValue(Error("Codex image generation failed"));
  await manager.enqueue(persona);
  await manager.whenIdle();
  expect(manager.get(persona.id)).toMatchObject({ status: "failed", generationProvider: "codex", asset: null });
  expect(manager.get(persona.id)?.error).not.toContain("GPT Image 2.5");
  expect(generateOpenAi).not.toHaveBeenCalled();
  expect(normalizeImage).not.toHaveBeenCalled();
});

test("the explicit API route rejects an unreported image model instead of assuming Flare", async () => {
  const { manager, generateOpenAi } = await setup();
  generateOpenAi.mockResolvedValue({ bytes, model: null, artifactId: "api-request" });
  await manager.retry(persona, "openai");
  await manager.whenIdle();
  expect(manager.get(persona.id)).toMatchObject({ status: "failed", asset: null });
});

test("old saved image provenance remains readable without regenerating or claiming it used 2.5", async () => {
  const { manager, options, directory, generateOpenAi, generateCodex } = await setup();
  await manager.retry(persona, "openai");
  await manager.whenIdle();
  const path = join(directory, "sprites.json");
  const stored = JSON.parse(await readFile(path, "utf8"));
  delete stored.sprites[0].generationProvider;
  stored.sprites[0].asset.model = "gpt-image-2";
  await writeFile(path, JSON.stringify(stored));
  const recovered = createPersistentAgentSpriteManager(options);
  await recovered.initialize();
  expect(recovered.get(persona.id)).toMatchObject({
    generationProvider: "codex",
    asset: { model: "gpt-image-2", provider: "openai" },
  });
  expect(await recovered.read(persona.id)).not.toBeNull();
  expect(generateOpenAi).toHaveBeenCalledTimes(1);
  expect(generateCodex).not.toHaveBeenCalled();
});

test("native image shaping preserves aspect ratio, centers RGBA into transparent 256px padding, and rejects opaque art", () => {
  const png = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(png);
  png.writeUInt32BE(4, 16);
  png.writeUInt32BE(2, 20);
  const source = Buffer.alloc(4 * 2 * 4);
  source[3] = 255;
  const resized = Buffer.alloc(256 * 128 * 4);
  resized[3] = 255;
  const resize = vi.fn<(options: { width: number; height: number; quality: string }) => { toBitmap: () => Buffer }>(
    () => ({ toBitmap: () => resized }),
  );
  const createFromBitmap = vi.fn<
    (bitmap: Buffer, options: { width: number; height: number }) => { toPNG: () => Buffer }
  >(() => ({ toPNG: () => bytes }));
  const factory = {
    createFromBuffer: () => ({ isEmpty: () => false, toBitmap: () => source, resize }),
    createFromBitmap,
  };
  const normalize = createSpriteImageNormalizer(
    factory as unknown as Parameters<typeof createSpriteImageNormalizer>[0],
  );
  expect(normalize(png)).toEqual(bytes);
  expect(resize).toHaveBeenCalledWith({ width: 256, height: 128, quality: "best" });
  const output = createFromBitmap.mock.calls[0][0] as Buffer;
  expect(output.length).toBe(256 * 256 * 4);
  expect(output[3]).toBe(0);
  expect(output[64 * 256 * 4 + 3]).toBe(255);
  for (let index = 3; index < source.length; index += 4) source[index] = 255;
  expect(() => normalize(png)).toThrow(/transparent/);
  source.fill(0);
  expect(() => normalize(png)).toThrow(/visible character/);
});

import { expect, test, vi } from "vitest";
import { createPersistentAgentAvatarCache } from "../src/lib/persistent-agent-avatar";
import type { PersistentAgentSprite, PersistentAgentSpriteImage } from "../src/types/persistent-agent-sprite";

const sprite = (status: PersistentAgentSprite["status"], updatedAt: number): PersistentAgentSprite => ({
  agentId: "pa-1",
  generationProvider: "codex",
  status,
  attempts: 1,
  updatedAt,
  error: null,
  asset: {
    fileName: "character.png",
    artifactId: "asset-1",
    provider: "openai",
    model: "gpt-image-2",
    width: 256,
    height: 256,
    createdAt: 1,
  },
});
type ReadResult = { sprite: PersistentAgentSprite | null; image: PersistentAgentSpriteImage | null };

test("avatar reads are scoped to the PA id and deduplicated by update version", async () => {
  const read = vi.fn<(id: string) => Promise<ReadResult>>(async () => ({
    sprite: sprite("ready", 1),
    image: { mimeType: "image/png", bytesBase64: "aW1hZ2U=" },
  }));
  const cache = createPersistentAgentAvatarCache(read);
  const [first, second] = await Promise.all([cache.read("pa-1", 1), cache.read("pa-1", 1)]);
  expect(first).toEqual(second);
  expect(first.src).toBe("data:image/png;base64,aW1hZ2U=");
  expect(read).toHaveBeenCalledExactlyOnceWith("pa-1");
  await cache.read("pa-1", 2);
  expect(read).toHaveBeenCalledTimes(2);
});

test("queued, failed, and missing-credential retries keep the previous good image", async () => {
  let state = sprite("ready", 1);
  const cache = createPersistentAgentAvatarCache(async () => ({
    sprite: state,
    image: state.status === "ready" ? { mimeType: "image/png", bytesBase64: "aW1hZ2U=" } : null,
  }));
  const ready = await cache.read("pa-1", 1);
  for (const [index, status] of (["queued", "generating", "failed", "needs_credentials"] as const).entries()) {
    state = sprite(status, index + 2);
    expect((await cache.read("pa-1", state.updatedAt)).src).toBe(ready.src);
  }
});

test("a failed image read preserves cached art and can be retried without starting generation", async () => {
  const read = vi
    .fn<(id: string) => Promise<ReadResult>>()
    .mockResolvedValueOnce({ sprite: sprite("ready", 1), image: { mimeType: "image/png", bytesBase64: "aW1hZ2U=" } })
    .mockRejectedValueOnce(new Error("Read unavailable"))
    .mockResolvedValueOnce({ sprite: sprite("ready", 2), image: null });
  const cache = createPersistentAgentAvatarCache(read);
  const ready = await cache.read("pa-1", 1);
  await expect(cache.read("pa-1", 2)).rejects.toThrow("Read unavailable");
  expect(cache.peek("pa-1")?.src).toBe(ready.src);
  expect((await cache.read("pa-1", 2)).src).toBe(ready.src);
  expect(read).toHaveBeenCalledTimes(3);
});

test("late responses cannot replace a newer character or leak it to another PA", async () => {
  let resolveOld: (value: ReadResult) => void = () => undefined;
  const read = vi
    .fn<(id: string) => Promise<ReadResult>>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValueOnce({ sprite: sprite("ready", 2), image: { mimeType: "image/png", bytesBase64: "bmV3" } });
  const cache = createPersistentAgentAvatarCache(read);
  const old = cache.read("pa-1", 1);
  const current = await cache.read("pa-1", 2);
  resolveOld({ sprite: sprite("ready", 1), image: { mimeType: "image/png", bytesBase64: "b2xk" } });
  expect(await old).toEqual(current);
  expect(cache.peek("pa-1")).toEqual(current);
  expect(cache.peek("pa-2")).toBeNull();
});

test("missing sprite metadata stays genuinely empty until a later asset version", async () => {
  const read = vi
    .fn<(id: string) => Promise<ReadResult>>()
    .mockResolvedValueOnce({ sprite: null, image: null })
    .mockResolvedValueOnce({ sprite: sprite("ready", 1), image: { mimeType: "image/png", bytesBase64: "aW1hZ2U=" } });
  const cache = createPersistentAgentAvatarCache(read);
  expect(await cache.read("pa-1", 0)).toEqual({ sprite: null, src: null });
  expect((await cache.read("pa-1", 1)).src).toBe("data:image/png;base64,aW1hZ2U=");
});

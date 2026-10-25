import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test, vi } from "vitest";
import {
  createImageGenerationCredentials,
  configureImageGenerationKey,
} from "../electron/persistent-agents/image-credentials";
const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "image-credentials-"));
  directories.push(directory);
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value.split("").reverse().join("")),
    decryptString: (value: Buffer) => value.toString().split("").reverse().join(""),
  };
  return { directory, storage, store: createImageGenerationCredentials({ directory, storage }) };
}
test("persists only encrypted image credentials and loads them on a future image job without changing inference env", async () => {
  const { directory, storage, store } = await setup();
  const original = process.env.OPENAI_API_KEY;
  expect(await store.load()).toBeNull();
  const key = "sk-test-private-image-key";
  await store.save(key);
  expect((await readFile(join(directory, "image-generation.key"))).toString()).not.toContain(key);
  expect(await createImageGenerationCredentials({ directory, storage }).load()).toBe(key);
  expect(process.env.OPENAI_API_KEY).toBe(original);
});
test("refuses plaintext fallback when OS encryption is unavailable", async () => {
  const { directory, storage } = await setup();
  const store = createImageGenerationCredentials({
    directory,
    storage: { ...storage, isEncryptionAvailable: () => false },
  });
  await expect(store.save("sk-test-private-image-key")).rejects.toThrow(/secure storage/i);
  expect(await store.load()).toBeNull();
});
test("corrupt optional image credentials leave the file intact and do not affect Codex or engine startup", async () => {
  const { directory, storage, store } = await setup();
  await store.save("sk-test-private-image-key");
  const before = await readFile(join(directory, "image-generation.key"));
  const warning = vi.fn<() => void>();
  const unavailable = createImageGenerationCredentials({
    directory,
    storage: {
      ...storage,
      decryptString: () => {
        throw Error("secret-keychain-error");
      },
    },
    onUnavailable: warning,
  });
  expect(await unavailable.load()).toBeNull();
  expect(warning).toHaveBeenCalledWith();
  expect(await readFile(join(directory, "image-generation.key"))).toEqual(before);
});
test("saving the image-only key requires no engine restart, thread scan, or paid request", async () => {
  const { store } = await setup();
  expect(await configureImageGenerationKey("sk-test-private-image-key", store)).toEqual({ configured: true });
  expect(await store.load()).toBe("sk-test-private-image-key");
});
test("failed secure setup restores the previous encrypted key without returning sensitive errors", async () => {
  const { directory, storage, store } = await setup();
  await store.save("sk-previous-image-key");
  const failing = createImageGenerationCredentials({
    directory,
    storage: {
      ...storage,
      decryptString: (value) => {
        const key = storage.decryptString(value);
        if (key === "sk-new-private-image-key") throw Error(key);
        return key;
      },
    },
  });
  await expect(configureImageGenerationKey("sk-new-private-image-key", failing)).rejects.toThrow(/previous credential/);
  expect(await store.load()).toBe("sk-previous-image-key");
});

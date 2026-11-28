import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { safeStorage } from "electron";

type Storage = Pick<typeof safeStorage, "isEncryptionAvailable" | "encryptString" | "decryptString"> & {
  getSelectedStorageBackend?: () => string;
};

export function createImageGenerationCredentials(options: {
  directory: string;
  storage: Storage;
  onUnavailable?: () => void;
}) {
  const path = join(options.directory, "image-generation.key");
  function requireSecureStorage() {
    if (
      !options.storage.isEncryptionAvailable() ||
      (process.platform === "linux" && options.storage.getSelectedStorageBackend?.() === "basic_text")
    )
      throw Error(
        "OS-backed secure storage is unavailable. Configure OPENAI_API_KEY in the app's launch environment instead; plaintext storage is not supported.",
      );
  }
  async function readEncrypted(): Promise<Buffer | null> {
    try {
      const bytes = await readFile(path);
      if (bytes.length > 65536) throw Error("Invalid encrypted credential");
      return bytes;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw Error("The saved image credential could not be read securely.");
    }
  }
  async function writeEncrypted(bytes: Buffer) {
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    await writeFile(`${path}.tmp`, bytes, { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  }
  return {
    async load(): Promise<string | null> {
      try {
        const encrypted = await readEncrypted();
        if (!encrypted) return null;
        requireSecureStorage();
        const key = options.storage.decryptString(encrypted);
        if (!key.trim() || key.length > 4096 || /[\r\n]/u.test(key) || key.includes("\0"))
          throw Error("Invalid credential");
        return key;
      } catch {
        try {
          options.onUnavailable?.();
        } catch {}
        return null;
      }
    },
    async save(apiKey: string): Promise<() => Promise<void>> {
      requireSecureStorage();
      if (
        typeof apiKey !== "string" ||
        apiKey.trim().length < 16 ||
        apiKey.length > 4096 ||
        /[\r\n]/u.test(apiKey) ||
        apiKey.includes("\0")
      )
        throw Error("Enter a valid OpenAI API key; subscription sign-in is not an image API credential.");
      const previous = await readEncrypted();
      try {
        await writeEncrypted(options.storage.encryptString(apiKey.trim()));
      } catch {
        throw Error("The image credential could not be saved securely.");
      }
      return async () => {
        if (previous) await writeEncrypted(previous);
        else
          await unlink(path).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          });
      };
    },
  };
}

export async function configureImageGenerationKey(
  apiKey: string,
  store: ReturnType<typeof createImageGenerationCredentials>,
): Promise<{ configured: boolean }> {
  const rollback = await store.save(apiKey);
  try {
    if (!(await store.load())) throw Error("Could not unlock saved image key");
    return { configured: true };
  } catch {
    try {
      await rollback();
    } catch {
      throw Error(
        "Image key setup failed and the previous credential could not be restored. Save the image key again before using the API route.",
      );
    }
    throw Error(
      "The image API key could not be saved securely; the previous credential was restored. Codex and the engine were not restarted or changed.",
    );
  }
}

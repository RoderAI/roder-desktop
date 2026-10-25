import type { PersistentAgentSprite, PersistentAgentSpriteImage } from "@/types/persistent-agent-sprite";

export type PersistentAgentAvatarSnapshot = { sprite: PersistentAgentSprite | null; src: string | null };

export function createPersistentAgentAvatarCache(
  readSprite: (
    id: string,
  ) => Promise<{ sprite: PersistentAgentSprite | null; image: PersistentAgentSpriteImage | null }>,
) {
  const cached = new Map<string, { version: number; value: PersistentAgentAvatarSnapshot }>();
  const pending = new Map<string, Promise<PersistentAgentAvatarSnapshot>>();
  return {
    peek: (id: string): PersistentAgentAvatarSnapshot | null => cached.get(id)?.value ?? null,
    read(id: string, version: number): Promise<PersistentAgentAvatarSnapshot> {
      const current = cached.get(id);
      if (current && current.version >= version) return Promise.resolve(current.value);
      const key = `${id}:${version}`;
      const existing = pending.get(key);
      if (existing) return existing;
      const request = readSprite(id).then((result) => {
        const latest = cached.get(id);
        const resolvedVersion = Math.max(version, result.sprite?.updatedAt ?? 0);
        if (latest && latest.version > resolvedVersion) return latest.value;
        const value = {
          sprite: result.sprite,
          src: result.image
            ? `data:${result.image.mimeType};base64,${result.image.bytesBase64}`
            : (latest?.value.src ?? null),
        };
        cached.set(id, { version: resolvedVersion, value });
        return value;
      });
      pending.set(key, request);
      void request.then(
        () => pending.delete(key),
        () => pending.delete(key),
      );
      return request;
    },
  };
}

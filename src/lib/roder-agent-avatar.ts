import type { RoderAgentSprite, RoderAgentSpriteImage } from "@/types/roder-agent-sprite";

export type RoderAgentAvatarSnapshot = { sprite: RoderAgentSprite | null; src: string | null };

export function createRoderAgentAvatarCache(
  readSprite: (id: string) => Promise<{ sprite: RoderAgentSprite | null; image: RoderAgentSpriteImage | null }>,
) {
  const cached = new Map<string, { version: number; value: RoderAgentAvatarSnapshot }>();
  const pending = new Map<string, Promise<RoderAgentAvatarSnapshot>>();
  return {
    peek: (id: string): RoderAgentAvatarSnapshot | null => cached.get(id)?.value ?? null,
    read(id: string, version: number): Promise<RoderAgentAvatarSnapshot> {
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

import { Compass } from "lucide-react";
import { useState } from "react";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { createPersistentAgentAvatarCache } from "@/lib/persistent-agent-avatar";
import { persistentAgentsIpc } from "@/lib/persistent-agents-ipc";
import type { PersistentAgentSprite } from "@/types/persistent-agent-sprite";
import { cn } from "@/lib/utils";

const avatars = createPersistentAgentAvatarCache(persistentAgentsIpc.readSprite);

export function PersistentAgentAvatar({
  id,
  sprite,
  size = 32,
}: {
  id: string;
  sprite: PersistentAgentSprite | null;
  size?: 32 | 64;
}): React.JSX.Element {
  return <AvatarImage key={`${id}:${sprite?.updatedAt ?? 0}`} id={id} version={sprite?.updatedAt ?? 0} size={size} />;
}

function AvatarImage({ id, version, size }: { id: string; version: number; size: 32 | 64 }): React.JSX.Element {
  const [src, setSrc] = useState(() => avatars.peek(id)?.src ?? null);
  const [unavailable, setUnavailable] = useState(false);
  useMountEffect(() => {
    let mounted = true;
    void avatars.read(id, version).then(
      (result) => {
        if (mounted) setSrc(result.src);
      },
      () => {
        if (mounted) setUnavailable(true);
      },
    );
    return () => {
      mounted = false;
    };
  });
  return (
    <span
      aria-hidden="true"
      title={unavailable ? "Character image unavailable" : undefined}
      className={cn("inline-flex shrink-0 items-center justify-center", size === 64 ? "size-16" : "size-8")}
    >
      {src ? (
        <img
          src={src}
          alt=""
          className="size-full object-contain"
          width={size}
          height={size}
          onError={() => {
            setSrc(null);
            setUnavailable(true);
          }}
        />
      ) : (
        <Compass className={cn("text-muted-foreground", size === 64 ? "size-8" : "size-5")} />
      )}
    </span>
  );
}

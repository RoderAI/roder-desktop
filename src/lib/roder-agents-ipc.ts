import type {
  RoderAgent,
  RoderAgentCreate,
  RoderAgentDetail,
  RoderAgentPromote,
  RoderAgentUpdate,
} from "@/types/roder-agents";
import type { RoderAgentSprite, RoderAgentSpriteImage } from "@/types/roder-agent-sprite";

function request<T>(method: string, params: unknown = {}): Promise<T> {
  return window.roderDesktop.request(`desktop/roders/${method}`, params) as Promise<T>;
}

export const roderAgentsIpc = {
  list: () => request<{ roders: RoderAgent[] }>("list"),
  read: (id: string) => request<RoderAgentDetail>("read", { id }),
  create: (params: RoderAgentCreate) => request<RoderAgentDetail>("create", params),
  promote: (params: RoderAgentPromote) => request<RoderAgentDetail>("promote", params),
  update: (params: RoderAgentUpdate) => request<RoderAgentDetail>("update", params),
  run: (id: string) => request<RoderAgentDetail>("run", { id }),
  schedule: (id: string, at: number, reason: string) => request<RoderAgentDetail>("schedule", { id, at, reason }),
  cancelWake: (id: string, wakeId: string) => request<RoderAgentDetail>("cancelWake", { id, wakeId }),
  compact: (id: string) => request<{ compacted: boolean; reason?: string }>("compact", { id }),
  readSprite: (id: string) =>
    request<{ sprite: RoderAgentSprite | null; image: RoderAgentSpriteImage | null }>("sprite/read", { id }),
  retrySprite: (id: string, provider: "codex" | "openai" = "codex") =>
    request<RoderAgentSprite>("sprite/retry", { id, provider }),
};

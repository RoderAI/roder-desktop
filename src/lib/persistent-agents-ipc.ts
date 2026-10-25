import type {
  PersistentAgent,
  PersistentAgentCreate,
  PersistentAgentDetail,
  PersistentAgentPromote,
  PersistentAgentUpdate,
} from "@/types/persistent-agents";
import type { PersistentAgentSprite, PersistentAgentSpriteImage } from "@/types/persistent-agent-sprite";

function request<T>(method: string, params: unknown = {}): Promise<T> {
  return window.roderDesktop.request(`desktop/persistent-agents/${method}`, params) as Promise<T>;
}

export const persistentAgentsIpc = {
  list: () => request<{ persistentAgents: PersistentAgent[] }>("list"),
  read: (id: string) => request<PersistentAgentDetail>("read", { id }),
  create: (params: PersistentAgentCreate) => request<PersistentAgentDetail>("create", params),
  promote: (params: PersistentAgentPromote) => request<PersistentAgentDetail>("promote", params),
  update: (params: PersistentAgentUpdate) => request<PersistentAgentDetail>("update", params),
  run: (id: string) => request<PersistentAgentDetail>("run", { id }),
  schedule: (id: string, at: number, reason: string) => request<PersistentAgentDetail>("schedule", { id, at, reason }),
  cancelWake: (id: string, wakeId: string) => request<PersistentAgentDetail>("cancelWake", { id, wakeId }),
  compact: (id: string) => request<{ compacted: boolean; reason?: string }>("compact", { id }),
  readSprite: (id: string) =>
    request<{ sprite: PersistentAgentSprite | null; image: PersistentAgentSpriteImage | null }>("sprite/read", { id }),
  retrySprite: (id: string, provider: "codex" | "openai" = "codex") =>
    request<PersistentAgentSprite>("sprite/retry", { id, provider }),
};

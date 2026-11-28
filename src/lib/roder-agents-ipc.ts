import type {
  RoderAgent,
  RoderAgentCreate,
  RoderAgentDetail,
  RoderAgentPromote,
  RoderAgentUpdate,
  RoderFile,
  RoderFilePath,
  RoderFileRestore,
  RoderFileVersion,
  RoderFileWrite,
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
  listFiles: (id: string) => request<{ files: RoderFileVersion[] }>("files/list", { id }),
  readFile: (id: string, path: RoderFilePath, version?: number) =>
    request<RoderFile>("files/read", { id, path, ...(version === undefined ? {} : { version }) }),
  fileHistory: (id: string, path: RoderFilePath) =>
    request<{ versions: RoderFileVersion[] }>("files/history", { id, path }),
  writeFile: (params: RoderFileWrite) => request<RoderFileVersion>("files/write", params),
  restoreFile: (params: RoderFileRestore) => request<RoderFileVersion>("files/restore", params),
  readSprite: (id: string) =>
    request<{ sprite: RoderAgentSprite | null; image: RoderAgentSpriteImage | null }>("sprite/read", { id }),
  retrySprite: (id: string, provider: "codex" | "openai" = "codex") =>
    request<RoderAgentSprite>("sprite/retry", { id, provider }),
};

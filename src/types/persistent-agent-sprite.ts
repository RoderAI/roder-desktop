export type PersistentAgentSpriteStatus = "queued" | "generating" | "ready" | "needs_credentials" | "failed";

export type PersistentAgentSprite = {
  agentId: string;
  generationProvider: "codex" | "openai";
  status: PersistentAgentSpriteStatus;
  attempts: number;
  updatedAt: number;
  error: string | null;
  asset: {
    fileName: string;
    artifactId: string | null;
    provider: "codex" | "openai";
    model: string | null;
    width: 256;
    height: 256;
    createdAt: number;
  } | null;
};

export type PersistentAgentSpriteImage = { mimeType: "image/png"; bytesBase64: string };

export type RoderAgentSpriteStatus = "queued" | "generating" | "ready" | "needs_credentials" | "failed";

export type RoderAgentSprite = {
  agentId: string;
  generationProvider: "codex" | "openai";
  status: RoderAgentSpriteStatus;
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

export type RoderAgentSpriteImage = { mimeType: "image/png"; bytesBase64: string };

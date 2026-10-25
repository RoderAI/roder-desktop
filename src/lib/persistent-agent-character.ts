import type { PersistentAgentSprite } from "@/types/persistent-agent-sprite";

export function persistentAgentCharacterPresentation(sprite: PersistentAgentSprite | null, apiKeyConfigured = false) {
  const provider = sprite?.generationProvider ?? "codex";
  const needsApiKey = provider === "openai" && sprite?.status === "needs_credentials" && !apiKeyConfigured;
  let description = "No character generated yet. Codex is the default.";
  if (sprite?.status === "ready") description = "Character ready";
  if (sprite?.status === "queued")
    description = provider === "codex" ? "Codex character queued" : "OpenAI API character queued";
  if (sprite?.status === "generating")
    description = provider === "codex" ? "Generating with Codex…" : "Generating with OpenAI API…";
  if (sprite?.status === "failed")
    description =
      provider === "codex" ? "Codex character generation failed." : "OpenAI API character generation failed.";
  if (sprite?.status === "needs_credentials") {
    description =
      provider === "codex"
        ? "Codex sign-in is required. Run codex login or sign in through the Codex app, then retry."
        : apiKeyConfigured
          ? "Image API key saved. Choose Generate with OpenAI API to start a billed job."
          : "An OpenAI API key is required only for the explicit OpenAI API route.";
  }
  return {
    description,
    needsApiKey,
    generationNotice:
      provider === "codex"
        ? "Codex uses a managed image model; its version is not reported. No OpenAI API fallback is used."
        : null,
    assetLabel: sprite?.asset
      ? `${sprite.asset.provider === "codex" && !sprite.asset.model ? "Codex-managed image model · version not reported" : `${sprite.asset.provider === "codex" ? "Codex" : "OpenAI API"} · ${sprite.asset.model || "Model not reported"}`} · ${sprite.asset.width} × ${sprite.asset.height}`
      : null,
  };
}

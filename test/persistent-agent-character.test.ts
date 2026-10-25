import { expect, test, vi } from "vitest";
import { persistentAgentCharacterPresentation } from "../src/lib/persistent-agent-character";
import { persistentAgentsIpc } from "../src/lib/persistent-agents-ipc";
import type { PersistentAgentSprite } from "../src/types/persistent-agent-sprite";

const sprite = (
  generationProvider: "codex" | "openai",
  status: PersistentAgentSprite["status"],
): PersistentAgentSprite => ({
  agentId: "pa-1",
  generationProvider,
  status,
  attempts: 1,
  updatedAt: 1,
  error: null,
  asset: null,
});

test("Codex sign-in and managed generation do not demand an OpenAI API key", () => {
  const signedOut = persistentAgentCharacterPresentation(sprite("codex", "needs_credentials"));
  expect(signedOut.needsApiKey).toBe(false);
  expect(signedOut.description).toBe(
    "Codex sign-in is required. Run codex login or sign in through the Codex app, then retry.",
  );
  const failed = persistentAgentCharacterPresentation(sprite("codex", "failed"));
  expect(failed.needsApiKey).toBe(false);
  expect(failed.generationNotice).toBe(
    "Codex uses a managed image model; its version is not reported. No OpenAI API fallback is used.",
  );
  expect(persistentAgentCharacterPresentation(sprite("codex", "generating")).description).toBe(
    "Generating with Codex…",
  );
});

test("only the explicit API route requests image-key setup", () => {
  expect(persistentAgentCharacterPresentation(sprite("openai", "needs_credentials")).needsApiKey).toBe(true);
  const configured = persistentAgentCharacterPresentation(sprite("openai", "needs_credentials"), true);
  expect(configured.needsApiKey).toBe(false);
  expect(configured.description).toBe("Image API key saved. Choose Generate with OpenAI API to start a billed job.");
});

test("asset attribution reports the actual provider and unknown model honestly", () => {
  const ready = {
    ...sprite("codex", "ready"),
    asset: {
      fileName: "character.png",
      artifactId: null,
      provider: "codex" as const,
      model: null,
      width: 256 as const,
      height: 256 as const,
      createdAt: 1,
    },
  };
  expect(persistentAgentCharacterPresentation(ready).assetLabel).toBe(
    "Codex-managed image model · version not reported · 256 × 256",
  );
});

test("retry defaults to Codex and never silently chooses the API route", async () => {
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async () => null);
  vi.stubGlobal("window", { roderDesktop: { request } });
  try {
    await persistentAgentsIpc.retrySprite("pa-1");
    expect(request).toHaveBeenLastCalledWith("desktop/persistent-agents/sprite/retry", {
      id: "pa-1",
      provider: "codex",
    });
    await persistentAgentsIpc.retrySprite("pa-1", "openai");
    expect(request).toHaveBeenLastCalledWith("desktop/persistent-agents/sprite/retry", {
      id: "pa-1",
      provider: "openai",
    });
  } finally {
    vi.unstubAllGlobals();
  }
});

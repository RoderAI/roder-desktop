import { spriteImageModel, type GeneratedSprite } from "./sprites";

const maxImageBytes = 10 * 1024 * 1024;
const maxResponseBytes = 15 * 1024 * 1024;
class OpenAiImageError extends Error {}

export function createOpenAiImageGenerator(options: {
  getApiKey: () => Promise<string | null>;
  fetch?: typeof globalThis.fetch;
}): (prompt: string) => Promise<GeneratedSprite> {
  return async (prompt) => {
    try {
      const key = await options.getApiKey();
      if (!key)
        throw new OpenAiImageError("OpenAI image API key is missing. Save an image API key or use the Codex route.");
      const response = await (options.fetch ?? globalThis.fetch)("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: spriteImageModel,
          prompt,
          n: 1,
          size: "1024x1024",
          output_format: "png",
          background: "transparent",
        }),
        signal: AbortSignal.timeout(180000),
        redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401 || response.status === 403)
          throw new OpenAiImageError(
            "OpenAI image API authentication failed. Check the API key and GPT Image 2.5 access.",
          );
        throw new OpenAiImageError(
          "OpenAI rejected the GPT Image 2.5 request. Check image access or retry manually; no other model was substituted.",
        );
      }
      if (Number(response.headers.get("content-length")) > maxResponseBytes) {
        await response.body?.cancel();
        throw new OpenAiImageError("OpenAI image response exceeds the size limit.");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new OpenAiImageError("OpenAI returned no image response.");
      const chunks: Uint8Array[] = [];
      let length = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maxResponseBytes) {
          await reader.cancel();
          throw new OpenAiImageError("OpenAI image response exceeds the size limit.");
        }
        chunks.push(value);
      }
      const result = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        model?: unknown;
        id?: unknown;
        data?: { b64_json?: unknown }[];
      };
      const model = result?.model === undefined ? spriteImageModel : result.model;
      if (typeof model !== "string" || (model !== spriteImageModel && !model.startsWith(`${spriteImageModel}-`)))
        throw new OpenAiImageError("OpenAI reported a different image model; no fallback model was accepted.");
      const encoded = result?.data?.length === 1 ? result.data[0]?.b64_json : undefined;
      if (
        typeof encoded !== "string" ||
        !encoded ||
        encoded.length > Math.ceil(maxImageBytes / 3) * 4 ||
        !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)
      )
        throw new OpenAiImageError("OpenAI did not return one bounded PNG image.");
      const bytes = Buffer.from(encoded, "base64");
      if (!bytes.length || bytes.length > maxImageBytes)
        throw new OpenAiImageError("OpenAI image exceeds the size limit.");
      const requestId = response.headers.get("x-request-id");
      const actualId = requestId ?? (typeof result.id === "string" ? result.id : null);
      return {
        bytes,
        model,
        artifactId: actualId && actualId.length <= 512 ? actualId : null,
      };
    } catch (error) {
      if (error instanceof OpenAiImageError) throw error;
      throw new OpenAiImageError(
        "OpenAI image generation could not complete. Check connectivity and retry manually; no automatic retry or model fallback was attempted.",
      );
    }
  };
}

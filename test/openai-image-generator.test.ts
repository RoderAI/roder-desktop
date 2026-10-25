import { expect, test, vi } from "vitest";
import { createOpenAiImageGenerator } from "../electron/persistent-agents/openai-image-generator";

const png = Buffer.from("test-png");
test("uses the explicit GPT Image 2.5 Flare API without trusting an old engine catalog", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }), {
      headers: { "x-request-id": "actual-request-id" },
    }),
  );
  const generate = createOpenAiImageGenerator({ getApiKey: async () => "test-private-key", fetch });
  expect(await generate("A playful moth")).toEqual({
    bytes: png,
    model: "gpt-image-2.5-flare",
    artifactId: "actual-request-id",
  });
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe("https://api.openai.com/v1/images/generations");
  expect(JSON.parse(options!.body as string)).toMatchObject({
    model: "gpt-image-2.5-flare",
    prompt: "A playful moth",
    background: "transparent",
    output_format: "png",
    n: 1,
  });
});
test("missing image credentials make no network request and never use a subscription token implicitly", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const generate = createOpenAiImageGenerator({ getApiKey: async () => null, fetch });
  await expect(generate("A moth")).rejects.toThrow(/API key/);
  expect(fetch).not.toHaveBeenCalled();
});
test("provider error bodies containing secrets are never surfaced and requests are never automatically retried", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(new Response("Bad key: test-private-key", { status: 401 }));
  const generate = createOpenAiImageGenerator({ getApiKey: async () => "test-private-key", fetch });
  await expect(generate("A moth")).rejects.toThrow(/^OpenAI image API authentication failed/);
  expect(fetch).toHaveBeenCalledTimes(1);
});
test("rejects a reported older model and does not fabricate request provenance", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ model: "gpt-image-2", data: [{ b64_json: png.toString("base64") }] })),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] })));
  const generate = createOpenAiImageGenerator({ getApiKey: async () => "test-private-key", fetch });
  await expect(generate("A moth")).rejects.toThrow(/different image model/);
  expect((await generate("A moth")).artifactId).toBeNull();
});
test("bounds JSON responses instead of accepting unbounded image data", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(new Response("{}", { headers: { "content-length": String(20 * 1024 * 1024) } }));
  const generate = createOpenAiImageGenerator({ getApiKey: async () => "test-private-key", fetch });
  await expect(generate("A moth")).rejects.toThrow(/limit/);
});

test("preserves an explicitly reported Flare snapshot identity instead of relabeling it", async () => {
  const model = "gpt-image-2.5-flare-2026-09-08";
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ model, data: [{ b64_json: png.toString("base64") }] })));
  const generate = createOpenAiImageGenerator({ getApiKey: async () => "test-private-key", fetch });
  expect((await generate("A moth")).model).toBe(model);
});

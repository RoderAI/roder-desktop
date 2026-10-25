import { expect, test, vi } from "vitest";
import { configureImageGenerationKey } from "../src/lib/persistent-agent-image-setup";

test("image credential setup sends only the trimmed key to the secure bridge", async () => {
  const configure = vi.fn<(params: { apiKey: string }) => Promise<{ configured: boolean }>>(async () => ({
    configured: true,
  }));
  const result = await configureImageGenerationKey("  temporary-test-key  ", configure);
  expect(configure).toHaveBeenCalledExactlyOnceWith({ apiKey: "temporary-test-key" });
  expect(result).toEqual({ configured: true, error: null });
});

test("credential bridge failures cannot echo the supplied key into UI errors", async () => {
  const result = await configureImageGenerationKey("temporary-test-key", async () => {
    throw new Error("Rejected temporary-test-key");
  });
  expect(result.configured).toBe(false);
  expect(result.error).toBe("Couldn’t save the image key. Try again.");
  expect(JSON.stringify(result)).not.toContain("temporary-test-key");
});

test("empty and unconfigured credentials are not reported as successful setup", async () => {
  const configure = vi.fn<(params: { apiKey: string }) => Promise<{ configured: boolean }>>(async () => ({
    configured: false,
  }));
  expect((await configureImageGenerationKey(" ", configure)).configured).toBe(false);
  expect(configure).not.toHaveBeenCalled();
  expect(await configureImageGenerationKey("temporary-test-key", configure)).toEqual({
    configured: false,
    error: "The image key was not configured. Try again.",
  });
});

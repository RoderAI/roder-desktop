import { expect, test, vi } from "vitest";

test("thread usage is grouped by model, scoped to the thread and bounded to the server limit", async () => {
  const rows = [{ group: "openai/test", promptTokens: 100, completionTokens: 20, cachedPromptTokens: 10 }];
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>().mockResolvedValue({ rows });
  vi.stubGlobal("window", { roderDesktop: { request } });
  try {
    const { roderIpc } = await import("@/lib/roder-ipc");
    expect(await roderIpc.threadTokenUsage("thread-1")).toEqual({ rows });
    expect(request).toHaveBeenCalledWith("stats/tokens", {
      filter: { threadId: "thread-1", limit: 1000 },
      group: "model",
    });
  } finally {
    vi.unstubAllGlobals();
  }
});

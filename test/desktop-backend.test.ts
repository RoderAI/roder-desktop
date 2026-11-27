import { describe, expect, it, vi } from "vitest";
import { prepareAntigravityBackend } from "../electron/roder/desktop-backend";

describe("Antigravity backend selection", () => {
  it("keeps the current backend if Google sign-in is unavailable", async () => {
    const candidate = {
      start: vi.fn().mockRejectedValue(new Error("Sign in first")),
      request: vi.fn(),
      stop: vi.fn(),
    };
    await expect(prepareAntigravityBackend(candidate)).rejects.toThrow("Sign in first");
    expect(candidate.stop).toHaveBeenCalledOnce();
    expect(candidate.request).not.toHaveBeenCalled();
  });

  it("rejects an empty or non-Antigravity catalog", async () => {
    const candidate = {
      start: vi.fn(),
      request: vi.fn().mockResolvedValue({ models: [{ id: "gemini", modelProvider: "gemini" }] }),
      stop: vi.fn(),
    };
    await expect(prepareAntigravityBackend(candidate)).rejects.toThrow("No Antigravity models");
    expect(candidate.stop).toHaveBeenCalledOnce();
  });

  it("returns the verified backend without stopping it", async () => {
    const candidate = {
      start: vi.fn(),
      request: vi.fn().mockResolvedValue({ models: [{ id: "account-model", modelProvider: "antigravity" }] }),
      stop: vi.fn(),
    };
    await expect(prepareAntigravityBackend(candidate)).resolves.toBe(candidate);
    expect(candidate.request).toHaveBeenCalledWith("model/list", {});
    expect(candidate.stop).not.toHaveBeenCalled();
  });
});

import { expect, test, vi } from "vitest";
import { applyDesktopTurnPolicy } from "../electron/roder/desktop-turn-policy";

test("sets the thread policy before forwarding the turn without a runtime policy change", async () => {
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async () => ({ mode: "bypass" }));
  const input = { threadId: "thread-1", policyMode: "bypass", input: [{ type: "text", text: "Continue" }] };

  const forwarded = await applyDesktopTurnPolicy(request, input);

  expect(request).toHaveBeenCalledExactlyOnceWith("thread/set_mode", {
    threadId: "thread-1",
    mode: "bypass",
    reason: "desktop turn permissions",
  });
  expect(forwarded).toEqual({ threadId: input.threadId, input: input.input });
});

test("leaves a turn with no policy alone and propagates a failed policy change", async () => {
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async () => {
    throw new Error("Could not set policy");
  });
  const input = { threadId: "thread-1", prompt: "Continue" };

  await expect(applyDesktopTurnPolicy(request, input)).resolves.toBe(input);
  expect(request).not.toHaveBeenCalled();
  await expect(applyDesktopTurnPolicy(request, { ...input, policyMode: "plan" })).rejects.toThrow(
    "Could not set policy",
  );
});

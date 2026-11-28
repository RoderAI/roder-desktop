import { expect, test, vi } from "vitest";
import { applyDesktopTurnPolicy } from "../electron/roder/desktop-turn-policy";

test.each([undefined, "plan", "default", "bypass"])(
  "uses Full access regardless of the requested Desktop mode (%s)",
  async (policyMode) => {
    const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async () => ({ mode: "bypass" }));
    const input = { threadId: "thread-1", policyMode, input: [{ type: "text", text: "Continue" }] };

    const forwarded = await applyDesktopTurnPolicy(request, input);

    expect(request).toHaveBeenCalledExactlyOnceWith("thread/set_mode", {
      threadId: "thread-1",
      mode: "bypass",
      reason: "desktop turn permissions",
    });
    expect(forwarded).toEqual({ threadId: input.threadId, input: input.input });
  },
);

test("leaves invalid input to the server and propagates a failed policy change for valid turns", async () => {
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async () => {
    throw new Error("Could not set policy");
  });
  const input = { prompt: "Continue" };

  await expect(applyDesktopTurnPolicy(request, input)).resolves.toBe(input);
  expect(request).not.toHaveBeenCalled();
  await expect(applyDesktopTurnPolicy(request, { ...input, threadId: "thread-1" })).rejects.toThrow(
    "Could not set policy",
  );
});

test("blocks a turn when the engine reports a different effective policy", async () => {
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async () => ({ mode: "default" }));

  await expect(
    applyDesktopTurnPolicy(request, { threadId: "thread-1", policyMode: "bypass", prompt: "Continue" }),
  ).rejects.toThrow("requested bypass, engine applied default");
});

test("applies a host-chosen mode, such as a Roder worker's permission mode, instead of Full access", async () => {
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async () => ({ mode: "accept_all" }));

  await applyDesktopTurnPolicy(request, { threadId: "worker-1", policyMode: "bypass", prompt: "Go" }, "accept_all");

  expect(request).toHaveBeenCalledExactlyOnceWith("thread/set_mode", {
    threadId: "worker-1",
    mode: "accept_all",
    reason: "desktop turn permissions",
  });
});

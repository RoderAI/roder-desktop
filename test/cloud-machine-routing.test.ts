import { expect, test, vi } from "vitest";
import { cloudMachineThreadParams } from "../electron/cloud-machines/thread-routing";
import type { ThreadRunner } from "../src/lib/cloud-machines";

test("unmanaged thread creation leaves caller runner intent unchanged", async () => {
  const runnerFor = vi.fn<(id: string) => Promise<ThreadRunner>>();
  expect(await cloudMachineThreadParams({ workspaceId: "ws" }, runnerFor)).toEqual({ workspaceId: "ws" });
  expect(runnerFor).not.toHaveBeenCalled();
});

test.each(["/local", "C:\\Users\\user\\project"])(
  "an explicit local selection preserves native execution for %s",
  async (cwd) => {
    const runnerFor = vi.fn<(id: string) => Promise<ThreadRunner>>();
    const activeRunnerFor = vi.fn<() => Promise<null>>().mockResolvedValue(null);
    const params = await cloudMachineThreadParams({ desktopCloudMachineId: "", cwd }, runnerFor, activeRunnerFor);
    expect(params).toEqual({ cwd });
    expect(params).not.toHaveProperty("runner");
    expect(activeRunnerFor).toHaveBeenCalledOnce();
    expect(runnerFor).not.toHaveBeenCalled();
  },
);

test("local execution leaves workspace resolution to the native thread API", async () => {
  expect(
    await cloudMachineThreadParams({ desktopCloudMachineId: "", workspaceId: "ws" }, vi.fn(), async () => null),
  ).toEqual({ workspaceId: "ws" });
});

test.each([{ provider_id: "sprites", destination_id: "global" }, undefined])(
  "local execution fails closed for an active or unknown global runner state: %j",
  async (active) => {
    const runnerFor = vi.fn<(id: string) => Promise<ThreadRunner>>();
    await expect(
      cloudMachineThreadParams({ desktopCloudMachineId: "", cwd: "/local" }, runnerFor, async () => active),
    ).rejects.toThrow("global runner");
    expect(runnerFor).not.toHaveBeenCalled();
  },
);

test("local execution fails closed if runner discovery is unavailable", async () => {
  const runnerFor = vi.fn<(id: string) => Promise<ThreadRunner>>();
  await expect(cloudMachineThreadParams({ desktopCloudMachineId: "", cwd: "/local" }, runnerFor)).rejects.toThrow(
    "global runner",
  );
  await expect(
    cloudMachineThreadParams({ desktopCloudMachineId: "", cwd: "/local" }, runnerFor, async () => {
      throw new Error("Runner discovery failed");
    }),
  ).rejects.toThrow("Runner discovery failed");
  expect(runnerFor).not.toHaveBeenCalled();
});

test("resolves a machine into a per-thread binding and strips the desktop-only field", async () => {
  const runner = { providerId: "sprites", workspace: "/workspace", config: { sprite_name: "dev" } };
  const runnerFor = vi.fn<(id: string) => Promise<ThreadRunner>>().mockResolvedValue(runner);
  expect(await cloudMachineThreadParams({ workspaceId: "ws", desktopCloudMachineId: "dev" }, runnerFor)).toEqual({
    workspaceId: "ws",
    runner,
  });
  expect(runnerFor).toHaveBeenCalledWith("dev");
});

test("a missing or invalid machine fails closed instead of executing locally", async () => {
  await expect(
    cloudMachineThreadParams({ desktopCloudMachineId: "deleted" }, async () => {
      throw new Error("Machine not found");
    }),
  ).rejects.toThrow("Machine not found");
  await expect(cloudMachineThreadParams({ desktopCloudMachineId: 42 }, vi.fn())).rejects.toThrow(
    "Choose one valid cloud machine",
  );
});

test("rejects an ambiguous explicit runner with a desktop machine selection", async () => {
  await expect(cloudMachineThreadParams({ desktopCloudMachineId: "dev", runner: {} }, vi.fn())).rejects.toThrow(
    "Choose one valid cloud machine",
  );
});

test("Windows rejects cloud execution before resolving or launching the runner", async () => {
  const runnerFor = vi.fn<(id: string) => Promise<ThreadRunner>>();
  const activeRunnerFor = vi.fn<() => Promise<null>>();
  await expect(
    cloudMachineThreadParams({ desktopCloudMachineId: "dev" }, runnerFor, activeRunnerFor, "win32"),
  ).rejects.toThrow("Cloud machines are not supported on Windows yet");
  expect(runnerFor).not.toHaveBeenCalled();
  expect(activeRunnerFor).not.toHaveBeenCalled();
});

test("Windows local execution remains native and checks global runner state", async () => {
  const runnerFor = vi.fn<(id: string) => Promise<ThreadRunner>>();
  const activeRunnerFor = vi.fn<() => Promise<null>>().mockResolvedValue(null);
  expect(
    await cloudMachineThreadParams(
      { desktopCloudMachineId: "", cwd: "C:\\Users\\user\\project" },
      runnerFor,
      activeRunnerFor,
      "win32",
    ),
  ).toEqual({ cwd: "C:\\Users\\user\\project" });
  expect(runnerFor).not.toHaveBeenCalled();
  expect(activeRunnerFor).toHaveBeenCalledOnce();
});

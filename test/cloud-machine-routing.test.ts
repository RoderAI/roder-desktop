import { expect, test, vi } from "vitest";
import { cloudMachineThreadParams } from "../electron/cloud-machines/thread-routing";
import type { ThreadRunner } from "../src/lib/cloud-machines";

test("unmanaged thread creation leaves caller runner intent unchanged", async () => {
  const runnerFor = vi.fn<(id: string) => Promise<ThreadRunner>>();
  expect(await cloudMachineThreadParams({ workspaceId: "ws" }, runnerFor)).toEqual({ workspaceId: "ws" });
  expect(runnerFor).not.toHaveBeenCalled();
});

test("an explicit local selection overrides inherited remote destinations without mutating global state", async () => {
  const runnerFor = vi.fn<(id: string) => Promise<ThreadRunner>>();
  const params = await cloudMachineThreadParams({ desktopCloudMachineId: "", cwd: "/local" }, runnerFor);
  expect(params).toEqual({ cwd: "/local", runner: { providerId: "unix-local", workspace: "/local", config: {} } });
  expect(runnerFor).not.toHaveBeenCalled();
});

test("local execution resolves the workspace root when cwd is omitted and fails closed without one", async () => {
  const resolveRoot = vi.fn<(input: Record<string, unknown>) => Promise<string>>().mockResolvedValue("/local");
  expect(
    await cloudMachineThreadParams({ desktopCloudMachineId: "", workspaceId: "ws" }, vi.fn(), resolveRoot),
  ).toEqual({ workspaceId: "ws", runner: { providerId: "unix-local", workspace: "/local", config: {} } });
  expect(resolveRoot).toHaveBeenCalledWith({ workspaceId: "ws" });
  await expect(cloudMachineThreadParams({ desktopCloudMachineId: "" }, vi.fn())).rejects.toThrow(
    "A workspace is required",
  );
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

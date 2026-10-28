import { WINDOWS_CLOUD_MACHINES_NOTICE, type ThreadRunner } from "../../src/lib/cloud-machines";

export async function cloudMachineThreadParams(
  params: unknown,
  runnerFor: (id: string) => Promise<ThreadRunner>,
  activeRunnerFor?: () => Promise<unknown>,
  platform: NodeJS.Platform = process.platform,
): Promise<Record<string, unknown>> {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new Error("Thread parameters must be an object.");
  }
  const { desktopCloudMachineId, ...input } = params as Record<string, unknown>;
  if (desktopCloudMachineId === undefined) return input;
  if (typeof desktopCloudMachineId !== "string" || input.runner !== undefined) {
    throw new Error("Choose one valid cloud machine for this thread.");
  }
  if (desktopCloudMachineId === "") {
    // Upstream has no per-thread native-local override for an active global runner.
    // A unix-local binding is not equivalent: it changes shell and filesystem behavior.
    if (!activeRunnerFor || (await activeRunnerFor()) !== null) {
      throw new Error(
        "Local execution is unavailable while a global runner is configured. Clear the global runner configuration and restart the app, or choose a cloud machine.",
      );
    }
    return input;
  }
  if (platform === "win32") throw new Error(WINDOWS_CLOUD_MACHINES_NOTICE);
  return { ...input, runner: await runnerFor(desktopCloudMachineId) };
}

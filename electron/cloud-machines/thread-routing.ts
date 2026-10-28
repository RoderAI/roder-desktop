import type { ThreadRunner } from "../../src/lib/cloud-machines";

export async function cloudMachineThreadParams(
  params: unknown,
  runnerFor: (id: string) => Promise<ThreadRunner>,
  localWorkspaceFor?: (input: Record<string, unknown>) => Promise<string>,
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
    const workspace = typeof input.cwd === "string" && input.cwd ? input.cwd : await localWorkspaceFor?.(input);
    if (!workspace) throw new Error("A workspace is required for local execution.");
    // Omission inherits upstream's global remote destination; bind local explicitly instead.
    return { ...input, runner: { providerId: "unix-local", workspace, config: {} } };
  }
  return { ...input, runner: await runnerFor(desktopCloudMachineId) };
}

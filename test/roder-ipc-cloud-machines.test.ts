import { expect, test, vi } from "vitest";

test("cloud machine IPC uses desktop CRUD and sends only a profile ID when starting threads", async () => {
  vi.resetModules();
  const runner = { providerId: "sprites", workspace: "/workspace", config: { sprite_name: "dev" } };
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method) =>
    method === "thread/start" ? { thread: { id: "remote-thread", runner }, model: "model" } : {},
  );
  globalThis.window = { roderDesktop: { request } } as unknown as Window & typeof globalThis;
  const { roderIpc } = await import("../src/lib/roder-ipc");
  await roderIpc.listRunners();
  await roderIpc.listCloudMachines();
  const profile = { name: "Dev", ...runner };
  await roderIpc.saveCloudMachine(profile);
  await roderIpc.removeCloudMachine("machine-id");
  const result = await roderIpc.startThread("model", { workspaceId: "ws" }, "openai", undefined, {
    cloudMachineId: "machine-id",
  });
  expect(request).toHaveBeenCalledWith("runners/list", {});
  expect(request).toHaveBeenCalledWith("desktop/cloud-machines/list", {});
  expect(request).toHaveBeenCalledWith("desktop/cloud-machines/save", profile);
  expect(request).toHaveBeenCalledWith("desktop/cloud-machines/remove", { id: "machine-id" });
  expect(request).toHaveBeenCalledWith(
    "thread/start",
    expect.objectContaining({
      desktopCloudMachineId: "machine-id",
      workspaceId: "ws",
    }),
  );
  expect(result.thread.runner).toEqual(runner);
});

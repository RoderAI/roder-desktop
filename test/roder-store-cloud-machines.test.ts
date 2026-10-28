import { expect, test, vi } from "vitest";

test("new prompts use the chosen machine while resumed threads keep their original binding", async () => {
  vi.resetModules();
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  const runner = { providerId: "sprites", workspace: "/remote", config: { sprite_name: "dev" } };
  const thread = {
    id: "thread-remote",
    preview: "Remote",
    model: "model",
    modelProvider: "openai",
    cwd: "/workspace",
    workspaceId: "ws",
    rootId: "root",
    runner,
    status: { type: "idle", activeTurnId: null, activeFlags: [] },
    createdAt: 1,
    updatedAt: 1,
  };
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method) => {
    if (method === "thread/start") return { thread };
    if (method === "turn/start") return { turnId: "turn-1" };
    return {};
  });
  globalThis.window = {
    localStorage: storage,
    roderDesktop: { request, onNotification: () => () => {}, onStderr: () => () => {}, onStatus: () => () => {} },
  } as unknown as Window & typeof globalThis;
  const { useCloudMachinesStore } = await import("../src/stores/cloud-machines-store");
  const { useRoderStore } = await import("../src/stores/roder-store");
  useCloudMachinesStore.getState().select("machine-id");
  useRoderStore.setState({
    activeThreadId: "",
    busy: false,
    status: { state: "ready", binary: "test", cwd: "/workspace" },
    selectedWorkspaceId: "ws",
    selectedRootId: "root",
    selectedWorkspaceCwd: "/workspace",
    workspaces: [
      {
        id: "ws",
        name: "Workspace",
        roots: [{ id: "root", name: "Root", path: "/workspace" }],
        defaultRootId: "root",
        updatedAt: 1,
      },
    ],
    selectedModel: "model",
    selectedModelProvider: "openai",
    selectedSelectionMode: { type: "manual", provider: "openai", model: "model" },
    models: [{ id: "model", name: "Model", modelProvider: "openai" }],
  });
  await useRoderStore.getState().sendPrompt("first remote prompt");
  expect(request).toHaveBeenCalledWith(
    "thread/start",
    expect.objectContaining({ desktopCloudMachineId: "machine-id" }),
  );
  expect(useRoderStore.getState().threads.find((entry) => entry.id === thread.id)?.runner).toEqual(runner);
  expect(useRoderStore.getState().error).toBeNull();

  useCloudMachinesStore.getState().select("another-machine");
  useRoderStore.setState({ busy: false, threads: [thread], threadDetails: { [thread.id]: thread } });
  await useRoderStore.getState().sendPrompt("continue on the original machine");
  expect(request.mock.calls.filter(([method]) => method === "thread/start")).toHaveLength(1);
  expect(useRoderStore.getState().threads.find((entry) => entry.id === thread.id)?.runner).toEqual(runner);

  useCloudMachinesStore.getState().select("");
  useRoderStore.setState({ activeThreadId: "", busy: false });
  await useRoderStore.getState().sendPrompt("start a local thread");
  expect(request).toHaveBeenLastCalledWith("turn/start", expect.anything());
  expect(request.mock.calls.filter(([method]) => method === "thread/start").at(-1)?.[1]).toEqual(
    expect.objectContaining({ desktopCloudMachineId: "" }),
  );
});

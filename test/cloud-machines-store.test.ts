import { expect, test, vi } from "vitest";

async function loadStore(request: (method: string, params?: unknown) => Promise<unknown>) {
  vi.resetModules();
  const saved = new Map<string, string>();
  const storage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  globalThis.window = { localStorage: storage, roderDesktop: { request } } as unknown as Window & typeof globalThis;
  const { useCloudMachinesStore } = await import("../src/stores/cloud-machines-store");
  return { store: useCloudMachinesStore, saved };
}

test("discovery preserves missing selections rather than silently switching to local", async () => {
  const { store } = await loadStore(async (method) =>
    method === "runners/list" ? { providers: [{ provider_id: "sprites", capabilities: {} }] } : { machines: [] },
  );
  store.getState().select("removed-profile");
  await store.getState().refresh();
  expect(store.getState().selectedMachineId).toBe("removed-profile");
  expect(store.getState().providers[0].provider_id).toBe("sprites");
});

test("save refreshes profiles, but only the selected ID is persisted in renderer storage", async () => {
  const machine = { id: "dev", name: "Dev", providerId: "sprites", workspace: "/workspace" };
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method) => {
    if (method === "runners/list") return { providers: [{ provider_id: "sprites", capabilities: {} }] };
    if (method === "desktop/cloud-machines/list") return { machines: [machine] };
    return { machine };
  });
  const { store, saved } = await loadStore(request);
  await store.getState().save({ ...machine, config: { sprite_name: "private-machine-name" } });
  store.getState().select("dev");
  expect(store.getState().machines).toEqual([machine]);
  expect(JSON.parse(saved.get("roder-cloud-machine-selection")!).state).toEqual({ selectedMachineId: "dev" });
  expect([...saved.values()].join("")).not.toContain("private-machine-name");
});

test("unavailable profile storage surfaces an error and never clears the chosen machine", async () => {
  const { store } = await loadStore(async () => {
    throw new Error("Encryption unavailable");
  });
  store.getState().select("dev");
  await store.getState().refresh();
  expect(store.getState().error).toBe("Encryption unavailable");
  expect(store.getState().busy).toBe(false);
  expect(store.getState().selectedMachineId).toBe("dev");
  await expect(store.getState().remove("dev")).rejects.toThrow("Encryption unavailable");
  expect(store.getState().selectedMachineId).toBe("dev");
});

import { expect, test, vi } from "vitest";

async function loadRoderStore() {
  vi.resetModules();
  const localStorage = {
    getItem: vi.fn<(key: string) => string | null>(() => null),
    setItem: vi.fn<(key: string, value: string) => void>(),
    removeItem: vi.fn<(key: string) => void>(),
    clear: vi.fn<() => void>(),
    key: vi.fn<(index: number) => string | null>(() => null),
    length: 0,
  } as unknown as Storage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorage,
  });
  globalThis.window = {
    localStorage,
    roderDesktop: {
      start: vi.fn<() => void>(),
      restart: vi.fn<() => void>(),
      status: vi.fn<() => void>(),
      appearance: vi.fn<() => void>(),
      openWorkspaceFolder: vi.fn<() => void>(),
      request: vi.fn<(method: string, params?: unknown) => Promise<unknown>>(),
      onAppearance: () => () => undefined,
      onNotification: () => () => undefined,
      onStatus: () => () => undefined,
      onStderr: () => () => undefined,
    },
  } as unknown as Window & typeof globalThis;

  const module = await import("../src/stores/roder-store");
  module.useRoderStore.setState({
    activeThreadId: "thread-1",
    hunkRevisionByThread: {},
  });
  return module.useRoderStore;
}

test("hunk recorded notifications bump the hunk revision for the changed thread", async () => {
  const useRoderStore = await loadRoderStore();

  useRoderStore.getState().applyNotification({
    method: "hunk/recorded",
    params: {
      hunk: {
        threadId: "thread-1",
      },
    },
  });
  useRoderStore.getState().applyNotification({
    method: "hunk/recorded",
    params: {
      hunk: {
        threadId: "thread-1",
      },
    },
  });

  expect(useRoderStore.getState().hunkRevisionByThread).toEqual({
    "thread-1": 2,
  });
});

test("observed workspace change notifications refresh review summaries", async () => {
  const useRoderStore = await loadRoderStore();

  useRoderStore.getState().applyNotification({
    method: "workspace/changeObserved",
    params: {
      change: {
        threadId: "thread-1",
      },
    },
  });

  expect(useRoderStore.getState().hunkRevisionByThread).toEqual({
    "thread-1": 1,
  });
});

import { afterEach, expect, test, vi } from "vitest";

// oxlint-disable-next-line typescript/no-explicit-any -- loose signature for test doubles
type AnyFn = (...args: any[]) => any;

const setFeedURL = vi.fn<AnyFn>();
const checkForUpdates = vi.fn<AnyFn>();
const on = vi.fn<AnyFn>();
const quitAndInstall = vi.fn<AnyFn>();

vi.mock("electron", () => ({
  app: {
    getVersion: () => "0.1.1",
  },
  autoUpdater: {
    setFeedURL,
    checkForUpdates,
    on,
    quitAndInstall,
  },
  dialog: {
    showMessageBox: vi.fn<AnyFn>(async () => ({ response: 1 })),
  },
  shell: {
    openExternal: vi.fn<AnyFn>(async () => undefined),
  },
}));

afterEach(() => {
  setFeedURL.mockClear();
  checkForUpdates.mockClear();
  on.mockClear();
  quitAndInstall.mockClear();
  vi.resetModules();
});

test("feed check marks update available without starting native download", async () => {
  const { createAutoUpdateController, MACOS_UPDATE_FEED_URL } = await import("../electron/main/auto-update");
  const fetchImpl = vi.fn<AnyFn>(async () => ({
    ok: true,
    json: async () => ({
      url: "https://dl.roder.sh/desktop/latest/Roder-macos-arm64.zip",
      name: "0.1.2",
      notes: "newer",
      pub_date: "2026-07-21T00:00:00Z",
    }),
  })) as unknown as typeof fetch;

  const controller = createAutoUpdateController({
    getMainWindow: () => null,
    isPackaged: true,
    platform: "darwin",
    currentVersion: "0.1.1",
    fetchImpl,
  });

  const status = await controller.checkForUpdates({ interactive: false });

  expect(fetchImpl).toHaveBeenCalledWith(
    MACOS_UPDATE_FEED_URL,
    expect.objectContaining({ headers: expect.any(Object) }),
  );
  expect(status).toEqual({
    state: "available",
    currentVersion: "0.1.1",
    availableVersion: "0.1.2",
  });
  expect(setFeedURL).not.toHaveBeenCalled();
});

test("installUpdate starts native updater when packaged on macOS", async () => {
  const { createAutoUpdateController } = await import("../electron/main/auto-update");
  const fetchImpl = vi.fn<AnyFn>(async () => ({
    ok: true,
    json: async () => ({
      url: "https://dl.roder.sh/desktop/latest/Roder-macos-arm64.zip",
      name: "0.1.2",
      notes: "newer",
    }),
  })) as unknown as typeof fetch;

  const controller = createAutoUpdateController({
    getMainWindow: () => null,
    isPackaged: true,
    platform: "darwin",
    currentVersion: "0.1.1",
    fetchImpl,
  });

  await controller.checkForUpdates({ interactive: false });
  await controller.installUpdate();

  expect(setFeedURL).toHaveBeenCalled();
  expect(checkForUpdates).toHaveBeenCalledOnce();
  expect(controller.getStatus().state).toBe("downloading");
});

test("dev builds open the download URL instead of native updater", async () => {
  const openExternal = vi.fn<AnyFn>(async () => undefined);
  const { createAutoUpdateController } = await import("../electron/main/auto-update");
  const fetchImpl = vi.fn<AnyFn>(async () => ({
    ok: true,
    json: async () => ({
      url: "https://dl.roder.sh/desktop/latest/Roder-macos-arm64.zip",
      name: "0.1.2",
      notes: "newer",
    }),
  })) as unknown as typeof fetch;

  const controller = createAutoUpdateController({
    getMainWindow: () => null,
    isPackaged: false,
    platform: "darwin",
    currentVersion: "0.1.1",
    fetchImpl,
    openExternal,
  });

  await controller.checkForUpdates({ interactive: false });
  await controller.installUpdate();

  expect(openExternal).toHaveBeenCalledWith("https://dl.roder.sh/desktop/latest/Roder-macos-arm64.zip");
  expect(setFeedURL).not.toHaveBeenCalled();
});

test("native and background checks keep a download visible until restart is ready", async () => {
  const { createAutoUpdateController } = await import("../electron/main/auto-update");
  const fetchFeed = vi.fn<AnyFn>(async () => ({
    ok: true,
    json: async () => ({ url: "https://example.com/roder.zip", name: "0.1.2" }),
  }));
  const controller = createAutoUpdateController({
    getMainWindow: () => null,
    isPackaged: true,
    platform: "darwin",
    currentVersion: "0.1.1",
    fetchImpl: fetchFeed as unknown as typeof fetch,
  });
  const emit = (event: string, ...args: unknown[]) => {
    const listener = on.mock.calls.find(([name]) => name === event)?.[1];
    listener?.(...args);
  };
  await controller.checkForUpdates();
  await controller.installUpdate();
  emit("checking-for-update");
  expect(controller.getStatus().state).toBe("downloading");
  emit("update-available");
  expect((await controller.installUpdate()).state).toBe("downloading");
  expect((await controller.checkForUpdates()).state).toBe("downloading");
  expect(checkForUpdates).toHaveBeenCalledOnce();
  emit("update-downloaded", {}, "", "0.1.2");
  expect((await controller.checkForUpdates()).state).toBe("ready");
  expect(fetchFeed).toHaveBeenCalledOnce();
  expect(quitAndInstall).not.toHaveBeenCalled();
  await controller.installUpdate();
  expect(quitAndInstall).toHaveBeenCalledOnce();
});

test("a failed native download can retry without losing the available release", async () => {
  const { createAutoUpdateController } = await import("../electron/main/auto-update");
  const fetchFeed = vi.fn<AnyFn>(async () => ({
    ok: true,
    json: async () => ({ url: "https://example.com/roder.zip", name: "0.1.2" }),
  }));
  checkForUpdates.mockImplementationOnce(() => {
    throw new Error("Download unavailable");
  });
  const controller = createAutoUpdateController({
    getMainWindow: () => null,
    isPackaged: true,
    platform: "darwin",
    currentVersion: "0.1.1",
    fetchImpl: fetchFeed as unknown as typeof fetch,
  });
  await controller.checkForUpdates();
  expect(await controller.installUpdate()).toMatchObject({
    state: "error",
    availableVersion: "0.1.2",
    message: "Download unavailable",
  });
  expect(await controller.installUpdate()).toMatchObject({ state: "downloading", availableVersion: "0.1.2" });
  expect(fetchFeed).toHaveBeenCalledOnce();
  expect(checkForUpdates).toHaveBeenCalledTimes(2);
});

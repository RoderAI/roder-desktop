import { afterEach, expect, test, vi } from "vitest";

const setFeedURL = vi.fn();
const checkForUpdates = vi.fn();
const on = vi.fn();
const quitAndInstall = vi.fn();

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
    showMessageBox: vi.fn(async () => ({ response: 1 })),
  },
  shell: {
    openExternal: vi.fn(async () => undefined),
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
  const fetchImpl = vi.fn(async () => ({
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
  const fetchImpl = vi.fn(async () => ({
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
  const openExternal = vi.fn(async () => undefined);
  const { createAutoUpdateController } = await import("../electron/main/auto-update");
  const fetchImpl = vi.fn(async () => ({
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

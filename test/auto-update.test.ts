import { afterEach, expect, test, vi } from "vitest";

const setFeedURL = vi.fn();
const checkForUpdates = vi.fn();
const on = vi.fn();

vi.mock("electron", () => ({
  autoUpdater: {
    setFeedURL,
    checkForUpdates,
    on,
    quitAndInstall: vi.fn(),
  },
  dialog: {
    showMessageBox: vi.fn(async () => ({ response: 1 })),
  },
}));

afterEach(() => {
  setFeedURL.mockClear();
  checkForUpdates.mockClear();
  on.mockClear();
  vi.resetModules();
});

test("macOS packaged builds configure the Sparkle-compatible JSON feed", async () => {
  const { createAutoUpdateController, MACOS_UPDATE_FEED_URL } = await import("../electron/main/auto-update");
  const controller = createAutoUpdateController({
    getMainWindow: () => null,
    isPackaged: true,
    platform: "darwin",
  });

  controller.checkForUpdates({ interactive: false });

  expect(setFeedURL).toHaveBeenCalledWith({
    url: MACOS_UPDATE_FEED_URL,
    serverType: "json",
  });
  expect(checkForUpdates).toHaveBeenCalledOnce();
});

test("dev and non-mac platforms skip auto-update checks", async () => {
  const { createAutoUpdateController } = await import("../electron/main/auto-update");

  createAutoUpdateController({
    getMainWindow: () => null,
    isPackaged: false,
    platform: "darwin",
  }).checkForUpdates({ interactive: true });

  createAutoUpdateController({
    getMainWindow: () => null,
    isPackaged: true,
    platform: "win32",
  }).checkForUpdates({ interactive: true });

  expect(setFeedURL).not.toHaveBeenCalled();
  expect(checkForUpdates).not.toHaveBeenCalled();
});

import { autoUpdater, dialog, type BrowserWindow } from "electron";

/** Sparkle-compatible JSON feed on R2 (published by release CI). */
export const MACOS_UPDATE_FEED_URL = "https://dl.roder.sh/desktop/latest/updates.json";

/** Sparkle XML appcast on R2 (published by release CI alongside the zip). */
export const MACOS_SPARKLE_APPCAST_URL = "https://dl.roder.sh/desktop/latest/appcast.xml";

export type AutoUpdateController = {
  checkForUpdates: (options?: { interactive?: boolean }) => void;
};

type AutoUpdateDeps = {
  getMainWindow: () => BrowserWindow | null;
  isPackaged?: boolean;
  platform?: NodeJS.Platform;
  feedUrl?: string;
};

/**
 * macOS: Electron autoUpdater is built on Squirrel.Mac (Sparkle-based).
 * Feeds are published to Cloudflare R2 (dl.roder.sh) from release CI.
 * Windows: Squirrel.Windows uses RELEASES from the install channel — left to follow-up.
 */
export function createAutoUpdateController(deps: AutoUpdateDeps): AutoUpdateController {
  const isPackaged = deps.isPackaged ?? true;
  const platform = deps.platform ?? process.platform;
  const feedUrl = deps.feedUrl ?? MACOS_UPDATE_FEED_URL;
  let interactiveCheck = false;
  let started = false;

  const noop: AutoUpdateController = {
    checkForUpdates: () => undefined,
  };

  if (!isPackaged || platform !== "darwin") {
    return noop;
  }

  const showError = (message: string) => {
    if (!interactiveCheck) {
      return;
    }
    void dialog.showMessageBox({
      type: "info",
      message: "Unable to check for updates",
      detail: message,
      buttons: ["OK"],
    });
  };

  const ensureStarted = () => {
    if (started) {
      return;
    }
    started = true;

    autoUpdater.setFeedURL({
      url: feedUrl,
      serverType: "json",
    });

    autoUpdater.on("error", (error) => {
      showError(error instanceof Error ? error.message : String(error));
      interactiveCheck = false;
    });

    autoUpdater.on("update-not-available", () => {
      if (interactiveCheck) {
        void dialog.showMessageBox({
          type: "info",
          message: "You're up to date",
          detail: "Roder Desktop is running the latest release.",
          buttons: ["OK"],
        });
      }
      interactiveCheck = false;
    });

    autoUpdater.on("update-downloaded", (_event, releaseNotes, releaseName) => {
      const parent = deps.getMainWindow();
      const detail = [releaseName, releaseNotes].filter(Boolean).join("\n\n") || "A new version is ready to install.";
      const options = {
        type: "info" as const,
        message: "Update ready to install",
        detail,
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
      };
      const prompt = parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
      void prompt.then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
      interactiveCheck = false;
    });
  };

  return {
    checkForUpdates: ({ interactive = false } = {}) => {
      ensureStarted();
      interactiveCheck = interactive;
      try {
        autoUpdater.checkForUpdates();
      } catch (error) {
        showError(error instanceof Error ? error.message : String(error));
        interactiveCheck = false;
      }
    },
  };
}

import { app, autoUpdater, dialog, shell, type BrowserWindow } from "electron";
import {
  MACOS_UPDATE_FEED_URL,
  type AppUpdateStatus,
  parseUpdateFeed,
  resolveUpdateStatusFromFeed,
} from "../../src/lib/app-update";

export { MACOS_UPDATE_FEED_URL } from "../../src/lib/app-update";
export type { AppUpdateStatus } from "../../src/lib/app-update";
export const MACOS_SPARKLE_APPCAST_URL = "https://dl.roder.sh/desktop/latest/appcast.xml";

export type AutoUpdateController = {
  getStatus: () => AppUpdateStatus;
  checkForUpdates: (options?: { interactive?: boolean }) => Promise<AppUpdateStatus>;
  installUpdate: () => Promise<AppUpdateStatus>;
  onStatus: (listener: (status: AppUpdateStatus) => void) => () => void;
};

type AutoUpdateDeps = {
  getMainWindow: () => BrowserWindow | null;
  isPackaged?: boolean;
  platform?: NodeJS.Platform;
  feedUrl?: string;
  currentVersion?: string;
  fetchImpl?: typeof fetch;
  openExternal?: (url: string) => Promise<void>;
};

/**
 * macOS: Electron autoUpdater is built on Squirrel.Mac (Sparkle-based).
 * Availability is detected from the R2 JSON feed so the sidebar can show a
 * self-update button before download starts.
 */
export function createAutoUpdateController(deps: AutoUpdateDeps): AutoUpdateController {
  const isPackaged = deps.isPackaged ?? true;
  const platform = deps.platform ?? process.platform;
  const feedUrl = deps.feedUrl ?? MACOS_UPDATE_FEED_URL;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const openExternal = deps.openExternal ?? ((url: string) => shell.openExternal(url));
  const currentVersion = () => deps.currentVersion ?? app.getVersion();
  const listeners = new Set<(status: AppUpdateStatus) => void>();
  let status: AppUpdateStatus = { state: "idle", currentVersion: currentVersion() };
  let interactiveCheck = false;
  let started = false;
  let latestDownloadUrl: string | null = null;

  const setStatus = (next: AppUpdateStatus) => {
    status = next;
    for (const listener of listeners) {
      listener(status);
    }
  };

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

  const canUseNativeUpdater = isPackaged && platform === "darwin";

  const ensureNativeUpdater = () => {
    if (!canUseNativeUpdater || started) {
      return;
    }
    started = true;

    autoUpdater.setFeedURL({
      url: feedUrl,
      serverType: "json",
    });

    autoUpdater.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      setStatus({ state: "error", currentVersion: currentVersion(), message });
      showError(message);
      interactiveCheck = false;
    });

    autoUpdater.on("checking-for-update", () => {
      setStatus({ state: "checking", currentVersion: currentVersion() });
    });

    autoUpdater.on("update-available", () => {
      if (status.state === "available" || status.state === "downloading" || status.state === "ready") {
        setStatus({
          state: "downloading",
          currentVersion: status.currentVersion,
          availableVersion: status.availableVersion,
        });
        return;
      }
      setStatus({ state: "checking", currentVersion: currentVersion() });
    });

    autoUpdater.on("update-not-available", () => {
      setStatus({ state: "upToDate", currentVersion: currentVersion() });
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

    autoUpdater.on("update-downloaded", (_event, _releaseNotes, releaseName) => {
      const availableVersion =
        (typeof releaseName === "string" && releaseName) ||
        (status.state === "available" || status.state === "downloading" ? status.availableVersion : currentVersion());
      setStatus({
        state: "ready",
        currentVersion: currentVersion(),
        availableVersion,
      });
      if (interactiveCheck) {
        const parent = deps.getMainWindow();
        const options = {
          type: "info" as const,
          message: "Update ready to install",
          detail: `Version ${availableVersion} is ready. Restart Roder to finish updating.`,
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
      }
      interactiveCheck = false;
    });
  };

  const fetchFeedStatus = async (): Promise<AppUpdateStatus> => {
    setStatus({ state: "checking", currentVersion: currentVersion() });
    try {
      const response = await fetchImpl(feedUrl, {
        headers: { Accept: "application/json", "User-Agent": "RoderDesktop" },
      });
      if (!response.ok) {
        throw new Error(`Update feed returned HTTP ${response.status}`);
      }
      const feed = parseUpdateFeed(await response.json());
      latestDownloadUrl = feed?.url ?? null;
      const next = resolveUpdateStatusFromFeed({
        currentVersion: currentVersion(),
        feed,
      });
      setStatus(next);
      return next;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const next = { state: "error" as const, currentVersion: currentVersion(), message };
      setStatus(next);
      showError(message);
      interactiveCheck = false;
      return next;
    }
  };

  return {
    getStatus: () => status,
    onStatus: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    checkForUpdates: async ({ interactive = false } = {}) => {
      interactiveCheck = interactive;
      const next = await fetchFeedStatus();
      if (next.state === "upToDate" && interactive) {
        void dialog.showMessageBox({
          type: "info",
          message: "You're up to date",
          detail: "Roder Desktop is running the latest release.",
          buttons: ["OK"],
        });
        interactiveCheck = false;
      } else if (next.state === "available" && canUseNativeUpdater && interactive) {
        ensureNativeUpdater();
        try {
          autoUpdater.checkForUpdates();
        } catch (error) {
          showError(error instanceof Error ? error.message : String(error));
          interactiveCheck = false;
        }
      } else if (interactive) {
        interactiveCheck = false;
      }
      return next;
    },
    installUpdate: async () => {
      if (status.state === "ready" && canUseNativeUpdater) {
        autoUpdater.quitAndInstall();
        return status;
      }

      if (status.state === "available" || status.state === "downloading") {
        if (canUseNativeUpdater) {
          ensureNativeUpdater();
          setStatus({
            state: "downloading",
            currentVersion: status.currentVersion,
            availableVersion: status.availableVersion,
          });
          try {
            autoUpdater.checkForUpdates();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setStatus({ state: "error", currentVersion: currentVersion(), message });
          }
          return status;
        }

        const fallbackUrl =
          latestDownloadUrl ||
          (platform === "win32"
            ? "https://dl.roder.sh/desktop/latest/Roder-windows-x64-installer.exe"
            : "https://dl.roder.sh/desktop/latest/Roder-macos-arm64.dmg");
        await openExternal(fallbackUrl);
        return status;
      }

      return fetchFeedStatus();
    },
  };
}

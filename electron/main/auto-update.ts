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
 * macOS: Electron autoUpdater is built on Squirrel.Mac.
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

  const failNativeUpdate = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const availableVersion = "availableVersion" in status ? status.availableVersion : undefined;
    setStatus({
      state: "error",
      currentVersion: currentVersion(),
      message,
      ...(availableVersion ? { availableVersion } : {}),
    });
    showError(message);
    interactiveCheck = false;
  };

  const ensureNativeUpdater = () => {
    if (!canUseNativeUpdater || started) {
      return;
    }
    autoUpdater.setFeedURL({
      url: feedUrl,
      serverType: "json",
    });
    started = true;

    autoUpdater.on("error", failNativeUpdate);

    autoUpdater.on("checking-for-update", () => {
      if (status.state !== "downloading" && status.state !== "ready") {
        setStatus({ state: "checking", currentVersion: currentVersion() });
      }
    });

    autoUpdater.on("update-available", () => {
      if (status.state === "downloading" || status.state === "ready") return;
      if (status.state === "available") {
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

  const startNativeDownload = (availableVersion: string): AppUpdateStatus => {
    setStatus({ state: "downloading", currentVersion: currentVersion(), availableVersion });
    try {
      ensureNativeUpdater();
      autoUpdater.checkForUpdates();
    } catch (error) {
      failNativeUpdate(error);
    }
    return status;
  };

  const nativeUpdateActive = () => status.state === "downloading" || status.state === "ready";

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
      // A parallel feed check may finish after the user has started the download.
      if (nativeUpdateActive()) return status;
      latestDownloadUrl = feed?.url ?? null;
      const next = resolveUpdateStatusFromFeed({
        currentVersion: currentVersion(),
        feed,
      });
      setStatus(next);
      return next;
    } catch (error) {
      if (nativeUpdateActive()) return status;
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
      if (nativeUpdateActive()) return status;
      interactiveCheck = interactive;
      const next = await fetchFeedStatus();
      if (nativeUpdateActive()) return status;
      if (next.state === "upToDate" && interactive) {
        void dialog.showMessageBox({
          type: "info",
          message: "You're up to date",
          detail: "Roder Desktop is running the latest release.",
          buttons: ["OK"],
        });
        interactiveCheck = false;
      } else if (next.state === "available" && canUseNativeUpdater && interactive) {
        return startNativeDownload(next.availableVersion);
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

      if (status.state === "downloading") return status;
      const availableVersion =
        status.state === "available" || status.state === "error" ? status.availableVersion : undefined;
      if (availableVersion) {
        if (canUseNativeUpdater) return startNativeDownload(availableVersion);

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

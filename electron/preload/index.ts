import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { ExtensionCatalogSnapshot } from "../extensions/catalog";
import type { ExtensionTheme } from "../extensions/theme";

export type RoderNotification = {
  method: string;
  params: unknown;
};

export type RoderStatus = {
  state: "starting" | "ready" | "stopped" | "error";
  binary: string;
  cwd?: string;
  message?: string;
};

export type SystemAppearance = "dark" | "light";

export type TerminalSnapshot = {
  id: string;
  pid: number;
};

export type BrowserSnapshot = {
  visible: boolean;
  url: string;
  cdpUrl: string;
  canGoBack: boolean;
  canGoForward: boolean;
  annotating: boolean;
};

export type BrowserBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CodexRateWindow = {
  label: string;
  usedPercent: number;
  remainingPercent: number;
  windowMinutes: number | null;
  resetsAt: number | null;
  resetLabel: string;
};

export type CodexAccountSnapshot = {
  signedIn: boolean;
  roderSignedIn: boolean;
  codexSignedIn: boolean;
  displayName: string | null;
  accountId: string | null;
  planType: string | null;
  loginPending: boolean;
  limits: {
    primary: CodexRateWindow | null;
    secondary: CodexRateWindow | null;
    updatedAt: string | null;
  } | null;
  error?: string;
};

export type DroppedFile = {
  name: string;
  path: string;
  type: string;
  size: number;
};

export type AppServerEvent = {
  id: number;
  at: string;
  kind: "request" | "response" | "error" | "notification" | "status" | "stderr";
  method?: string;
  payload: unknown;
};

export type AppCommand = {
  command: "newThread";
};

const api = {
  request: (method: string, params?: unknown) => ipcRenderer.invoke("roder:request", method, params ?? {}),
  start: () => ipcRenderer.invoke("roder:start") as Promise<RoderStatus>,
  restart: () => ipcRenderer.invoke("roder:restart") as Promise<RoderStatus>,
  status: () => ipcRenderer.invoke("roder:status") as Promise<RoderStatus>,
  appearance: () => ipcRenderer.invoke("roder:appearance") as Promise<SystemAppearance>,
  openExternal: (url: string) => ipcRenderer.invoke("openExternal", url) as Promise<void>,
  openWorkspaceFolder: (defaultPath?: string) => ipcRenderer.invoke("workspace:openFolder", defaultPath) as Promise<string | null>,
  terminalStart: (options?: { cols?: number; rows?: number }) => ipcRenderer.invoke("terminal:start", options ?? {}) as Promise<TerminalSnapshot>,
  terminalWrite: (data: string) => ipcRenderer.invoke("terminal:write", data) as Promise<void>,
  terminalResize: (cols: number, rows: number) => ipcRenderer.invoke("terminal:resize", cols, rows) as Promise<void>,
  terminalStop: () => ipcRenderer.invoke("terminal:stop") as Promise<void>,
  browserToggle: (bounds?: BrowserBounds) => ipcRenderer.invoke("browser:toggle", bounds) as Promise<BrowserSnapshot>,
  browserShow: (bounds: BrowserBounds) => ipcRenderer.invoke("browser:show", bounds) as Promise<BrowserSnapshot>,
  browserHide: () => ipcRenderer.invoke("browser:hide") as Promise<BrowserSnapshot>,
  browserNavigate: (url: string) => ipcRenderer.invoke("browser:navigate", url) as Promise<BrowserSnapshot>,
  browserBack: () => ipcRenderer.invoke("browser:back") as Promise<BrowserSnapshot>,
  browserForward: () => ipcRenderer.invoke("browser:forward") as Promise<BrowserSnapshot>,
  browserRefresh: () => ipcRenderer.invoke("browser:refresh") as Promise<BrowserSnapshot>,
  browserCaptureScreenshot: () => ipcRenderer.invoke("browser:captureScreenshot") as Promise<DroppedFile>,
  browserToggleAnnotation: () => ipcRenderer.invoke("browser:toggleAnnotation") as Promise<BrowserSnapshot>,
  browserSetBounds: (bounds: BrowserBounds) => ipcRenderer.invoke("browser:setBounds", bounds) as Promise<BrowserSnapshot>,
  browserSnapshot: () => ipcRenderer.invoke("browser:snapshot") as Promise<BrowserSnapshot>,
  canvasSavePng: (dataUrl: string) => ipcRenderer.invoke("canvas:savePng", dataUrl) as Promise<DroppedFile>,
  codexAccount: () => ipcRenderer.invoke("codex:account") as Promise<CodexAccountSnapshot>,
  codexLogin: () => ipcRenderer.invoke("codex:login") as Promise<CodexAccountSnapshot>,
  codexLogout: () => ipcRenderer.invoke("codex:logout") as Promise<CodexAccountSnapshot>,
  codexOpenRateLimitHelp: () => ipcRenderer.invoke("codex:openRateLimitHelp") as Promise<void>,
  extensionsList: () => ipcRenderer.invoke("extensions:list") as Promise<ExtensionCatalogSnapshot>,
  extensionsInstallFromFolder: (folderPath: string) => ipcRenderer.invoke("extensions:installFromFolder", folderPath) as Promise<ExtensionCatalogSnapshot>,
  extensionsInstallFromArchive: (archivePath: string) => ipcRenderer.invoke("extensions:installFromArchive", archivePath) as Promise<ExtensionCatalogSnapshot>,
  extensionsSelectAndInstallFolder: () => ipcRenderer.invoke("extensions:selectAndInstallFolder") as Promise<ExtensionCatalogSnapshot>,
  extensionsSelectAndInstallArchive: () => ipcRenderer.invoke("extensions:selectAndInstallArchive") as Promise<ExtensionCatalogSnapshot>,
  extensionsUninstall: (id: string) => ipcRenderer.invoke("extensions:uninstall", id) as Promise<ExtensionCatalogSnapshot>,
  extensionsEnable: (id: string) => ipcRenderer.invoke("extensions:enable", id) as Promise<ExtensionCatalogSnapshot>,
  extensionsDisable: (id: string) => ipcRenderer.invoke("extensions:disable", id) as Promise<ExtensionCatalogSnapshot>,
  extensionsReload: (id: string) => ipcRenderer.invoke("extensions:reload", id) as Promise<ExtensionCatalogSnapshot>,
  extensionsUpdatePreference: (id: string, key: string, value: string | boolean | null) =>
    ipcRenderer.invoke("extensions:updatePreference", id, key, value) as Promise<ExtensionCatalogSnapshot>,
  extensionsReadLogs: (id: string) => ipcRenderer.invoke("extensions:readLogs", id) as Promise<string[]>,
  extensionsActivate: (id: string) => ipcRenderer.invoke("extensions:activate", id) as Promise<ExtensionCatalogSnapshot>,
  extensionsExecuteCommand: (commandId: string, args?: unknown[]) =>
    ipcRenderer.invoke("extensions:executeCommand", commandId, args ?? []) as Promise<unknown>,
  extensionsExecuteTool: (toolId: string, input?: Record<string, unknown>) =>
    ipcRenderer.invoke("extensions:executeTool", toolId, input ?? {}) as Promise<unknown>,
  extensionsReadPanel: (extensionId: string, panelId: string) => ipcRenderer.invoke("extensions:readPanel", extensionId, panelId) as Promise<string>,
  extensionsReadTheme: (extensionId: string, themeId: string) => ipcRenderer.invoke("extensions:readTheme", extensionId, themeId) as Promise<ExtensionTheme>,
  appServerEvents: () => ipcRenderer.invoke("appserver:events") as Promise<AppServerEvent[]>,
  resolveDroppedFiles: (files: File[]) =>
    files
      .map((file) => ({
        name: file.name,
        path: webUtils.getPathForFile(file),
        type: file.type,
        size: file.size,
      }))
      .filter((file) => file.path) as DroppedFile[],
  onNotification: (callback: (notification: RoderNotification) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, notification: RoderNotification) => callback(notification);
    ipcRenderer.on("roder:notification", listener);
    return () => ipcRenderer.removeListener("roder:notification", listener);
  },
  onStatus: (callback: (status: RoderStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: RoderStatus) => callback(status);
    ipcRenderer.on("roder:status", listener);
    return () => ipcRenderer.removeListener("roder:status", listener);
  },
  onStderr: (callback: (message: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
    ipcRenderer.on("roder:stderr", listener);
    return () => ipcRenderer.removeListener("roder:stderr", listener);
  },
  onAppearance: (callback: (appearance: SystemAppearance) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, appearance: SystemAppearance) => callback(appearance);
    ipcRenderer.on("roder:appearance", listener);
    return () => ipcRenderer.removeListener("roder:appearance", listener);
  },
  onAppServerEvent: (callback: (event: AppServerEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, appServerEvent: AppServerEvent) => callback(appServerEvent);
    ipcRenderer.on("appserver:event", listener);
    return () => ipcRenderer.removeListener("appserver:event", listener);
  },
  onAppCommand: (callback: (command: AppCommand) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: AppCommand) => callback(command);
    ipcRenderer.on("app:command", listener);
    return () => ipcRenderer.removeListener("app:command", listener);
  },
  onTerminalData: (callback: (payload: { id: string; data: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { id: string; data: string }) => callback(payload);
    ipcRenderer.on("terminal:data", listener);
    return () => ipcRenderer.removeListener("terminal:data", listener);
  },
  onTerminalExit: (callback: (payload: { id: string; exitCode: number; signal?: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { id: string; exitCode: number; signal?: number }) => callback(payload);
    ipcRenderer.on("terminal:exit", listener);
    return () => ipcRenderer.removeListener("terminal:exit", listener);
  },
};

contextBridge.exposeInMainWorld("roderDesktop", api);

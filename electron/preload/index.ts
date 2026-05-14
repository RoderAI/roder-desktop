import { contextBridge, ipcRenderer, webUtils } from "electron";

export type GodeNotification = {
  method: string;
  params: unknown;
};

export type GodeStatus = {
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
  godeSignedIn: boolean;
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

const api = {
  request: (method: string, params?: unknown) => ipcRenderer.invoke("gode:request", method, params ?? {}),
  start: () => ipcRenderer.invoke("gode:start") as Promise<GodeStatus>,
  restart: () => ipcRenderer.invoke("gode:restart") as Promise<GodeStatus>,
  status: () => ipcRenderer.invoke("gode:status") as Promise<GodeStatus>,
  appearance: () => ipcRenderer.invoke("gode:appearance") as Promise<SystemAppearance>,
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
  resolveDroppedFiles: (files: File[]) =>
    files
      .map((file) => ({
        name: file.name,
        path: webUtils.getPathForFile(file),
        type: file.type,
        size: file.size,
      }))
      .filter((file) => file.path) as DroppedFile[],
  onNotification: (callback: (notification: GodeNotification) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, notification: GodeNotification) => callback(notification);
    ipcRenderer.on("gode:notification", listener);
    return () => ipcRenderer.removeListener("gode:notification", listener);
  },
  onStatus: (callback: (status: GodeStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: GodeStatus) => callback(status);
    ipcRenderer.on("gode:status", listener);
    return () => ipcRenderer.removeListener("gode:status", listener);
  },
  onStderr: (callback: (message: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
    ipcRenderer.on("gode:stderr", listener);
    return () => ipcRenderer.removeListener("gode:stderr", listener);
  },
  onAppearance: (callback: (appearance: SystemAppearance) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, appearance: SystemAppearance) => callback(appearance);
    ipcRenderer.on("gode:appearance", listener);
    return () => ipcRenderer.removeListener("gode:appearance", listener);
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

contextBridge.exposeInMainWorld("godeDesktop", api);

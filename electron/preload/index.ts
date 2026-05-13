import { contextBridge, ipcRenderer } from "electron";

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

const api = {
  request: (method: string, params?: unknown) => ipcRenderer.invoke("gode:request", method, params ?? {}),
  start: () => ipcRenderer.invoke("gode:start") as Promise<GodeStatus>,
  restart: () => ipcRenderer.invoke("gode:restart") as Promise<GodeStatus>,
  status: () => ipcRenderer.invoke("gode:status") as Promise<GodeStatus>,
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
};

contextBridge.exposeInMainWorld("godeDesktop", api);

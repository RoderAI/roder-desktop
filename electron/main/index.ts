import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { GodeAppServerClient } from "../gode/app-server-client";

const gode = new GodeAppServerClient();
let mainWindow: BrowserWindow | null = null;
const rendererZoomFactor = 0.84;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    title: "Gode",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: "#f5f5f4",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow?.webContents.setZoomFactor(rendererZoomFactor);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function sendToRenderer(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload);
}

gode.on("notification", (payload) => sendToRenderer("gode:notification", payload));
gode.on("status", (payload) => sendToRenderer("gode:status", payload));
gode.on("stderr", (payload) => sendToRenderer("gode:stderr", payload));

ipcMain.handle("gode:status", () => gode.status());
ipcMain.handle("gode:start", () => gode.start());
ipcMain.handle("gode:restart", () => gode.restart());
ipcMain.handle("gode:request", async (_event, method: string, params: unknown) => {
  return gode.request(method, params);
});

app.whenReady().then(async () => {
  createWindow();
  try {
    await gode.start();
  } catch (error) {
    sendToRenderer("gode:status", {
      state: "error",
      binary: "unresolved",
      message: (error as Error).message,
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  void gode.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, type Rectangle } from "electron";
import { join } from "node:path";
import { BrowserManager } from "../browser/browser-manager";
import { getCodexAccountSnapshot, logoutCodex, openRateLimitHelp, startCodexLogin } from "../codex/codex-account";
import { GodeAppServerClient } from "../gode/app-server-client";
import { TerminalManager } from "../terminal/pty-manager";

const gode = new GodeAppServerClient();
const terminal = new TerminalManager();
const cdpPort = process.env.GODE_DESKTOP_CDP_PORT || "9334";
const browser = new BrowserManager(cdpPort);
let mainWindow: BrowserWindow | null = null;
const appName = "Gode";
const rendererZoomFactor = 0.84;

app.setName(appName);
app.setAboutPanelOptions({ applicationName: appName });
if (!app.commandLine.hasSwitch("remote-debugging-port")) {
  app.commandLine.appendSwitch("remote-debugging-port", cdpPort);
}

function currentAppearance(): "dark" | "light" {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

function appIconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, "icon.png") : join(app.getAppPath(), "resources/icon.png");
}

function createWindow(): void {
  nativeTheme.themeSource = "system";
  const appIcon = nativeImage.createFromPath(appIconPath());

  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(appIcon);
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    title: appName,
    icon: appIcon,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: currentAppearance() === "dark" ? "#171717" : "#f5f5f4",
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
    browser.destroy();
    mainWindow = null;
  });
  browser.attach(mainWindow);
}

function sendToRenderer(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload);
}

gode.on("notification", (payload) => sendToRenderer("gode:notification", payload));
gode.on("status", (payload) => sendToRenderer("gode:status", payload));
gode.on("stderr", (payload) => sendToRenderer("gode:stderr", payload));
terminal.on("data", (payload) => sendToRenderer("terminal:data", payload));
terminal.on("exit", (payload) => sendToRenderer("terminal:exit", payload));

ipcMain.handle("gode:status", () => gode.status());
ipcMain.handle("gode:start", () => gode.start());
ipcMain.handle("gode:restart", () => gode.restart());
ipcMain.handle("gode:appearance", () => currentAppearance());
ipcMain.handle("gode:request", async (_event, method: string, params: unknown) => {
  return gode.request(method, params);
});
ipcMain.handle("workspace:openFolder", async (_event, defaultPath?: string) => {
  const options: Electron.OpenDialogOptions = {
    title: "Open Folder",
    defaultPath,
    properties: ["openDirectory", "createDirectory"],
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0] ?? null;
});
ipcMain.handle("terminal:start", (_event, options: { cols?: number; rows?: number }) => terminal.start({ ...options, cwd: process.cwd() }));
ipcMain.handle("terminal:write", (_event, data: string) => terminal.write(data));
ipcMain.handle("terminal:resize", (_event, cols: number, rows: number) => terminal.resize(cols, rows));
ipcMain.handle("terminal:stop", () => terminal.stop());
ipcMain.handle("browser:toggle", (_event, bounds?: Rectangle) => browser.toggle(scaleRendererBounds(bounds)));
ipcMain.handle("browser:show", (_event, bounds: Rectangle) => browser.show(scaleRendererBounds(bounds)));
ipcMain.handle("browser:hide", () => browser.hide());
ipcMain.handle("browser:navigate", (_event, url: string) => browser.navigate(url));
ipcMain.handle("browser:back", () => browser.goBack());
ipcMain.handle("browser:forward", () => browser.goForward());
ipcMain.handle("browser:refresh", () => browser.refresh());
ipcMain.handle("browser:captureScreenshot", () => browser.captureScreenshot());
ipcMain.handle("browser:toggleAnnotation", () => browser.toggleAnnotation());
ipcMain.handle("browser:setBounds", (_event, bounds: Rectangle) => browser.setBounds(scaleRendererBounds(bounds)));
ipcMain.handle("browser:snapshot", () => browser.snapshot());
ipcMain.handle("codex:account", () => getCodexAccountSnapshot());
ipcMain.handle("codex:login", () => startCodexLogin());
ipcMain.handle("codex:logout", () => logoutCodex());
ipcMain.handle("codex:openRateLimitHelp", () => openRateLimitHelp());

nativeTheme.on("updated", () => {
  sendToRenderer("gode:appearance", currentAppearance());
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
  terminal.stop();
  browser.destroy();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function scaleRendererBounds(bounds?: Rectangle): Rectangle {
  const fallback = { x: 0, y: 52, width: 720, height: 640 };
  const source = bounds ?? fallback;
  return {
    x: Math.round(source.x * rendererZoomFactor),
    y: Math.round(source.y * rendererZoomFactor),
    width: Math.max(100, Math.round(source.width * rendererZoomFactor)),
    height: Math.max(100, Math.round(source.height * rendererZoomFactor)),
  };
}

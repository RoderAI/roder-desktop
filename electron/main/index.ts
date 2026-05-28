import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, shell, type Rectangle } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { JsonObject } from "@roderai/extension-api";
import { BrowserManager } from "../browser/browser-manager";
import { getCodexAccountSnapshot, logoutCodex, openRateLimitHelp, startCodexLogin } from "../codex/codex-account";
import { ExtensionCatalog } from "../extensions/catalog";
import { ExtensionHost } from "../extensions/extension-host";
import { readExtensionTheme } from "../extensions/theme";
import { callExtensionTool, extensionToolName, mergeExtensionTools } from "../extensions/tool-proxy";
import { RoderAppServerClient } from "../roder/app-server-client";
import { TerminalManager } from "../terminal/pty-manager";
import {
  createApplicationMenuTemplate,
  installNewProjectShortcut,
  installNewThreadShortcut,
  type AppCommand,
} from "./shortcuts";

const roder = new RoderAppServerClient();
const terminal = new TerminalManager();
const cdpPort = process.env.RODER_DESKTOP_CDP_PORT || "9334";
const browser = new BrowserManager(cdpPort, () => sendAppCommand("newThread"));
let mainWindow: BrowserWindow | null = null;
let extensionCatalog: ExtensionCatalog | null = null;
let extensionHost: ExtensionHost | null = null;
const appServerEvents: AppServerEvent[] = [];
const appName = "Roder";
const rendererZoomFactor = 0.84;
const mainDir = dirname(fileURLToPath(import.meta.url));

type AppServerEvent = {
  id: number;
  at: string;
  kind: "request" | "response" | "error" | "notification" | "status" | "stderr";
  method?: string;
  payload: unknown;
};

app.setName(appName);
app.setAboutPanelOptions({ applicationName: appName });
if (!app.commandLine.hasSwitch("remote-debugging-port")) {
  app.commandLine.appendSwitch("remote-debugging-port", cdpPort);
}

function currentAppearance(): "dark" | "light" {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

async function openExternalTarget(value: string): Promise<void> {
  const target = new URL(value);
  if (target.protocol === "file:") {
    const result = await shell.openPath(fileURLToPath(target));
    if (result) {
      throw new Error(result);
    }
    return;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error(`Unsupported link protocol: ${target.protocol}`);
  }
  await shell.openExternal(target.toString());
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
      preload: join(mainDir, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(mainDir, "../renderer/index.html"));
  }

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow?.webContents.setZoomFactor(rendererZoomFactor);
  });
  installNewProjectShortcut(mainWindow.webContents, () => sendAppCommand("newProject"));
  installNewThreadShortcut(mainWindow.webContents, () => sendAppCommand("newThread"));

  mainWindow.on("closed", () => {
    browser.destroy();
    mainWindow = null;
  });
  browser.attach(mainWindow);
}

function sendToRenderer(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload);
}

function sendAppCommand(command: AppCommand): void {
  sendToRenderer("app:command", { command });
}

roder.on("notification", (payload) => {
  recordAppServerEvent("notification", payload.method, payload.params);
  sendToRenderer("roder:notification", payload);
});
roder.on("status", (payload) => {
  recordAppServerEvent("status", undefined, payload);
  sendToRenderer("roder:status", payload);
});
roder.on("stderr", (payload) => {
  recordAppServerEvent("stderr", undefined, payload);
  sendToRenderer("roder:stderr", payload);
});
terminal.on("data", (payload) => sendToRenderer("terminal:data", payload));
terminal.on("exit", (payload) => sendToRenderer("terminal:exit", payload));

ipcMain.handle("roder:status", () => roder.status());
ipcMain.handle("roder:start", () => roder.start());
ipcMain.handle("roder:restart", () => roder.restart());
ipcMain.handle("roder:appearance", () => currentAppearance());
ipcMain.handle("openExternal", (_event, url: string) => openExternalTarget(url));
ipcMain.handle("roder:request", async (_event, method: string, params: unknown) => {
  return handleRoderRequest(method, params);
});
ipcMain.handle("workspace:openFolder", async (_event, defaultPath?: string) => {
  const options: Electron.OpenDialogOptions = {
    title: "Open Folder",
    defaultPath,
    properties: ["openDirectory", "createDirectory"],
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
});
ipcMain.handle("terminal:start", (_event, options: { cols?: number; rows?: number }) =>
  terminal.start({ ...options, cwd: process.cwd() }),
);
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
ipcMain.handle("canvas:savePng", (_event, dataUrl: string) => saveCanvasPng(dataUrl));
ipcMain.handle("codex:account", () => getCodexAccountSnapshot());
ipcMain.handle("codex:login", () => startCodexLogin());
ipcMain.handle("codex:logout", () => logoutCodex());
ipcMain.handle("codex:openRateLimitHelp", () => openRateLimitHelp());
ipcMain.handle("extensions:list", () => getExtensionCatalog().list());
ipcMain.handle("extensions:installFromFolder", async (_event, folderPath: string) => {
  await getExtensionCatalog().installFromFolder(folderPath);
  return getExtensionCatalog().list();
});
ipcMain.handle("extensions:installFromArchive", async (_event, archivePath: string) => {
  await getExtensionCatalog().installFromArchive(archivePath);
  return getExtensionCatalog().list();
});
ipcMain.handle("extensions:selectAndInstallFolder", async () => {
  const options: Electron.OpenDialogOptions = {
    title: "Install Extension From Folder",
    properties: ["openDirectory"],
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) {
    return getExtensionCatalog().list();
  }
  await getExtensionCatalog().installFromFolder(result.filePaths[0]);
  return getExtensionCatalog().list();
});
ipcMain.handle("extensions:selectAndInstallArchive", async () => {
  const options: Electron.OpenDialogOptions = {
    title: "Install Extension Package",
    filters: [{ name: "Roder Extension Packages", extensions: ["rdx"] }],
    properties: ["openFile"],
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) {
    return getExtensionCatalog().list();
  }
  await getExtensionCatalog().installFromArchive(result.filePaths[0]);
  return getExtensionCatalog().list();
});
ipcMain.handle("extensions:uninstall", async (_event, id: string) => {
  await getExtensionHost().deactivateExtension(id);
  return getExtensionCatalog().uninstall(id);
});
ipcMain.handle("extensions:enable", async (_event, id: string) => {
  await getExtensionCatalog().enable(id);
  return getExtensionCatalog().list();
});
ipcMain.handle("extensions:disable", async (_event, id: string) => {
  await getExtensionHost().deactivateExtension(id);
  await getExtensionCatalog().disable(id);
  return getExtensionCatalog().list();
});
ipcMain.handle("extensions:reload", async (_event, id: string) => {
  await getExtensionHost().reloadExtension(id);
  return getExtensionCatalog().list();
});
ipcMain.handle(
  "extensions:updatePreference",
  async (_event, id: string, key: string, value: string | boolean | null) => {
    await getExtensionCatalog().updatePreference(id, key, value);
    return getExtensionCatalog().list();
  },
);
ipcMain.handle("extensions:readLogs", (_event, id: string) => getExtensionCatalog().readLogs(id));
ipcMain.handle("extensions:activate", async (_event, id: string) => {
  await getExtensionHost().activateExtension(id);
  return getExtensionCatalog().list();
});
ipcMain.handle("extensions:executeCommand", (_event, commandId: string, args?: unknown[]) =>
  getExtensionHost().executeCommand(commandId, args ?? []),
);
ipcMain.handle("extensions:executeTool", (_event, toolId: string, input?: Record<string, unknown>) =>
  getExtensionHost().executeTool(toolId, (input ?? {}) as JsonObject),
);
ipcMain.handle("extensions:readPanel", async (_event, extensionId: string, panelId: string) => {
  const extension = await getExtensionCatalog().get(extensionId);
  const panel = extension?.manifest.contributes.views.panels.find((candidate) => candidate.id === panelId);
  if (!extension || !panel || !panel.html) {
    throw new Error(`Extension panel ${panelId} is not available`);
  }
  const panelPath = resolve(extension.source.path, panel.html);
  const extensionRoot = resolve(extension.source.path);
  if (!panelPath.startsWith(`${extensionRoot}/`) && panelPath !== extensionRoot) {
    throw new Error(`Extension panel ${panelId} points outside the extension package`);
  }
  return readFile(panelPath, "utf8");
});
ipcMain.handle("extensions:readTheme", async (_event, extensionId: string, themeId: string) => {
  const extension = await getExtensionCatalog().get(extensionId);
  if (!extension || !extension.enabled) {
    throw new Error(`Extension ${extensionId} is not installed or enabled`);
  }
  return readExtensionTheme(extension, themeId);
});
ipcMain.handle("appserver:events", () => appServerEvents);

nativeTheme.on("updated", () => {
  sendToRenderer("roder:appearance", currentAppearance());
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(Menu.buildFromTemplate(createApplicationMenuTemplate(sendAppCommand)));
  createWindow();
  try {
    await roder.start();
  } catch (error) {
    sendToRenderer("roder:status", {
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
  void extensionHost?.stopAll();
  void roder.stop();
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

async function saveCanvasPng(dataUrl: string): Promise<{ name: string; path: string; type: string; size: number }> {
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) {
    throw new Error("Canvas capture must be a PNG data URL");
  }
  const data = Buffer.from(dataUrl.slice(prefix.length), "base64");
  const dir = join(tmpdir(), "roder-desktop-canvas");
  await mkdir(dir, { recursive: true });
  const name = `canvas-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
  const path = join(dir, name);
  await writeFile(path, data);
  return {
    name: basename(path),
    path,
    type: "image/png",
    size: data.byteLength,
  };
}

function getExtensionCatalog(): ExtensionCatalog {
  extensionCatalog ??= new ExtensionCatalog({
    userDataPath: app.getPath("userData"),
    appVersion: app.getVersion(),
  });
  return extensionCatalog;
}

function getExtensionHost(): ExtensionHost {
  extensionHost ??= new ExtensionHost({
    userDataPath: app.getPath("userData"),
    appName,
    appVersion: app.getVersion(),
    catalog: getExtensionCatalog(),
  });
  return extensionHost;
}

async function handleRoderRequest(method: string, params: unknown): Promise<unknown> {
  recordAppServerEvent("request", method, params ?? {});
  if (method === "tools/list") {
    try {
      const baseTools = await roder.request(method, params);
      const result = mergeExtensionTools(baseTools, await getExtensionCatalog().list());
      recordAppServerEvent("response", method, result);
      return result;
    } catch (error) {
      recordAppServerEvent("error", method, (error as Error).message);
      throw error;
    }
  }
  if (method === "tools/call") {
    const catalog = await getExtensionCatalog().list();
    const toolName = extensionToolName(params, catalog);
    if (toolName) {
      const result = await callExtensionTool(getExtensionHost(), toolName, params);
      recordAppServerEvent(result.is_error ? "error" : "response", method, result);
      return result;
    }
  }
  try {
    const result = await roder.request(method, params);
    recordAppServerEvent("response", method, result);
    return result;
  } catch (error) {
    recordAppServerEvent("error", method, (error as Error).message);
    throw error;
  }
}

function recordAppServerEvent(kind: AppServerEvent["kind"], method: string | undefined, payload: unknown): void {
  const event = {
    id: appServerEvents.length > 0 ? appServerEvents[appServerEvents.length - 1].id + 1 : 1,
    at: new Date().toISOString(),
    kind,
    method,
    payload,
  };
  appServerEvents.push(event);
  if (appServerEvents.length > 500) {
    appServerEvents.splice(0, appServerEvents.length - 500);
  }
  sendToRenderer("appserver:event", event);
}

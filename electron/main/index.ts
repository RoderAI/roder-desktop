import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  safeStorage,
  shell,
  type Rectangle,
} from "electron";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { watch as fsWatch } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { JsonObject } from "@roderai/extension-api";
import { BrowserManager } from "../browser/browser-manager";
import { savePngDataUrl } from "../attachment-images";
import { createThreadHistoryService, type ThreadHistoryPage } from "../threads/thread-history";
import { createThreadHistoryIndexService } from "../threads/thread-history-index";
import {
  browserProviderFromRequestParams,
  browserToolThreadId,
  callDesktopBrowserTool,
  callChromeBrowserToolAlias,
  desktopBrowserToolName,
  mergeDesktopBrowserSkill,
  mergeDesktopBrowserTools,
  type BrowserToolProvider,
} from "../browser/browser-tool-proxy";
import { ChromeBridgeManager } from "../browser/chrome-bridge-manager";
import {
  cancelCodexLogin,
  getCodexAccountSnapshot,
  logoutCodex,
  openRateLimitHelp,
  startCodexLogin,
} from "../codex/codex-account";
import { ExtensionCatalog } from "../extensions/catalog";
import { redactSecrets } from "../app-server-redaction";
import { BlaxelClient } from "../cloud-machines/blaxel-client";
import { detectBlaxelCli, readBlaxelCliCredentials } from "../cloud-machines/blaxel-cli";
import { BlaxelTerminalSession } from "../cloud-machines/blaxel-terminal";
import { CloudCredentialsService } from "../cloud-machines/credentials";
import {
  isRemoteWorkspaceId,
  remoteWorkspaceIdForThread,
  RemoteWorkspaceService,
} from "../cloud-machines/remote-workspace";
import { CloudMachinesService } from "../cloud-machines/service";
import { machineProfilesChanged } from "../agents/cloud-machine-config";
import { detectLocalSshEnvironment, parseSshMachineConfig } from "../cloud-machines/ssh-config";
import {
  detectLocalTailscale,
  parseTailscalePeerConfig,
  requestTailscaleOAuthToken,
} from "../cloud-machines/tailscale";
import { TailscaleRunnerGateway } from "../cloud-machines/tailscale-runner-gateway";
import { TailscaleSshClient } from "../cloud-machines/tailscale-ssh";
import { TailscaleSshTerminalSession } from "../cloud-machines/tailscale-terminal";
import { cloudMachineThreadParams } from "../cloud-machines/thread-routing";
import { effectiveRunnerProviderId } from "../../src/lib/cloud-machines";
import { findClaudeCli } from "../onboarding/claude-cli";
import { detectEnvironmentProviders } from "../onboarding/environment";
import { onboardingRecordPath, readOnboardingRecord, writeOnboardingRecord } from "../onboarding/record";
import { ExtensionHost } from "../extensions/extension-host";
import { readExtensionTheme } from "../extensions/theme";
import { callExtensionTool, extensionToolName, mergeExtensionTools } from "../extensions/tool-proxy";
import { RoderAppServerClient, resolveEmbeddedRoderBinary } from "../roder/app-server-client";
import {
  AgentBackendsManager,
  findAntigravityRuntime,
  findCodexRuntime,
  findExternalBackendRuntime,
  resolveAntigravitySetupCommand,
  resolveCodexSetupCommand,
  runExternalBackendLogoutCli,
  runtimePathExtraEnv,
} from "../roder/agent-backends";
import {
  antigravitySetupSession,
  codexSetupSession,
  type AgentBackendId,
  type ExternalAgentBackendId,
} from "../roder/desktop-backend";
import { DesktopAgentTools } from "../agents/desktop-agent-tools";
import { IssuesService } from "../issues/service";
import { handleIssueToolCall, issueToolDefinitions } from "../issues/tools";
import { persistentAgentToolDefinitions, createPersistentAgentService } from "../persistent-agents/service";
import {
  createPersistentAgentFromTool,
  mergePersistentAgentSkill,
  persistentAgentCreateTool,
  persistentAgentWorkspacesTool,
  listPersistentAgentWorkspaces,
  persistentAgentSkillBody,
  readPersistentAgentSkill,
} from "../persistent-agents/creation-tool";
import { configureDesktopFromTool, desktopConfigInstructions, desktopConfigTool } from "../agents/config-tool";
import { createPersistentAgentSpriteManager, createSpriteImageNormalizer } from "../persistent-agents/sprites";
import { createCodexImageGenerator } from "../persistent-agents/codex-image-generator";
import { createImageGenerationCredentials, configureImageGenerationKey } from "../persistent-agents/image-credentials";
import { createOpenAiImageGenerator } from "../persistent-agents/openai-image-generator";
import type { Issue, IssueProject } from "../../src/types/issues";
import type { PersistentAgentDetail } from "../../src/types/persistent-agents";
import type { Workspace } from "../../src/types/roder";
import type { LocalWorktreeContext } from "../../src/lib/local-worktrees";
import { DesktopWorktrees } from "../worktrees/desktop-worktrees";
import { GitWorktrees } from "../worktrees/git-worktrees";
import { TerminalManager, type TerminalStartOptions } from "../terminal/pty-manager";
import { runMarkdownShellCommand } from "../terminal/markdown-shell-command";
import { createAutoUpdateController } from "./auto-update";
import {
  createApplicationMenuTemplate,
  installOpenFileSearchShortcut,
  installNewProjectShortcut,
  installNewThreadShortcut,
  installOpenSettingsShortcut,
  type AppCommand,
} from "./shortcuts";
import { rendererZoomFactor, scaleRendererBounds } from "./renderer-scale";
import { mainPanelMinWidth, mainWindowMinHeight, mainWindowMinWidth } from "./window-options";

function getRoderExtraEnv(): Record<string, string> {
  const cloudEnv = getCloudCredentialsService().getCachedRunnerEnv(process.env);
  const gatewayEnv = tailscaleRunnerGateway?.getRunnerEnv({ ...process.env, ...cloudEnv }) ?? {};
  return { ...cloudEnv, ...gatewayEnv };
}

const roder = new RoderAppServerClient({
  getExtraEnv: getRoderExtraEnv,
});
const threadHistory = createThreadHistoryService({
  request: (method, params) => roder.request(method, params) as Promise<ThreadHistoryPage>,
});
const threadHistoryIndex = createThreadHistoryIndexService({
  request: (method, params) => roder.request(method, params) as Promise<ThreadHistoryPage>,
});
let changingImageCredentials = false;
const terminal = new TerminalManager({
  startRemoteTerminal: async ({ id, remoteWorkspaceId, cols, rows }) => {
    const remoteService = getRemoteWorkspaceService();
    const target = await remoteService.resolveTarget(remoteWorkspaceId);
    const provider = effectiveRunnerProviderId(target);
    if (provider === "tailscale" || provider === "ssh") {
      const peer = await remoteService.resolveSshConnectionTarget(target);
      return new TailscaleSshTerminalSession({
        peer,
        workingDir: target.workspace,
        cols,
        rows,
      });
    }
    const endpoint = await remoteService.resolveBlaxelEndpoint(target);
    await getBlaxelClient().wakeSandbox(endpoint.auth, endpoint.sandboxUrl);
    const stableSessionId = `roder-${id.replace(/[^a-zA-Z0-9_-]/gu, "_").slice(0, 48)}`;
    return new BlaxelTerminalSession({
      sandboxUrl: endpoint.sandboxUrl,
      auth: endpoint.auth,
      sessionId: stableSessionId,
      workingDir: target.workspace,
      cols,
      rows,
    });
  },
});
const cdpPort = process.env.RODER_DESKTOP_CDP_PORT || "9334";
const browser = new BrowserManager(cdpPort, () => sendAppCommand("newThread"));
const chromeBridge = new ChromeBridgeManager();
const browserProviderByThread = new Map<string, BrowserToolProvider>();
let sessionBrowserProvider: BrowserToolProvider = "builtIn";
let mainWindow: BrowserWindow | null = null;
let extensionCatalog: ExtensionCatalog | null = null;
let extensionHost: ExtensionHost | null = null;
let issuesService: IssuesService | null = null;
let persistentAgentService: ReturnType<typeof createPersistentAgentService> | null = null;
let spriteManager: ReturnType<typeof createPersistentAgentSpriteManager> | null = null;
let imageCredentials: ReturnType<typeof createImageGenerationCredentials> | null = null;
let persistentAgentStartPromise: Promise<void> | null = null;
let desktopAgentTools: DesktopAgentTools | null = null;
const appServerEvents: AppServerEvent[] = [];
const appName = "Roder";
const mainDir = __dirname;

type AppServerEvent = {
  id: number;
  at: string;
  kind: "request" | "response" | "error" | "notification" | "status" | "stderr";
  method?: string;
  payload: unknown;
};

app.setName(appName);
// Dev runs and installed builds would otherwise share one Chromium profile. A second instance then
// waits on the profile the first one holds, which stalled a packaged launch for about 4 seconds
// while a dev window was open.
if (!app.isPackaged) {
  app.setPath("userData", join(app.getPath("appData"), `${appName} Dev`));
}
app.setAboutPanelOptions({ applicationName: appName });
if (!app.commandLine.hasSwitch("remote-debugging-port")) {
  app.commandLine.appendSwitch("remote-debugging-port", cdpPort);
}
// Chromium only auto-selects gnome-libsecret for GNOME/XFCE/Unity desktops and falls back to
// basic_text on Hyprland/Sway/i3/etc. even when org.freedesktop.secrets (gnome-keyring-daemon)
// is active. Opt non-KDE Linux desktops into gnome-libsecret so OS-backed safeStorage works;
// if no secret service is running, safeStorage still fails closed.
if (
  process.platform === "linux" &&
  !app.commandLine.hasSwitch("password-store") &&
  !/\b(?:kde|plasma|lxqt)\b/iu.test(process.env.XDG_CURRENT_DESKTOP ?? "") &&
  Boolean(process.env.DBUS_SESSION_BUS_ADDRESS || process.env.XDG_RUNTIME_DIR)
) {
  app.commandLine.appendSwitch("password-store", "gnome-libsecret");
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
    minWidth: mainWindowMinWidth,
    minHeight: mainWindowMinHeight,
    title: appName,
    icon: appIcon,
    autoHideMenuBar: process.platform !== "darwin",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    titleBarOverlay:
      process.platform === "win32"
        ? {
            color: "#171717",
            symbolColor: "#e5e5e5",
            height: 38,
          }
        : undefined,
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: currentAppearance() === "dark" ? "#171717" : "#f5f5f4",
    webPreferences: {
      preload: join(mainDir, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(join(mainDir, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow?.webContents.setZoomFactor(rendererZoomFactor);
  });
  installNewProjectShortcut(mainWindow.webContents, () => sendAppCommand("newProject"));
  installNewThreadShortcut(mainWindow.webContents, () => sendAppCommand("newThread"));
  installOpenSettingsShortcut(mainWindow.webContents, () => sendAppCommand("openSettings"));
  installOpenFileSearchShortcut(mainWindow.webContents, () => sendAppCommand("openFileSearch"));

  mainWindow.on("closed", () => {
    browser.destroy();
    mainWindow = null;
  });
  browser.attach(mainWindow);
}

function sendToRenderer(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload);
}

const autoUpdate = createAutoUpdateController({
  getMainWindow: () => mainWindow,
  isPackaged: app.isPackaged,
});
autoUpdate.onStatus((status) => {
  sendToRenderer("appUpdate:status", status);
});

function sendAppCommand(command: AppCommand): void {
  if (command === "checkForUpdates") {
    void autoUpdate.checkForUpdates({ interactive: true });
    return;
  }
  sendToRenderer("app:command", { command });
}

ipcMain.handle("appUpdate:status", () => autoUpdate.getStatus());
ipcMain.handle("appUpdate:check", (_event, interactive?: boolean) =>
  autoUpdate.checkForUpdates({ interactive: Boolean(interactive) }),
);
ipcMain.handle("appUpdate:install", () => autoUpdate.installUpdate());

roder.on("notification", (payload) => {
  recordAppServerEvent("notification", payload.method, payload.params);
  sendToRenderer("roder:notification", payload);
  maybeNotifyRemoteFilesChanged(payload.method, payload.params);
  void getDesktopAgentTools()
    .onNotification(payload.method, payload.params)
    .catch(() => {
      recordAppServerEvent("error", "desktop/tools", "Could not resolve a desktop tool execution");
    });
  if (payload.method === "thread/toolExecutionResolved") getDesktopAgentTools().onResolved(payload.params);
  if (persistentAgentService)
    void persistentAgentService.onNotification(payload.method, payload.params).catch(() => {
      recordAppServerEvent("error", "desktop/persistent-agents", "Could not process a persistent agent event");
    });
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
chromeBridge.on("status", (payload) => sendToRenderer("chromeBridge:status", payload));

ipcMain.handle("roder:status", () => roder.status());
ipcMain.handle("roder:start", async () => {
  const status = await roder.start();
  await startPersistentAgents().catch(reportPersistentAgentStartupError);
  return status;
});
async function restartRoderEngine() {
  await persistentAgentService?.stop();
  persistentAgentService = null;
  spriteManager = null;
  blaxelClient?.clearCache();
  remoteWorkspaceService?.closeAll();
  await agentBackends?.stopAll();
  await getCloudCredentialsService().hydrate();
  const status = await roder.restart();
  agentBackends?.probeInBackground();
  persistentAgentStartPromise = null;
  await startPersistentAgents().catch(reportPersistentAgentStartupError);
  return status;
}

ipcMain.handle("roder:restart", () => restartRoderEngine());
ipcMain.handle("imageGeneration:configure", async (_event, input: unknown) => {
  if (changingImageCredentials) throw Error("Image credential setup is already running.");
  if (!isRecord(input) || typeof input.apiKey !== "string") throw Error("Enter an OpenAI API key.");
  changingImageCredentials = true;
  try {
    return await configureImageGenerationKey(input.apiKey, getImageCredentials());
  } finally {
    changingImageCredentials = false;
  }
});
ipcMain.handle("roder:appearance", () => currentAppearance());
ipcMain.handle("openExternal", (_event, url: string) => openExternalTarget(url));
ipcMain.handle("roder:request", async (_event, method: string, params: unknown) => {
  return handleRoderRequest(method, params);
});
ipcMain.handle("worktrees:list", (_event, context: LocalWorktreeContext) => getDesktopWorktrees().list(context));
ipcMain.handle("worktrees:create", (_event, context: LocalWorktreeContext, branch: string) =>
  getDesktopWorktrees().create(context, branch),
);
ipcMain.handle("worktrees:remove", (_event, context: LocalWorktreeContext, path: string) =>
  getDesktopWorktrees().remove(context, path),
);
ipcMain.handle("window:setMinWidth", (_event, width: number) => {
  if (!mainWindow || !Number.isFinite(width)) {
    return;
  }
  // The renderer derives this from the sidebar + readable main column (never the right panel).
  // Clamp defensively so a bad value can never wedge the window at an unusable size.
  const clampedWidth = Math.round(Math.min(4000, Math.max(mainPanelMinWidth, width)));
  const [, currentMinHeight] = mainWindow.getMinimumSize();
  mainWindow.setMinimumSize(clampedWidth, currentMinHeight || mainWindowMinHeight);
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
ipcMain.handle("workspace:openFolders", async (_event, defaultPath?: string) => {
  const options: Electron.OpenDialogOptions = {
    title: "Add Workspace Folders",
    defaultPath,
    properties: ["openDirectory", "createDirectory", "multiSelections"],
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths;
});
ipcMain.handle("terminal:start", (_event, options: TerminalStartOptions) => {
  if (options?.id === antigravitySetupSession) {
    const runtimePath = findAntigravityRuntime();
    const setup = resolveAntigravitySetupCommand({
      binaryPath: resolveEmbeddedRoderBinary(),
      runtimePath,
      mode: options.antigravitySetupMode,
    });
    const extraEnv = runtimePathExtraEnv(process.env, runtimePath);
    return terminal.start(
      { ...options, cwd: options?.cwd || homedir(), forceRestart: true },
      { executable: setup.executable, args: setup.args, env: extraEnv },
    );
  }
  if (options?.id === codexSetupSession) {
    const runtimePath = findCodexRuntime();
    const setup = resolveCodexSetupCommand({ runtimePath });
    const extraEnv = runtimePathExtraEnv(process.env, runtimePath);
    return terminal.start(
      { ...options, cwd: options?.cwd || homedir(), forceRestart: true },
      { executable: setup.executable, args: setup.args, env: extraEnv },
    );
  }
  return terminal.start({ ...options, cwd: options?.cwd || process.cwd() });
});
ipcMain.handle("terminal:write", (_event, data: string, id?: string) => terminal.write(data, id));
ipcMain.handle("terminal:runMarkdownCommand", (event, command: unknown) => {
  const contents = mainWindow?.webContents;
  const frame = event.senderFrame;
  if (!contents || event.sender !== contents || !frame || frame.parent) {
    throw new Error("Only the desktop window can run a Markdown command.");
  }
  const actual = new URL(frame.url);
  const renderer = new URL(
    MAIN_WINDOW_VITE_DEV_SERVER_URL ??
      pathToFileURL(join(mainDir, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)).href,
  );
  actual.hash = renderer.hash = "";
  actual.search = renderer.search = "";
  if (actual.href !== renderer.href) {
    throw new Error("Only the desktop window can run a Markdown command.");
  }
  return runMarkdownShellCommand(command);
});
ipcMain.handle("terminal:resize", (_event, cols: number, rows: number, id?: string) => terminal.resize(cols, rows, id));
ipcMain.handle("terminal:stop", (_event, id?: string) => terminal.stop(id));
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
ipcMain.handle("chromeBridge:status", () => chromeBridge.status());
ipcMain.handle("chromeBridge:start", () => chromeBridge.start());
ipcMain.handle("chromeBridge:stop", () => chromeBridge.stop());
ipcMain.handle("chromeBridge:restart", () => chromeBridge.restart());
ipcMain.handle("chromeBridge:openExtensionOptions", () => chromeBridge.openExtensionOptions());
ipcMain.handle("canvas:savePng", (_event, dataUrl: string) =>
  savePngDataUrl(dataUrl, "canvas", "roder-desktop-canvas"),
);
ipcMain.handle("clipboard:saveImage", (_event, dataUrl: string) =>
  savePngDataUrl(dataUrl, "clipboard", "roder-desktop-clipboard"),
);
ipcMain.handle("codex:account", () => getCodexAccountSnapshot());
ipcMain.handle("codex:login", () => startCodexLogin());
ipcMain.handle("codex:logout", () => logoutCodex());
ipcMain.handle("codex:cancelLogin", () => cancelCodexLogin());
ipcMain.handle("codex:openRateLimitHelp", () => openRateLimitHelp());
ipcMain.handle("agentBackends:snapshot", async () => {
  const manager = getAgentBackends();
  await manager.hydrate();
  return manager.getSnapshot();
});
ipcMain.handle("agentBackends:select", (_event, backend: AgentBackendId) => getAgentBackends().selectBackend(backend));
ipcMain.handle(
  "agentBackends:connect",
  async (_event, backend: ExternalAgentBackendId, options?: { forceRefresh?: boolean }) => {
    const manager = getAgentBackends();
    await manager.connectBackend(backend, { forceRefresh: Boolean(options?.forceRefresh), notifyOnChange: true });
    return manager.getSnapshot();
  },
);
ipcMain.handle("agentBackends:logout", (_event, backend: ExternalAgentBackendId) =>
  getAgentBackends().logoutBackend(backend),
);
ipcMain.handle("antigravity:status", async () => {
  const manager = getAgentBackends();
  await manager.hydrate();
  return manager.getAntigravityStatus();
});
ipcMain.handle("antigravity:connect", async (_event, options?: { forceRefresh?: boolean }) => {
  const manager = getAgentBackends();
  await manager.connectBackend("antigravity", { forceRefresh: Boolean(options?.forceRefresh), notifyOnChange: true });
  return manager.getAntigravityStatus();
});
ipcMain.handle("antigravity:logout", async () => {
  const manager = getAgentBackends();
  await manager.logoutBackend("antigravity");
  return manager.getAntigravityStatus();
});
ipcMain.handle("claude:cliStatus", () =>
  findClaudeCli({ env: process.env, platform: process.platform, homeDir: homedir() }),
);
ipcMain.handle("onboarding:state", () => readOnboardingRecord(onboardingRecordPath(process.env, homedir())));
ipcMain.handle("onboarding:complete", () =>
  writeOnboardingRecord(onboardingRecordPath(process.env, homedir()), new Date().toISOString()),
);
ipcMain.handle("onboarding:environment", () => detectEnvironmentProviders(process.env));
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

ipcMain.handle("mcp:readConfig", async (_event, configPath: string) => {
  try {
    const content = await readFile(configPath, "utf-8");
    return { config: JSON.parse(content), error: null };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { config: { mcpServers: {} }, error: null };
    }
    return { config: null, error: (err as Error).message };
  }
});

ipcMain.handle("mcp:writeConfig", async (_event, configPath: string, config: unknown) => {
  try {
    const dir = dirname(configPath);
    await mkdir(dir, { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2));
    return { error: null };
  } catch (err) {
    return { error: (err as Error).message };
  }
});

const mcpAuthPendingDir = join(homedir(), ".roder", "mcp-auth-pending");
const mcpAuthResultDir = join(homedir(), ".roder", "mcp-auth-results");

async function ensureMcpAuthDirs(): Promise<void> {
  await mkdir(mcpAuthPendingDir, { recursive: true });
  await mkdir(mcpAuthResultDir, { recursive: true });
}

async function readMcpAuthRequest(filePath: string): Promise<unknown | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function startMcpAuthWatcher(): void {
  void ensureMcpAuthDirs().then(() => {
    fsWatch(mcpAuthPendingDir, { persistent: false }, (_event, filename) => {
      if (!filename || !filename.endsWith(".json")) return;
      const filePath = join(mcpAuthPendingDir, filename);
      void readMcpAuthRequest(filePath).then((request) => {
        if (request) {
          sendToRenderer("mcp:authRequested", request);
        }
      });
    });
  });
}

ipcMain.handle("mcp:authSkip", async (_event, id: string) => {
  try {
    const pendingPath = join(mcpAuthPendingDir, `${id}.json`);
    const resultPath = join(mcpAuthResultDir, `${id}.json`);
    await writeFile(resultPath, JSON.stringify({ id, status: "skipped" }));
    await unlink(pendingPath).catch(() => undefined);
  } catch {
    // ignore cleanup errors
  }
});

ipcMain.handle("mcp:apiKeySubmit", async (_event, id: string, apiKey: string) => {
  const pendingPath = join(mcpAuthPendingDir, `${id}.json`);
  const resultPath = join(mcpAuthResultDir, `${id}.json`);
  const request = await readMcpAuthRequest(pendingPath);
  if (!request || typeof request !== "object") {
    throw new Error("Auth request not found");
  }
  const req = request as Record<string, unknown>;
  const serviceName = String(req.serviceName ?? id);
  await writeFile(resultPath, JSON.stringify({ id, status: "complete", apiKey, serviceName }));
  await unlink(pendingPath).catch(() => undefined);
});

ipcMain.handle("mcp:oauthStart", async (_event, id: string, url: string) => {
  // Open the OAuth URL with our callback scheme embedded
  const callbackUrl = `roder://mcp-oauth-callback?id=${encodeURIComponent(id)}`;
  const oauthUrl = new URL(url);
  // Only inject redirect_uri if not already set
  if (!oauthUrl.searchParams.has("redirect_uri")) {
    oauthUrl.searchParams.set("redirect_uri", callbackUrl);
  }
  await shell.openExternal(oauthUrl.toString());
});

nativeTheme.on("updated", () => {
  sendToRenderer("roder:appearance", currentAppearance());
});

// Register deep-link scheme for MCP OAuth callbacks (must be before app is ready on some platforms)
if (!app.isPackaged) {
  // In dev mode we can't reliably use setAsDefaultProtocolClient, but register anyway
  app.setAsDefaultProtocolClient("roder");
} else {
  app.setAsDefaultProtocolClient("roder");
}

// Handle OAuth callback on macOS via open-url event
app.on("open-url", (_event, url) => {
  handleMcpOAuthCallback(url);
});

// Handle OAuth callback on Windows/Linux via second-instance argv
app.on("second-instance", (_event, argv) => {
  const deepLink = argv.find((arg) => arg.startsWith("roder://"));
  if (deepLink) {
    handleMcpOAuthCallback(deepLink);
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function handleMcpOAuthCallback(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "mcp-oauth-callback") return;
    const id = parsed.searchParams.get("id");
    const error = parsed.searchParams.get("error");
    if (!id) return;
    const status = error ? "failed" : "complete";
    sendToRenderer("mcp:oauthCallback", { id, status, error: error ?? undefined });
    // Write result file so the skill can read it
    void writeFile(join(mcpAuthResultDir, `${id}.json`), JSON.stringify({ id, status, error: error ?? null })).catch(
      () => undefined,
    );
    void unlink(join(mcpAuthPendingDir, `${id}.json`)).catch(() => undefined);
  } catch {
    // ignore malformed URLs
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(Menu.buildFromTemplate(createApplicationMenuTemplate(sendAppCommand)));
  createWindow();
  startMcpAuthWatcher();
  // Detect a newer feed version for the sidebar update button (and download on Mac when packaged).
  setTimeout(() => {
    void autoUpdate.checkForUpdates({ interactive: false });
  }, 4_000);
  try {
    await getCloudCredentialsService().hydrate();
    await getAgentBackends().hydrate();
    if (process.platform !== "win32") {
      await getTailscaleRunnerGateway()
        .start()
        .catch(() => undefined);
    }
    await roder.start();
    getAgentBackends().probeInBackground();
    await startPersistentAgents().catch(reportPersistentAgentStartupError);
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

let shuttingDown = false;
app.on("before-quit", (event) => {
  if (shuttingDown) return;
  event.preventDefault();
  shuttingDown = true;
  terminal.stop();
  remoteWorkspaceService?.closeAll();
  browser.destroy();
  void (async () => {
    try {
      await persistentAgentService?.stop();
    } finally {
      tailscaleSshClient?.closeAll();
      await Promise.allSettled([
        tailscaleRunnerGateway?.stop(),
        extensionHost?.stopAll(),
        agentBackends?.stopAll(),
        roder.stop(),
        chromeBridge.stop(),
      ]);
      app.quit();
    }
  })().catch(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

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

function getIssuesService(): IssuesService {
  issuesService ??= new IssuesService({
    storagePath: join(app.getPath("userData"), "issues", "issues.json"),
    onEvent: (event) => {
      sendToRenderer("roder:notification", event);
      if (persistentAgentService)
        void persistentAgentService.onNotification(event.method, event.params).catch(() => {
          recordAppServerEvent("error", "desktop/persistent-agents", "Could not process an issue event");
        });
    },
    launchIssue,
  });
  return issuesService;
}

async function launchIssue(issue: Issue, project: IssueProject): Promise<{ threadId: string }> {
  const result = (await roder.request("workspace/list", {})) as { workspaces: Workspace[] };
  const workspace = result.workspaces.find((entry) => entry.id === project.workspaceId);
  if (!workspace) throw new Error("Link this project to an existing workspace before starting work");
  const created = (await requestEngine("thread/start", {
    workspaceId: workspace.id,
    rootId: workspace.defaultRootId,
    ephemeral: false,
    developerInstructions: `Work on local Roder issue #${issue.number} (${issue.id}) in project ${project.name} (${project.id}). Use issues_read and issues_update to record progress and blockers. Do not mark work done before verifying it.`,
  })) as { thread: { id: string } };
  const threadId = created.thread.id;
  await requestEngine("turn/start", {
    threadId,
    input: [{ type: "text", text: `Work on issue #${issue.number}: ${issue.title}\n\n${issue.description}` }],
  });
  sendToRenderer("roder:notification", { method: "desktop/issues/threadStarted", params: { threadId } });
  return { threadId };
}

function getPersistentAgentService(): ReturnType<typeof createPersistentAgentService> {
  persistentAgentService ??= createPersistentAgentService({
    directory: join(app.getPath("userData"), "persistent-agents"),
    request: (method, params) => requestEngine(method, params, false),
    sprites: getSpriteManager(),
    notify: () => sendToRenderer("roder:notification", { method: "desktop/persistent-agents/changed", params: {} }),
  });
  return persistentAgentService;
}

function getImageCredentials(): ReturnType<typeof createImageGenerationCredentials> {
  imageCredentials ??= createImageGenerationCredentials({
    directory: join(app.getPath("userData"), "persistent-agents", "credentials"),
    storage: safeStorage,
    onUnavailable: () => {
      recordAppServerEvent(
        "error",
        "media/image/credentials",
        "The saved image API key is unavailable. Codex and inference credentials are unchanged. Unlock OS secure storage or save the image key again before explicitly using the API route.",
      );
      sendToRenderer("roder:notification", {
        method: "desktop/persistent-agents/imageCredentialUnavailable",
        params: {},
      });
    },
  });
  return imageCredentials;
}

function getSpriteManager(): ReturnType<typeof createPersistentAgentSpriteManager> {
  spriteManager ??= createPersistentAgentSpriteManager({
    directory: join(app.getPath("userData"), "persistent-agents", "sprites"),
    generateCodex: async (prompt) => {
      const generator = createCodexImageGenerator({
        directory: join(app.getPath("userData"), "persistent-agents", "image-work"),
      });
      const capability = await generator.probe();
      if (!capability.authenticated) throw Error("Codex sign-in required");
      if (!capability.imageGeneration) throw Error("Codex image generation is unavailable for this account");
      return generator.generate({ prompt });
    },
    generateOpenAi: createOpenAiImageGenerator({
      getApiKey: async () => (await getImageCredentials().load()) ?? process.env.OPENAI_API_KEY ?? null,
    }),
    normalizeImage: createSpriteImageNormalizer(nativeImage),
    notify: () => sendToRenderer("roder:notification", { method: "desktop/persistent-agents/changed", params: {} }),
  });
  return spriteManager;
}

function startPersistentAgents(): Promise<void> {
  persistentAgentStartPromise ??= getPersistentAgentService().start();
  return persistentAgentStartPromise;
}

function reportPersistentAgentStartupError(): void {
  recordAppServerEvent(
    "error",
    "desktop/persistent-agents",
    "Persistent agent startup failed; open Persistent Agents for the error. Engine remains available.",
  );
}

function getDesktopAgentTools(): DesktopAgentTools {
  desktopAgentTools ??= new DesktopAgentTools(
    [
      ...issueToolDefinitions.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
        execute: (args: unknown) => handleIssueToolCall(getIssuesService(), tool.name, args),
      })),
      ...persistentAgentToolDefinitions.map((tool) => ({
        ...tool,
        execute: async (args: unknown, context: { threadId: string }) => {
          await startPersistentAgents();
          return getPersistentAgentService().handleTool(tool.name, args, context);
        },
      })),
      {
        ...persistentAgentCreateTool,
        execute: (args: unknown, context: { threadId: string }) =>
          createPersistentAgentFromTool(args, context.threadId, handleRoderRequest),
      },
      {
        ...persistentAgentWorkspacesTool,
        execute: (args: unknown) => listPersistentAgentWorkspaces(args, handleRoderRequest),
      },
      {
        ...desktopConfigTool,
        execute: (args: unknown, context: { threadId: string }) =>
          configureDesktopFromTool(
            args,
            async (method, params) => {
              const result = await handleRoderRequest(method, params);
              if (method === "desktop/cloud-machines/save") {
                sendToRenderer("roder:notification", { method: machineProfilesChanged, params: {} });
              }
              return result;
            },
            context.threadId,
          ),
      },
    ],
    (method, params) => roder.request(method, params),
    `${desktopConfigInstructions}\n\nDesktop built-in skill ($persistent-agent):\n${persistentAgentSkillBody}`,
  );
  return desktopAgentTools;
}

let desktopWorktrees: DesktopWorktrees | undefined;

function getDesktopWorktrees(): DesktopWorktrees {
  desktopWorktrees ??= new DesktopWorktrees(
    new GitWorktrees(join(app.getPath("userData"), "worktrees")),
    (method, params) => roder.request(method, params),
  );
  return desktopWorktrees;
}

async function requestEngine(method: string, params: unknown, enrichPersistentAgentContext = true): Promise<unknown> {
  if (method === "turn/start") params = getDesktopAgentTools().turnStartParams(params);
  if (method === "thread/start") {
    const input = await cloudMachineThreadParams(
      params,
      (id) => getCloudMachinesService().runnerFor(id),
      async () => {
        const result = (await roder.request("runners/list", {})) as { active?: unknown };
        return result.active;
      },
      process.platform,
      async (machineId, runner) => {
        const gateway = getTailscaleRunnerGateway();
        const { baseUrl } = await gateway.start();
        const profile = await getCloudMachinesService().getProfile(machineId);
        const transport = runner.providerId === "ssh" ? "ssh" : "tailscale";
        if (transport === "ssh") {
          parseSshMachineConfig(runner.config);
        } else {
          parseTailscalePeerConfig(runner.config);
        }
        return {
          providerId: gateway.backingProviderId,
          workspace: runner.workspace,
          config: {
            ...runner.config,
            base_url: baseUrl,
            roder_transport: transport,
            machine_name: profile.name,
          },
          ...(runner.readRoots ? { readRoots: runner.readRoots } : {}),
        };
      },
    );
    const { desktopWorktreePath, ...threadParams } = input;
    if (desktopWorktreePath !== undefined) {
      if (
        input.runner !== undefined ||
        typeof desktopWorktreePath !== "string" ||
        typeof input.workspaceId !== "string" ||
        typeof input.rootId !== "string"
      ) {
        throw new Error("A worktree checkout requires a local workspace folder.");
      }
      return getDesktopWorktrees().startThread(
        { workspaceId: input.workspaceId, rootId: input.rootId },
        desktopWorktreePath,
        (root) =>
          roder.request(
            method,
            getDesktopAgentTools().threadStartParams({
              ...threadParams,
              rootId: root.id,
              cwd: root.path,
            }),
          ),
      );
    }
    const start = () => roder.request(method, getDesktopAgentTools().threadStartParams(threadParams));
    return input.runner === undefined ? getDesktopWorktrees().startInCurrentFolder(start) : start();
  }
  if (
    method === "turn/start" &&
    enrichPersistentAgentContext &&
    persistentAgentService &&
    params &&
    typeof params === "object"
  ) {
    params = await persistentAgentService.turnStartParams(params);
  }
  return roder.request(method, params);
}

let cloudMachinesService: CloudMachinesService | undefined;
let cloudCredentialsService: CloudCredentialsService | undefined;
let blaxelClient: BlaxelClient | undefined;
let tailscaleSshClient: TailscaleSshClient | undefined;
let tailscaleRunnerGateway: TailscaleRunnerGateway | undefined;
let remoteWorkspaceService: RemoteWorkspaceService | undefined;
let agentBackends: AgentBackendsManager | undefined;

function getAgentBackends(): AgentBackendsManager {
  agentBackends ??= new AgentBackendsManager({
    createClient: (backend) =>
      new RoderAppServerClient({
        backend,
        getExtraEnv: () => ({
          ...getRoderExtraEnv(),
          ...runtimePathExtraEnv(process.env, findExternalBackendRuntime(backend)),
        }),
      }),
    storagePath: join(app.getPath("userData"), "agent-backends.json"),
    runLogoutCommand: (backend) =>
      runExternalBackendLogoutCli(backend, { roderBinaryPath: resolveEmbeddedRoderBinary(), env: process.env }),
    onNotification: (payload) => {
      recordAppServerEvent("notification", payload.method, payload.params);
      sendToRenderer("roder:notification", payload);
    },
    onChanged: (snapshot) => {
      sendToRenderer("roder:notification", { method: "desktop/backends/changed", params: snapshot });
      sendToRenderer("roder:notification", { method: "desktop/providers/changed", params: {} });
    },
    onStderr: (backend, payload) => {
      recordAppServerEvent("stderr", backend, payload);
      sendToRenderer("roder:stderr", payload);
    },
  });
  return agentBackends;
}

function cloudEncryptionAvailable(): boolean {
  return (
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text")
  );
}

function getCloudMachinesService(): CloudMachinesService {
  return (cloudMachinesService ??= new CloudMachinesService({
    filePath: join(app.getPath("userData"), "cloud-machines.enc"),
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (value) => safeStorage.decryptString(value),
    encryptionAvailable: cloudEncryptionAvailable,
  }));
}

function getCloudCredentialsService(): CloudCredentialsService {
  return (cloudCredentialsService ??= new CloudCredentialsService({
    filePath: join(app.getPath("userData"), "cloud-credentials.enc"),
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (value) => safeStorage.decryptString(value),
    encryptionAvailable: cloudEncryptionAvailable,
  }));
}

function getBlaxelClient(): BlaxelClient {
  return (blaxelClient ??= new BlaxelClient());
}

function getTailscaleSshClient(): TailscaleSshClient {
  return (tailscaleSshClient ??= new TailscaleSshClient());
}

function getTailscaleRunnerGateway(): TailscaleRunnerGateway {
  return (tailscaleRunnerGateway ??= new TailscaleRunnerGateway({
    sshClient: getTailscaleSshClient(),
  }));
}

function getRemoteWorkspaceService(): RemoteWorkspaceService {
  if (!remoteWorkspaceService) {
    const service = new RemoteWorkspaceService({
      blaxelClient: getBlaxelClient(),
      credentialsService: getCloudCredentialsService(),
      machinesService: getCloudMachinesService(),
      sshClient: getTailscaleSshClient(),
      readThreadRunner: async (threadId) => {
        const result = (await roder.request("thread/read", { threadId, includeTurns: false })) as {
          thread?: { runner?: unknown };
        };
        const runner = result?.thread?.runner;
        if (!runner || typeof runner !== "object") return null;
        const record = runner as Record<string, unknown>;
        if (typeof record.providerId !== "string" || typeof record.workspace !== "string") return null;
        return {
          providerId: record.providerId,
          workspace: record.workspace,
          config: isRecord(record.config) ? record.config : {},
        };
      },
    });
    service.on("notification", (notification) => {
      sendToRenderer("roder:notification", notification);
    });
    remoteWorkspaceService = service;
  }
  return remoteWorkspaceService;
}

function maybeNotifyRemoteFilesChanged(method: string, params: unknown): void {
  if (!remoteWorkspaceService || !isRecord(params)) return;
  const threadId = typeof params.threadId === "string" ? params.threadId : "";
  if (!threadId || !remoteWorkspaceService.hasCachedThreadRunner(threadId)) return;
  const shouldRefresh =
    method === "turn/completed" ||
    (method === "item/completed" && isRecord(params.item) && params.item.type === "toolExecution");
  if (!shouldRefresh) return;
  remoteWorkspaceService.invalidateThread(threadId);
  sendToRenderer("roder:notification", {
    method: "workspace/files/statusChanged",
    params: {
      status: {
        workspaceId: remoteWorkspaceIdForThread(threadId),
        state: "ready",
        stale: false,
        roots: [],
        fileCount: 0,
        directoryCount: 0,
      },
    },
  });
}

async function handleRoderRequest(method: string, params: unknown): Promise<unknown> {
  const backends = getAgentBackends();
  await backends.hydrate();
  if (method === "desktop/thread/history/index" || method === "desktop/thread/history/range") {
    const input = params as Record<string, unknown> | null;
    if (!input || typeof input.threadId !== "string" || !input.threadId) throw new Error("A thread ID is required");
    if (input.before !== null && typeof input.before !== "string") throw new Error("Invalid history boundary");
    const boundary = { threadId: input.threadId, before: input.before as string | null };
    if (method === "desktop/thread/history/index") return threadHistoryIndex.index(boundary);
    if (
      ![input.start, input.end, input.olderCount].every(
        (value) => typeof value === "number" && Number.isSafeInteger(value),
      )
    )
      throw new Error("Invalid history range");
    return threadHistoryIndex.read({
      ...boundary,
      start: input.start as number,
      end: input.end as number,
      olderCount: input.olderCount as number,
    });
  }
  if (method === "thread/history/read") {
    const input = params as { threadId?: unknown; before?: unknown; limit?: unknown; maxBytes?: unknown } | null;
    if (!input || typeof input.threadId !== "string" || !input.threadId) throw new Error("A thread ID is required");
    if (input.before !== undefined && typeof input.before !== "string") throw new Error("Invalid history cursor");
    if (input.limit !== undefined && typeof input.limit !== "number") throw new Error("Invalid history page size");
    if (input.maxBytes !== undefined && typeof input.maxBytes !== "number")
      throw new Error("Invalid history byte budget");
    const threadBackend = backends.backendForThread(input.threadId);
    const page = threadBackend
      ? ((await backends.handleRequest(threadBackend, "thread/history/read", input)) as ThreadHistoryPage)
      : await threadHistory.read({
          threadId: input.threadId,
          before: input.before as string | undefined,
          limit: input.limit as number | undefined,
          maxBytes: input.maxBytes as number | undefined,
        });
    getRemoteWorkspaceService().observeResponse(method, page);
    recordAppServerEvent("response", method, {
      threadId: input.threadId,
      itemCount: page.thread?.turns?.reduce((count, turn) => count + turn.items.length, 0) ?? 0,
      hasMore: page.hasMore,
    });
    return page;
  }
  // Config and credentials may contain secrets even when validation later rejects them.
  const redactRequestPayload =
    method === "desktop/cloud-machines/save" ||
    method.startsWith("desktop/cloud-machines/credentials/") ||
    method.startsWith("desktop/cloud-machines/tailscale/");
  recordAppServerEvent("request", method, redactRequestPayload ? "[redacted]" : redactSecrets(params ?? {}));

  // Route remote workspace requests through the tunneled remote-roder app-server inside the sandbox.
  if (
    isRecord(params) &&
    isRemoteWorkspaceId(params.workspaceId) &&
    (method.startsWith("workspace/files/") ||
      method.startsWith("vcs/changes/") ||
      method.startsWith("design/") ||
      method === "skills/list")
  ) {
    const remoteService = getRemoteWorkspaceService();
    try {
      const result = await remoteService.proxyRequest(method, params);
      recordAppServerEvent("response", method, { remote: true, workspaceId: params.workspaceId });
      return result;
    } catch (error) {
      recordAppServerEvent("error", method, (error as Error).message);
      throw error;
    }
  }

  if (method.startsWith("desktop/cloud-machines/")) {
    const service = getCloudMachinesService();
    const credentials = getCloudCredentialsService();
    const blaxel = getBlaxelClient();
    const remoteService = getRemoteWorkspaceService();
    const input = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
    if (method === "desktop/cloud-machines/list") return service.list();
    if (method === "desktop/cloud-machines/get" && typeof input.id === "string") {
      return { machine: await service.getProfile(input.id) };
    }
    if (method === "desktop/cloud-machines/save") {
      if (input.providerId === "tailscale" || input.providerId === "ssh") {
        if (process.platform === "win32") {
          throw new Error("Remote SSH and Tailscale machines are not supported on Windows yet.");
        }
        if (!isRecord(input.config)) {
          throw new Error("Machine configuration must be a JSON object.");
        }
        if (input.providerId === "ssh") {
          parseSshMachineConfig(input.config);
        } else {
          parseTailscalePeerConfig(input.config);
        }
        return service.save(input);
      }
      const runners = (await roder.request("runners/list", {})) as { providers: { provider_id: string }[] };
      if (!runners.providers.some((provider) => provider.provider_id === input.providerId)) {
        throw new Error("This runner provider is not installed in the embedded Roder harness.");
      }
      return service.save(input);
    }
    if (method === "desktop/cloud-machines/remove" && typeof input.id === "string") return service.remove(input.id);
    if (method === "desktop/cloud-machines/test") {
      if (typeof input.id === "string" && input.id) {
        const runner = await service.runnerFor(input.id);
        return remoteService.testProfile(runner);
      }
      if (typeof input.providerId === "string" && typeof input.workspace === "string" && isRecord(input.config)) {
        return remoteService.testProfile({
          providerId: input.providerId,
          workspace: input.workspace,
          config: input.config,
        });
      }
      throw new Error("Invalid cloud machine test request.");
    }
    if (method === "desktop/cloud-machines/credentials/status") {
      const [{ statuses }, blaxelCli, tailscaleCredentials, localTailscale, localSsh] = await Promise.all([
        credentials.listStatuses(process.env),
        detectBlaxelCli({ env: process.env, platform: process.platform, homeDir: homedir() }),
        credentials.getTailscaleStatus(process.env),
        detectLocalTailscale({ env: process.env, platform: process.platform }),
        detectLocalSshEnvironment({ env: process.env, platform: process.platform, homeDir: homedir() }),
      ]);
      return { statuses, blaxelCli, tailscaleCredentials, localTailscale, localSsh };
    }
    if (method === "desktop/cloud-machines/ssh/status") {
      const local = await detectLocalSshEnvironment({
        env: process.env,
        platform: process.platform,
        homeDir: homedir(),
      });
      return { local };
    }
    if (method === "desktop/cloud-machines/tailscale/status") {
      const [local, tailscaleCredentials] = await Promise.all([
        detectLocalTailscale({ env: process.env, platform: process.platform }),
        credentials.getTailscaleStatus(process.env),
      ]);
      return { local, credentials: tailscaleCredentials };
    }
    if (method === "desktop/cloud-machines/credentials/saveTailscaleAuthKey") {
      const authKey = typeof input.authKey === "string" ? input.authKey.trim() : "";
      const preferForSandboxes = input.preferForSandboxes !== false;
      const status = await credentials.saveTailscaleAuthKey({ authKey, preferForSandboxes });
      return { status };
    }
    if (method === "desktop/cloud-machines/credentials/saveTailscaleOAuth") {
      const oauthClientId = typeof input.oauthClientId === "string" ? input.oauthClientId.trim() : "";
      const oauthClientSecret = typeof input.oauthClientSecret === "string" ? input.oauthClientSecret.trim() : "";
      const tags =
        Array.isArray(input.tags) || typeof input.tags === "string" ? (input.tags as string[] | string) : undefined;
      const tailnet = typeof input.tailnet === "string" ? input.tailnet.trim() : undefined;
      const preferForSandboxes = input.preferForSandboxes !== false;
      // Verify OAuth client credentials with Tailscale before saving.
      await requestTailscaleOAuthToken({ oauthClientId, oauthClientSecret });
      const status = await credentials.saveTailscaleOAuth({
        oauthClientId,
        oauthClientSecret,
        tags,
        tailnet,
        preferForSandboxes,
      });
      return { status };
    }
    if (method === "desktop/cloud-machines/credentials/setTailscaleSandboxPreference") {
      const preferForSandboxes = Boolean(input.preferForSandboxes);
      const status = await credentials.setTailscalePreferForSandboxes(preferForSandboxes);
      return { status };
    }
    if (method === "desktop/cloud-machines/credentials/saveBlaxel") {
      const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
      if (!apiKey) throw new Error("Enter a Blaxel API key.");
      const requestedWorkspace = typeof input.workspace === "string" ? input.workspace.trim() : "";
      const workspaces = await blaxel.listWorkspaces(apiKey);
      const workspace = requestedWorkspace || workspaces[0]?.name || "";
      if (!workspace) {
        throw new Error("Enter a Blaxel workspace name or use a key with workspace access.");
      }
      const status = await credentials.saveBlaxel({ apiKey, workspace, source: "manual" });
      await restartRoderEngine();
      return { status, workspaces };
    }
    if (method === "desktop/cloud-machines/credentials/importBlaxelCli") {
      const requestedWorkspace = typeof input.workspace === "string" ? input.workspace.trim() : undefined;
      const imported = await readBlaxelCliCredentials(requestedWorkspace, {
        env: process.env,
        platform: process.platform,
        homeDir: homedir(),
      });
      if (!imported?.apiKey) {
        throw new Error("No authenticated Blaxel CLI credentials found. Run `bl login` or paste an API key.");
      }
      const workspaces = await blaxel.listWorkspaces(imported.apiKey).catch(() => []);
      const workspace = requestedWorkspace || imported.workspace || workspaces[0]?.name || "";
      if (!workspace) {
        throw new Error("Blaxel CLI is authenticated but no workspace was found.");
      }
      const status = await credentials.saveBlaxel({ apiKey: imported.apiKey, workspace, source: "blaxel-cli" });
      await restartRoderEngine();
      return { status, workspaces };
    }
    if (method === "desktop/cloud-machines/credentials/saveProviderToken") {
      const providerId = typeof input.providerId === "string" ? input.providerId : "";
      const token = typeof input.token === "string" ? input.token : "";
      const status = await credentials.saveProviderToken(providerId, token);
      await restartRoderEngine();
      return { status };
    }
    if (method === "desktop/cloud-machines/credentials/clear" && typeof input.providerId === "string") {
      const result = await credentials.clearProvider(input.providerId);
      if (input.providerId === "tailscale") {
        remoteWorkspaceService?.closeAll();
      } else {
        await restartRoderEngine();
      }
      return result;
    }
    if (method === "desktop/cloud-machines/blaxel/workspaces") {
      const auth = await credentials.resolveBlaxelAuth(undefined, process.env);
      if (!auth?.apiKey) return { workspaces: [] };
      return { workspaces: await blaxel.listWorkspaces(auth.apiKey) };
    }
    if (method === "desktop/cloud-machines/blaxel/sandboxes") {
      const requestedWorkspace = typeof input.workspace === "string" ? input.workspace.trim() : undefined;
      const auth = await credentials.resolveBlaxelAuth(requestedWorkspace, process.env);
      if (!auth?.apiKey || !auth.workspace) {
        return { sandboxes: [], workspace: auth?.workspace ?? null };
      }
      return { sandboxes: await blaxel.listSandboxes(auth), workspace: auth.workspace };
    }
    if (method === "desktop/cloud-machines/blaxel/createSandbox") {
      const requestedWorkspace = typeof input.workspace === "string" ? input.workspace.trim() : undefined;
      const auth = await credentials.resolveBlaxelAuth(requestedWorkspace, process.env);
      if (!auth?.apiKey || !auth.workspace) {
        throw new Error("Connect Blaxel in Settings > Cloud Machines before creating a sandbox.");
      }
      const sandbox = await blaxel.createSandbox(auth, {
        name: typeof input.name === "string" ? input.name : "",
        image: typeof input.image === "string" ? input.image : undefined,
        memory: typeof input.memory === "number" ? input.memory : undefined,
        region: typeof input.region === "string" ? input.region : undefined,
        workingDir: typeof input.workingDir === "string" ? input.workingDir : "/workspace",
      });
      return { sandbox };
    }
    if (method === "desktop/cloud-machines/remote/status" && typeof input.workspaceId === "string") {
      return { status: await remoteService.getStatus(input.workspaceId) };
    }
    if (method === "desktop/cloud-machines/remote/wake" && typeof input.workspaceId === "string") {
      return { status: await remoteService.wake(input.workspaceId) };
    }
    if (method === "desktop/cloud-machines/remote/setupTailscale" && typeof input.workspaceId === "string") {
      return { status: await remoteService.setupTailscaleTunnel(input.workspaceId) };
    }
    if (
      method === "desktop/cloud-machines/remote/previewPort" &&
      typeof input.workspaceId === "string" &&
      typeof input.port === "number"
    ) {
      return remoteService.openPreviewPort(input.workspaceId, input.port);
    }
    throw new Error("Invalid cloud machine request.");
  }
  if (method.startsWith("desktop/issues/") || method.startsWith("desktop/projects/")) {
    return getIssuesService().request(method, params ?? {});
  }
  if (method.startsWith("desktop/persistent-agents/")) {
    await startPersistentAgents();
    const result = await getPersistentAgentService().handleRequest(method, params ?? {});
    if (method === "desktop/persistent-agents/create" || method === "desktop/persistent-agents/promote") {
      const persistentAgent = result as PersistentAgentDetail;
      await getIssuesService().request("desktop/projects/ensureWorkspace", {
        workspaceId: persistentAgent.workspaceId,
        name: persistentAgent.name,
        description: persistentAgent.mission,
        persistentAgentThreadId: persistentAgent.threadId,
      });
    }
    return result;
  }
  const requestedBrowserProvider = browserProviderFromRequestParams(params);
  if (requestedBrowserProvider) {
    sessionBrowserProvider = requestedBrowserProvider;
    const threadId = browserThreadIdFromParams(params);
    if (threadId) {
      browserProviderByThread.set(threadId, requestedBrowserProvider);
    }
  }
  if (method === "tools/list") {
    try {
      const baseTools = await roder.request(method, params);
      const result = mergeDesktopBrowserTools(mergeExtensionTools(baseTools, await getExtensionCatalog().list()));
      recordAppServerEvent("response", method, result);
      return result;
    } catch (error) {
      recordAppServerEvent("error", method, (error as Error).message);
      throw error;
    }
  }
  if (method === "tools/call") {
    const browserToolName = desktopBrowserToolName(params);
    if (browserToolName) {
      const provider = browserProviderForParams(params);
      if (provider === "builtIn") {
        sendAppCommand("openBrowser");
      }
      const result =
        provider === "chrome"
          ? await callChromeBrowserToolAlias(
              (nextMethod, nextParams) => roder.request(nextMethod, nextParams),
              browserToolName,
              params,
            )
          : await callDesktopBrowserTool(browser, browserToolName, params);
      recordAppServerEvent(result.is_error ? "error" : "response", method, result);
      return result;
    }
    const catalog = await getExtensionCatalog().list();
    const toolName = extensionToolName(params, catalog);
    if (toolName) {
      const result = await callExtensionTool(getExtensionHost(), toolName, params);
      recordAppServerEvent(result.is_error ? "error" : "response", method, result);
      return result;
    }
  }
  if (method === "skills/read") {
    const skill = readPersistentAgentSkill(params);
    if (skill) return skill;
  }
  if (method === "skills/list") {
    try {
      const baseSkills = await roder.request(method, params);
      const result = mergePersistentAgentSkill(mergeDesktopBrowserSkill(baseSkills));
      recordAppServerEvent("response", method, result);
      return result;
    } catch (error) {
      recordAppServerEvent("error", method, (error as Error).message);
      throw error;
    }
  }
  if (method === "runners/list") {
    try {
      const base = (await requestEngine(method, params)) as {
        providers?: Array<{ provider_id: string; capabilities: Record<string, unknown>; setup_hint?: string | null }>;
        [key: string]: unknown;
      };
      const existingProviders = Array.isArray(base?.providers) ? base.providers : [];
      const extraProviders: Array<{
        provider_id: string;
        capabilities: Record<string, unknown>;
        setup_hint?: string | null;
      }> = [];
      if (process.platform !== "win32") {
        if (!existingProviders.some((provider) => provider.provider_id === "ssh")) {
          extraProviders.push({
            provider_id: "ssh",
            capabilities: {
              command_exec: true,
              file_read: true,
              file_write: true,
              port_preview: true,
              cancellation: true,
            },
            setup_hint: null,
          });
        }
        if (!existingProviders.some((provider) => provider.provider_id === "tailscale")) {
          extraProviders.push({
            provider_id: "tailscale",
            capabilities: {
              command_exec: true,
              file_read: true,
              file_write: true,
              port_preview: true,
              cancellation: true,
            },
            setup_hint: null,
          });
        }
      }
      const providers = [...existingProviders, ...extraProviders];
      const result = { ...base, providers };
      recordAppServerEvent("response", method, result);
      return result;
    } catch (error) {
      recordAppServerEvent("error", method, (error as Error).message);
      throw error;
    }
  }
  try {
    const requestedExternalBackend = backends.externalBackendForRequest(method, params);
    if (requestedExternalBackend) {
      let result: unknown;
      if (method === "thread/start" && isRecord(params) && params.desktopWorktreePath !== undefined) {
        const { desktopWorktreePath, ...threadParams } = params;
        if (
          params.desktopCloudMachineId !== undefined ||
          params.cloudMachineId !== undefined ||
          params.runner !== undefined ||
          typeof desktopWorktreePath !== "string" ||
          typeof params.workspaceId !== "string" ||
          typeof params.rootId !== "string"
        ) {
          throw new Error("A worktree checkout requires a local workspace folder.");
        }
        result = await getDesktopWorktrees().startThread(
          { workspaceId: params.workspaceId, rootId: params.rootId },
          desktopWorktreePath,
          (root) =>
            backends.handleRequest(requestedExternalBackend, "thread/start", {
              ...threadParams,
              rootId: root.id,
              cwd: root.path,
            }),
        );
      } else if (method === "thread/start") {
        const start = () => backends.handleRequest(requestedExternalBackend, "thread/start", params);
        result =
          isRecord(params) && params.runner === undefined
            ? await getDesktopWorktrees().startInCurrentFolder(start)
            : await start();
      } else {
        result = await backends.handleRequest(requestedExternalBackend, method, params);
      }
      recordAppServerEvent("response", method, result);
      return result;
    }

    const targetThreadId = browserThreadIdFromParams(params);
    const owningExternalBackend = backends.backendForThread(targetThreadId);
    if (
      owningExternalBackend &&
      (method === "thread/read" ||
        method === "turn/start" ||
        method === "turn/steer" ||
        method === "turn/interrupt" ||
        method === "thread/archive" ||
        method === "thread/set_mode" ||
        method === "thread/goal/get" ||
        method === "turn/subagentTraces/list" ||
        method === "hunk/list" ||
        method === "workspace/changes/list")
    ) {
      const result = await backends.handleRequest(owningExternalBackend, method, params);
      recordAppServerEvent("response", method, result);
      return result;
    }

    if (method === "thread/resolve_approval" && isRecord(params) && typeof params.approvalId === "string") {
      const approvalBackend = backends.backendForApproval(params.approvalId);
      if (approvalBackend) {
        const result = await backends.handleRequest(approvalBackend, method, params);
        recordAppServerEvent("response", method, result);
        return result;
      }
    }

    if (method === "thread/resolve_user_input" && isRecord(params) && typeof params.requestId === "string") {
      const userInputBackend = backends.backendForUserInput(params.requestId);
      if (userInputBackend) {
        const result = await backends.handleRequest(userInputBackend, method, params);
        recordAppServerEvent("response", method, result);
        return result;
      }
    }

    let engineParams = params;
    if (isRecord(params) && "agentBackend" in params) {
      const { agentBackend: _ignoredBackend, ...rest } = params;
      engineParams = rest;
    }
    if (
      (method === "model/select" || method === "providers/select") &&
      owningExternalBackend &&
      isRecord(engineParams)
    ) {
      const { threadId: _ignoredThreadId, thread_id: _ignoredSnakeThreadId, ...rest } = engineParams;
      engineParams = rest;
    }

    let result = await requestEngine(method, engineParams);
    if (method === "providers/list" && isRecord(result)) {
      result = backends.mergeProvidersList(result);
    } else if (method === "model/list" && isRecord(result)) {
      result = backends.mergeModelsList(result);
    } else if (method === "thread/list" && isRecord(result)) {
      result = backends.mergeThreadList(result, params);
    }
    getRemoteWorkspaceService().observeResponse(method, result);
    if (method === "thread/start") {
      rememberStartedThreadBrowserProvider(result, requestedBrowserProvider);
    }
    recordAppServerEvent("response", method, result);
    return result;
  } catch (error) {
    recordAppServerEvent("error", method, (error as Error).message);
    throw error;
  }
}

function browserProviderForParams(params: unknown): BrowserToolProvider {
  const threadId = browserToolThreadId(params);
  return (threadId ? browserProviderByThread.get(threadId) : null) ?? sessionBrowserProvider;
}

function browserThreadIdFromParams(params: unknown): string | null {
  if (!isRecord(params)) {
    return null;
  }
  const threadId = params.threadId ?? params.thread_id;
  return typeof threadId === "string" && threadId.length > 0 ? threadId : null;
}

function rememberStartedThreadBrowserProvider(
  result: unknown,
  requestedBrowserProvider: BrowserToolProvider | null,
): void {
  if (!requestedBrowserProvider || !isRecord(result) || !isRecord(result.thread)) {
    return;
  }
  const threadId = result.thread.id;
  if (typeof threadId === "string" && threadId.length > 0) {
    browserProviderByThread.set(threadId, requestedBrowserProvider);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
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

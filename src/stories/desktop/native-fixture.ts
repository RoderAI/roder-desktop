import { useRoderStore } from "@/stores/roder-store";
import type { BrowserSnapshot, ChromeBridgeStatus } from "@/types/roder";
import { models, noop, noopAsync, threads, workspace } from "./fixtures";
import { roderFileFixture, roderFileFixtures } from "./roder-fixtures";

// No fixture may fall through to real IPC, navigate, or run terminal commands.
const claudeBackendStatus = {
  id: "claude-code",
  name: "Claude Code",
  description: "Interactive Claude Code CLI.",
  state: "disconnected",
  runtimeInstalled: false,
  runtimePath: null,
  connected: false,
  modelCount: 0,
  models: [],
  error: null,
} as const;

export function installNativeFixture(): void {
  useRoderStore.setState({ threads, workspaces: [workspace], models, hydrated: true });

  let browser: BrowserSnapshot = {
    visible: false,
    url: "https://example.test/",
    cdpUrl: "Storybook fixture (no connected browser)",
    canGoBack: false,
    canGoForward: false,
    annotating: false,
  };
  let chromeEnabled = false;
  let bridge: ChromeBridgeStatus = {
    state: "stopped",
    url: null,
    token: null,
    tokenPreview: null,
    pairingUrl: null,
    pid: null,
    clientCount: 0,
  };
  let mcpConfig: unknown = { mcpServers: {} };
  const listeners = new Set<Parameters<Window["roderDesktop"]["onTerminalData"]>[0]>();
  const fixtures = {
    platform: "darwin",
    homeDir: "/storybook",
    hostName: "Storybook",
    async request(method, params) {
      switch (method) {
        case "desktop/roders/list":
          return { roders: [] };
        case "desktop/roders/files/read":
          return roderFileFixture((params as { path: string }).path);
        case "desktop/roders/files/list":
          return { files: roderFileFixtures };
        case "desktop/roders/files/history": {
          const file = roderFileFixture((params as { path: string }).path);
          return { versions: [file] };
        }
        case "desktop/roders/sprite/read":
          return { sprite: null, image: null };
        case "desktop/projects/list":
          return { projects: [] };
        case "desktop/issues/list":
          return { issues: [] };
        case "workspace/list":
          return { workspaces: [workspace] };
        case "model/list":
          return { models };
        case "subagent/traces/list":
          return { traces: [] };
        case "chrome/status":
          return { enabled: chromeEnabled, connected: false, clientCount: 0 };
        case "chrome/enable":
        case "chrome/disable":
          chromeEnabled = method === "chrome/enable";
          return {};
        default:
          throw new Error(`No Storybook fixture for ${method}`);
      }
    },
    onNotification: () => noop,
    setMinWindowWidth: noopAsync,
    mcpReadConfig: async () => ({ config: mcpConfig, error: null }),
    mcpWriteConfig: async (_path, config) => {
      mcpConfig = config;
      return { error: null };
    },
    chromeBridgeStatus: async () => bridge,
    chromeBridgeStart: async () => (bridge = { ...bridge, state: "running" }),
    chromeBridgeRestart: async () => (bridge = { ...bridge, state: "running" }),
    chromeBridgeStop: async () => (bridge = { ...bridge, state: "stopped" }),
    chromeBridgeOpenExtensionOptions: noopAsync,
    onChromeBridgeStatus: () => noop,
    browserHide: async () => (browser = { ...browser, visible: false }),
    browserShow: async () => (browser = { ...browser, visible: true }),
    browserSetBounds: async () => browser,
    browserNavigate: async (url) => (browser = { ...browser, url }),
    browserRefresh: async () => browser,
    browserToggleAnnotation: async () => (browser = { ...browser, annotating: !browser.annotating }),
    openExternal: noopAsync,
    openWorkspaceFolder: async () => workspace.roots[0].path,
    openWorkspaceFolders: async () => [workspace.roots[0].path],
    projectPickerList: async (path) => ({
      path,
      entries: path === "/storybook" ? [{ name: "roder", path: "/storybook/roder", isGitRepo: true }] : [],
      truncated: false,
    }),
    projectPickerSearch: async ({ root, query }) => ({ root, query, matches: [], truncated: false, canceled: false }),
    projectPickerCancelSearch: noopAsync,
    canvasSavePng: async (imageUrl) => ({
      name: "sketch.png",
      path: "/storybook/sketch.png",
      type: "image/png",
      size: 0,
      imageUrl,
      source: "canvas",
    }),
    onTerminalData: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onTerminalExit: () => noop,
    terminalStart: async ({ id = "storybook" } = {}) => {
      for (const listener of listeners) {
        listener({
          id,
          data: "\x1b[32mRoder Desktop\x1b[0m - Storybook terminal fixture\r\nNo shell is running in this preview.\r\n\r\n$ ",
        });
      }
      return { id, pid: 0 };
    },
    terminalResize: noopAsync,
    terminalStop: noopAsync,
    terminalWrite: noopAsync,
    agentBackendsSnapshot: async () => ({
      activeBackend: "roder",
      backends: {
        roder: {
          id: "roder",
          name: "Roder",
          description: "Native Roder runtime with all your configured model providers.",
          state: "connected",
          runtimeInstalled: true,
          runtimePath: null,
          connected: true,
          modelCount: models.length,
          models: [],
          error: null,
        },
        codex: {
          id: "codex",
          name: "Codex",
          description: "OpenAI Codex agent backend via the Codex CLI app-server.",
          state: "disconnected",
          runtimeInstalled: false,
          runtimePath: null,
          connected: false,
          modelCount: 0,
          models: [],
          error: null,
        },
        "claude-code": { ...claudeBackendStatus, models: [] },
        antigravity: {
          id: "antigravity",
          name: "Antigravity",
          description: "Google Antigravity agent backend via the official agy CLI.",
          state: "disconnected",
          runtimeInstalled: false,
          runtimePath: null,
          connected: false,
          modelCount: 0,
          models: [],
          error: null,
        },
      },
    }),
    agentBackendsSelect: async (backend) => ({
      activeBackend: backend,
      backends: {
        roder: {
          id: "roder",
          name: "Roder",
          description: "Native Roder runtime with all your configured model providers.",
          state: "connected",
          runtimeInstalled: true,
          runtimePath: null,
          connected: true,
          modelCount: models.length,
          models: [],
          error: null,
        },
        codex: {
          id: "codex",
          name: "Codex",
          description: "OpenAI Codex agent backend via the Codex CLI app-server.",
          state: "disconnected",
          runtimeInstalled: false,
          runtimePath: null,
          connected: false,
          modelCount: 0,
          models: [],
          error: null,
        },
        "claude-code": { ...claudeBackendStatus, models: [] },
        antigravity: {
          id: "antigravity",
          name: "Antigravity",
          description: "Google Antigravity agent backend via the official agy CLI.",
          state: "disconnected",
          runtimeInstalled: false,
          runtimePath: null,
          connected: false,
          modelCount: 0,
          models: [],
          error: null,
        },
      },
    }),
    agentBackendsConnect: async () => ({
      activeBackend: "roder",
      backends: {
        roder: {
          id: "roder",
          name: "Roder",
          description: "Native Roder runtime with all your configured model providers.",
          state: "connected",
          runtimeInstalled: true,
          runtimePath: null,
          connected: true,
          modelCount: models.length,
          models: [],
          error: null,
        },
        codex: {
          id: "codex",
          name: "Codex",
          description: "OpenAI Codex agent backend via the Codex CLI app-server.",
          state: "disconnected",
          runtimeInstalled: false,
          runtimePath: null,
          connected: false,
          modelCount: 0,
          models: [],
          error: null,
        },
        "claude-code": { ...claudeBackendStatus, models: [] },
        antigravity: {
          id: "antigravity",
          name: "Antigravity",
          description: "Google Antigravity agent backend via the official agy CLI.",
          state: "disconnected",
          runtimeInstalled: false,
          runtimePath: null,
          connected: false,
          modelCount: 0,
          models: [],
          error: null,
        },
      },
    }),
    agentBackendsLogout: async () => ({
      activeBackend: "roder",
      backends: {
        roder: {
          id: "roder",
          name: "Roder",
          description: "Native Roder runtime with all your configured model providers.",
          state: "connected",
          runtimeInstalled: true,
          runtimePath: null,
          connected: true,
          modelCount: models.length,
          models: [],
          error: null,
        },
        codex: {
          id: "codex",
          name: "Codex",
          description: "OpenAI Codex agent backend via the Codex CLI app-server.",
          state: "disconnected",
          runtimeInstalled: false,
          runtimePath: null,
          connected: false,
          modelCount: 0,
          models: [],
          error: null,
        },
        "claude-code": { ...claudeBackendStatus, models: [] },
        antigravity: {
          id: "antigravity",
          name: "Antigravity",
          description: "Google Antigravity agent backend via the official agy CLI.",
          state: "disconnected",
          runtimeInstalled: false,
          runtimePath: null,
          connected: false,
          modelCount: 0,
          models: [],
          error: null,
        },
      },
    }),
    agentBackendsSetupState: async () => ({
      backend: null,
      phase: "idle",
      message: "",
      authUrl: null,
      error: null,
    }),
    agentBackendsStartSetup: async (backend) => ({
      backend,
      phase: "idle",
      message: "",
      authUrl: null,
      error: null,
    }),
    agentBackendsSubmitSetupCode: async () => ({
      backend: null,
      phase: "idle",
      message: "",
      authUrl: null,
      error: null,
    }),
    agentBackendsCancelSetup: async () => ({
      backend: null,
      phase: "idle",
      message: "",
      authUrl: null,
      error: null,
    }),
    antigravityStatus: async () => ({
      state: "disconnected",
      runtimeInstalled: false,
      runtimePath: null,
      connected: false,
      modelCount: 0,
      error: null,
    }),
    antigravityConnect: async () => ({
      state: "disconnected",
      runtimeInstalled: false,
      runtimePath: null,
      connected: false,
      modelCount: 0,
      error: null,
    }),
    antigravityLogout: async () => ({
      state: "disconnected",
      runtimeInstalled: false,
      runtimePath: null,
      connected: false,
      modelCount: 0,
      error: null,
    }),
  } satisfies Partial<Window["roderDesktop"]>;

  Object.defineProperty(window, "roderDesktop", { configurable: true, value: fixtures });
}

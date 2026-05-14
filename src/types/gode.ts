export type GodeStatus = {
  state: "starting" | "ready" | "stopped" | "error";
  binary: string;
  cwd?: string;
  message?: string;
};

export type GodeNotification = {
  method: string;
  params: unknown;
};

export type GodeThread = {
  id: string;
  sessionId: string;
  preview: string;
  modelProvider: string;
  createdAt: number;
  updatedAt: number;
  status: {
    type: string;
    activeFlags?: string[];
  };
  cwd: string;
  name?: string | null;
  turns?: GodeTurn[];
};

export type GodeTurn = {
  id: string;
  items: GodeItem[];
  itemsView: string;
  status: string;
  error?: {
    message: string;
  } | null;
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
};

export type GodeItem = {
  id: string;
  type: "userMessage" | "agentMessage" | "toolMessage" | "toolCall" | "reasoning" | "compaction" | "error" | string;
  text?: string;
  payload?: unknown;
  toolName?: string;
  toolCallId?: string;
};

export type GodeModel = {
  id: string;
  name: string;
  description?: string;
  modelProvider: string;
  defaultReasoningEffort?: string;
  reasoningEfforts?: string[];
  isDefault?: boolean;
};

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export type ConversationMessage = {
  id: string;
  threadId?: string;
  turnId?: string;
  role: "user" | "assistant" | "system";
  text: string;
  status?: "streaming" | "complete" | "failed";
};

export type NavigationEntry = {
  threadId: string;
  at: number;
};

export type SystemAppearance = "dark" | "light";

export type WorkspaceFolder = {
  path: string;
  name: string;
  lastUsedAt: number;
};

export type TerminalSnapshot = {
  id: string;
  pid: number;
};

export type BrowserBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserSnapshot = {
  visible: boolean;
  url: string;
  cdpUrl: string;
  canGoBack: boolean;
  canGoForward: boolean;
  annotating: boolean;
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

export type DesktopAttachment = {
  id: string;
  name: string;
  path: string;
  type: string;
  size: number;
};

export type ResolvedDesktopFile = Omit<DesktopAttachment, "id">;

export type TurnInputItem = {
  type: "text" | "local_file";
  text?: string;
  path?: string;
};

declare global {
  interface Window {
    godeDesktop: {
      request: (method: string, params?: unknown) => Promise<unknown>;
      start: () => Promise<GodeStatus>;
      restart: () => Promise<GodeStatus>;
      status: () => Promise<GodeStatus>;
      appearance: () => Promise<SystemAppearance>;
      openWorkspaceFolder: (defaultPath?: string) => Promise<string | null>;
      terminalStart: (options?: { cols?: number; rows?: number }) => Promise<TerminalSnapshot>;
      terminalWrite: (data: string) => Promise<void>;
      terminalResize: (cols: number, rows: number) => Promise<void>;
      terminalStop: () => Promise<void>;
      browserToggle: (bounds?: BrowserBounds) => Promise<BrowserSnapshot>;
      browserShow: (bounds: BrowserBounds) => Promise<BrowserSnapshot>;
      browserHide: () => Promise<BrowserSnapshot>;
      browserNavigate: (url: string) => Promise<BrowserSnapshot>;
      browserBack: () => Promise<BrowserSnapshot>;
      browserForward: () => Promise<BrowserSnapshot>;
      browserRefresh: () => Promise<BrowserSnapshot>;
      browserCaptureScreenshot: () => Promise<ResolvedDesktopFile>;
      browserToggleAnnotation: () => Promise<BrowserSnapshot>;
      browserSetBounds: (bounds: BrowserBounds) => Promise<BrowserSnapshot>;
      browserSnapshot: () => Promise<BrowserSnapshot>;
      codexAccount: () => Promise<CodexAccountSnapshot>;
      codexLogin: () => Promise<CodexAccountSnapshot>;
      codexLogout: () => Promise<CodexAccountSnapshot>;
      codexOpenRateLimitHelp: () => Promise<void>;
      resolveDroppedFiles: (files: File[]) => ResolvedDesktopFile[];
      onNotification: (callback: (notification: GodeNotification) => void) => () => void;
      onStatus: (callback: (status: GodeStatus) => void) => () => void;
      onStderr: (callback: (message: string) => void) => () => void;
      onAppearance: (callback: (appearance: SystemAppearance) => void) => () => void;
      onTerminalData: (callback: (payload: { id: string; data: string }) => void) => () => void;
      onTerminalExit: (callback: (payload: { id: string; exitCode: number; signal?: number }) => void) => () => void;
    };
  }
}

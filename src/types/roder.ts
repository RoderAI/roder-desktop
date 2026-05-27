import type { ExtensionCatalogSnapshot, ExtensionTheme } from "@/types/extensions";

export type RoderStatus = {
  state: "starting" | "ready" | "stopped" | "error";
  binary: string;
  cwd?: string;
  message?: string;
};

export type RoderNotification = {
  method: string;
  params: unknown;
};

export type RoderActiveFlag = "approvalRequired" | "userInputRequired" | "planExitRequired" | string;

export type RoderQuestionOption = {
  label: string;
  description?: string;
};

export type RoderUserInputQuestion = {
  id: string;
  question: string;
  options?: RoderQuestionOption[];
};

export type ApprovalRequestedNotification = {
  threadId: string;
  turnId?: string;
  approvalId: string;
  toolId?: string;
  toolName?: string;
  reason?: string;
};

export type ApprovalResolvedNotification = {
  threadId: string;
  turnId?: string;
  approvalId: string;
  toolId?: string;
  toolName?: string;
  approved: boolean;
};

export type UserInputRequestedNotification = {
  threadId: string;
  turnId?: string;
  requestId: string;
  questions: RoderUserInputQuestion[];
};

export type UserInputResolvedNotification = {
  threadId: string;
  turnId?: string;
  requestId: string;
  answers: Record<string, string>;
};

export type PlanExitRequestedNotification = {
  threadId: string;
  turnId?: string;
  requestId: string;
  targetMode?: string;
  planSummary?: string;
};

export type PlanExitResolvedNotification = {
  threadId: string;
  turnId?: string;
  requestId: string;
  approved: boolean;
  targetMode?: string;
  resolvedMode?: string;
};

export type ApprovalWaitRequest = {
  kind: "approval";
  id: string;
  approvalId: string;
  threadId: string;
  turnId?: string;
  toolId?: string;
  toolName: string;
  reason?: string;
  resolving?: boolean;
  error?: string;
};

export type UserInputWaitRequest = {
  kind: "userInput";
  id: string;
  requestId: string;
  threadId: string;
  turnId?: string;
  questions: RoderUserInputQuestion[];
  resolving?: boolean;
  error?: string;
};

export type PlanExitWaitRequest = {
  kind: "planExit";
  id: string;
  requestId: string;
  threadId: string;
  turnId?: string;
  targetMode?: string;
  planSummary?: string;
  resolving?: boolean;
  error?: string;
};

export type AgentWaitRequest = ApprovalWaitRequest | UserInputWaitRequest | PlanExitWaitRequest;

export type PendingWaitRequestsByThread = Record<string, AgentWaitRequest[]>;

export type AppServerEvent = {
  id: number;
  at: string;
  kind: "request" | "response" | "error" | "notification" | "status" | "stderr";
  method?: string;
  payload: unknown;
};

export type RoderThread = {
  id: string;
  preview: string;
  modelProvider: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  status: {
    type: string;
    activeTurnId: string | null;
    activeFlags: RoderActiveFlag[];
  };
  cwd: string;
  name?: string | null;
  turns?: RoderTurn[];
};

export type RoderTurn = {
  id: string;
  items: RoderItem[];
  itemsView: string;
  status: string;
  error?: {
    message: string;
  } | null;
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
};

export type RoderItem = {
  id: string;
  type: "userMessage" | "agentMessage" | "toolMessage" | "toolCall" | "reasoning" | "compaction" | "error" | string;
  text?: string;
  status?: string;
  phase?: string;
  payload?: unknown;
  raw?: unknown;
  toolName?: string;
  toolCallId?: string;
  sourceKind?: string;
};

export type RoderModel = {
  id: string;
  name: string;
  description?: string;
  modelProvider: string;
  defaultReasoningEffort?: string;
  reasoningEfforts?: string[];
  isDefault?: boolean;
};

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export type PolicyMode = "default" | "accept_all" | "plan" | "bypass";

export type ConversationMessage = {
  id: string;
  threadId?: string;
  turnId?: string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  status?: "streaming" | "complete" | "failed";
  phase?: string;
  toolName?: string;
  toolCallId?: string;
  toolStatus?: "running" | "complete" | "failed";
  toolInput?: string;
  toolOutput?: string;
  toolSubject?: string;
  toolSummary?: string;
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

export type SpeechProviderDescriptor = {
  id: string;
  name: string;
  description?: string;
  authType: string;
  authLabel?: string;
  authenticated: boolean;
  authDetail?: string;
  recommended: boolean;
  sortOrder: number;
  capabilities: {
    batch?: boolean;
    streaming?: boolean;
    diarization?: boolean;
    timestamps?: boolean;
    languageHints?: boolean;
    prompt?: boolean;
  };
  models: Array<{
    id: string;
    name: string;
    description?: string;
  }>;
};

export type SpeechTranscribeResult = {
  provider: string;
  model: string;
  text: string;
  language?: string;
  durationMillis?: number;
  segments: Array<{
    text: string;
    startMillis?: number;
    endMillis?: number;
    speaker?: string;
    confidence?: number;
  }>;
  providerResponseId?: string;
  metadata?: unknown;
};

export type AppCommand = {
  command: "newProject" | "newThread";
};

declare global {
  interface Window {
    roderDesktop: {
      request: (method: string, params?: unknown) => Promise<unknown>;
      start: () => Promise<RoderStatus>;
      restart: () => Promise<RoderStatus>;
      status: () => Promise<RoderStatus>;
      appearance: () => Promise<SystemAppearance>;
      openExternal: (url: string) => Promise<void>;
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
      canvasSavePng: (dataUrl: string) => Promise<ResolvedDesktopFile>;
      codexAccount: () => Promise<CodexAccountSnapshot>;
      codexLogin: () => Promise<CodexAccountSnapshot>;
      codexLogout: () => Promise<CodexAccountSnapshot>;
      codexOpenRateLimitHelp: () => Promise<void>;
      extensionsList: () => Promise<ExtensionCatalogSnapshot>;
      extensionsInstallFromFolder: (folderPath: string) => Promise<ExtensionCatalogSnapshot>;
      extensionsInstallFromArchive: (archivePath: string) => Promise<ExtensionCatalogSnapshot>;
      extensionsSelectAndInstallFolder: () => Promise<ExtensionCatalogSnapshot>;
      extensionsSelectAndInstallArchive: () => Promise<ExtensionCatalogSnapshot>;
      extensionsUninstall: (id: string) => Promise<ExtensionCatalogSnapshot>;
      extensionsEnable: (id: string) => Promise<ExtensionCatalogSnapshot>;
      extensionsDisable: (id: string) => Promise<ExtensionCatalogSnapshot>;
      extensionsReload: (id: string) => Promise<ExtensionCatalogSnapshot>;
      extensionsUpdatePreference: (id: string, key: string, value: string | boolean | null) => Promise<ExtensionCatalogSnapshot>;
      extensionsReadLogs: (id: string) => Promise<string[]>;
      extensionsActivate: (id: string) => Promise<ExtensionCatalogSnapshot>;
      extensionsExecuteCommand: (commandId: string, args?: unknown[]) => Promise<unknown>;
      extensionsExecuteTool: (toolId: string, input?: Record<string, unknown>) => Promise<unknown>;
      extensionsReadPanel: (extensionId: string, panelId: string) => Promise<string>;
      extensionsReadTheme: (extensionId: string, themeId: string) => Promise<ExtensionTheme>;
      appServerEvents: () => Promise<AppServerEvent[]>;
      resolveDroppedFiles: (files: File[]) => ResolvedDesktopFile[];
      onNotification: (callback: (notification: RoderNotification) => void) => () => void;
      onStatus: (callback: (status: RoderStatus) => void) => () => void;
      onStderr: (callback: (message: string) => void) => () => void;
      onAppearance: (callback: (appearance: SystemAppearance) => void) => () => void;
      onAppServerEvent: (callback: (event: AppServerEvent) => void) => () => void;
      onAppCommand: (callback: (command: AppCommand) => void) => () => void;
      onTerminalData: (callback: (payload: { id: string; data: string }) => void) => () => void;
      onTerminalExit: (callback: (payload: { id: string; exitCode: number; signal?: number }) => void) => () => void;
    };
  }
}

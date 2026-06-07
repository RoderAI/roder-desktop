import type { ExtensionCatalogSnapshot, ExtensionTheme } from "@/types/extensions";

export type RoderStatus = {
  state: "starting" | "ready" | "stopped" | "error";
  binary: string;
  appServerMethods?: string[];
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
  workspaceId?: string | null;
  rootId?: string | null;
  cwd: string;
  name?: string | null;
  messageCount?: number | null;
  turns?: RoderTurn[];
};

export type RoderThreadGoalStatus = "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete";

export type RoderThreadGoal = {
  threadId: string;
  objective: string;
  status: RoderThreadGoalStatus;
  tokenBudget?: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: string;
  updatedAt: string;
};

export type CommandDescriptor = {
  name: string;
  description: string | null;
  argument_hint: string | null;
  source: string;
  model: string | null;
  agent: string | null;
  has_shell_includes: boolean;
  has_url_includes: boolean;
};

export type CommandsListResult = {
  commands: CommandDescriptor[];
};

export type CommandContextBlockKind =
  | "Instruction"
  | "RepositoryFact"
  | "Memory"
  | "RetrievedDocument"
  | "Environment"
  | "ToolAvailability"
  | "SafetyPolicy"
  | "TaskMetadata"
  | "PriorSummary"
  | "EntrypointHint"
  | "RetrievalHint"
  | { Other: string };

export type CommandContextBlock = {
  id: string;
  kind: CommandContextBlockKind;
  text: string;
  priority: number;
  token_estimate: number | null;
  metadata: unknown;
};

export type CommandsExpandedResult = {
  command: CommandDescriptor;
  message: string;
  context_blocks: CommandContextBlock[];
  allowed_tools: string[];
  model: string | null;
  agent: string | null;
};

export type CommandsRunResult = {
  turn_id: string;
  expanded: CommandsExpandedResult;
};

export type AgentDescriptor = {
  agent_type: string;
  description: string;
  tools: string[];
  model: string | null;
  permission_mode: string;
  max_turns: number | null;
  max_result_chars: number | null;
};

export type AgentsListResult = {
  agents: AgentDescriptor[];
};

export type TaskSpec = {
  kind: string;
  description: string;
  input_schema: unknown;
  default_timeout_seconds?: number | null;
  metadata: unknown;
};

export type TaskState = "queued" | "running" | "completed" | "failed" | "cancelled";

export type TaskHandle = {
  task_id: string;
  executor_id: string;
  spec: TaskSpec;
  state: TaskState;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type TasksListResult = {
  tasks: TaskHandle[];
};

export type TaskLogDescriptor = {
  stream: "stdout" | "stderr" | "log";
  chunk: string;
  timestamp: string;
};

export type TasksGetResult = {
  task: TaskHandle;
  logs: TaskLogDescriptor[];
  dropped_bytes: number;
};

export type ProcessState =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | { exited: { exitCode?: number | null } }
  | { failed: { error: string } };

export type ProcessDescriptor = {
  processId: string;
  origin: "command_exec" | "background_task" | "shell_tool" | "remote_runner";
  state: ProcessState;
  command: string[];
  commandSummary: string;
  cwd?: string | null;
  pid?: number | null;
  taskId?: string | null;
  threadId?: string | null;
  turnId?: string | null;
  runnerDestinationId?: string | null;
  runnerSessionId?: string | null;
  stoppable: boolean;
  startedAt: string;
  updatedAt: string;
  stdoutTail?: string | null;
  stderrTail?: string | null;
};

export type ProcessesListResult = {
  processes: ProcessDescriptor[];
};

export type ProcessesStopResult = {
  result: {
    processId: string;
    stopped: boolean;
    process?: ProcessDescriptor | null;
    error?: string | null;
  };
};

export type ProcessesStopAllResult = {
  results: ProcessesStopResult["result"][];
};

export type RoderTurn = {
  id: string;
  items: RoderItem[];
  itemsView: string;
  status: "inProgress" | "completed" | "failed";
  error?: {
    message: string;
  } | null;
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
};

export type RoderItemStatus = "inProgress" | "completed" | "failed";

export type RoderUserMessageItem = {
  id: string;
  type: "userMessage";
  text: string;
  images?: { imageUrl?: string; image_url?: string }[];
  status?: RoderItemStatus;
};

export type RoderAgentMessageItem = {
  id: string;
  type: "agentMessage";
  text: string;
  phase?: string;
  status?: RoderItemStatus;
};

export type RoderReasoningItem = {
  id: string;
  type: "reasoning";
  summary?: string[];
  content?: string[];
  status?: RoderItemStatus;
};

export type RoderToolExecutionItem = {
  id: string;
  type: "toolExecution";
  toolCallId: string;
  toolName: string;
  status: RoderItemStatus;
  input?: unknown;
  output?: string;
  error?: string;
};

export type RoderCompactionItem = {
  id: string;
  type: "compaction";
  summary: string;
  status?: RoderItemStatus;
};

export type RoderErrorItem = {
  id: string;
  type: "error";
  message: string;
  status?: RoderItemStatus;
};

export type RoderRawItem = {
  id: string;
  type: "raw";
  payload: unknown;
  status?: RoderItemStatus;
};

export type RoderItem =
  | RoderUserMessageItem
  | RoderAgentMessageItem
  | RoderReasoningItem
  | RoderToolExecutionItem
  | RoderCompactionItem
  | RoderErrorItem
  | RoderRawItem;

export type RoderThreadItemDelta =
  | { type: "agentMessageText"; delta: string; phase?: string }
  | { type: "reasoningText"; delta: string; contentIndex: number }
  | { type: "reasoningSummaryPartAdded"; summaryIndex: number }
  | { type: "reasoningSummaryText"; delta: string; summaryIndex: number };

export type RoderThreadItemEventKind =
  | { type: "itemStarted"; item: RoderItem }
  | { type: "itemDelta"; itemId: string; delta: RoderThreadItemDelta }
  | { type: "itemCompleted"; item: RoderItem };

export type RoderThreadItemEvent = {
  seq: number;
  eventId: string;
  threadId: string;
  turnId: string;
  timestamp: string;
  event: RoderThreadItemEventKind;
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

export type SkillSource =
  | "builtIn"
  | "workspace"
  | "user"
  | "system"
  | { plugin: { pluginId: string } }
  | { pluginId: string }
  | { imported: { importId: string } }
  | { importId: string };

export type SkillExposure = "global" | "direct_only";

export type SkillActivationState = "enabled" | "disabled" | "experimental";

export type SkillSelector = { path: string } | { name: string };

export type SkillAgentMetadata = {
  interface?: string;
  dependencies?: string[];
  policies?: string[];
  raw?: unknown;
};

export type SkillDescriptor = {
  id: string;
  name: string;
  canonicalPath: string;
  source: SkillSource;
  exposure: SkillExposure;
  activation: SkillActivationState;
  description: string;
  shortDescription?: string | null;
  experimental: boolean;
  diagnostics: string[];
  agentMetadata?: SkillAgentMetadata | null;
};

export type SkillsListResult = {
  skills: SkillDescriptor[];
  diagnostics: string[];
};

export type SkillsUpdateResult = SkillsListResult;

export type ConversationMessage = {
  id: string;
  threadId?: string;
  turnId?: string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  images?: { imageUrl: string }[];
  status?: "streaming" | "complete" | "failed";
  phase?: string;
  toolName?: string;
  toolCallId?: string;
  toolStatus?: "running" | "complete" | "failed";
  toolInput?: string;
  toolOutput?: string;
  toolPreview?: string;
  toolPreviewKind?: "text" | "patch";
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

export type WorkspaceRoot = {
  id: string;
  path: string;
  name: string;
};

export type Workspace = {
  id: string;
  name: string;
  roots: WorkspaceRoot[];
  defaultRootId: string;
  updatedAt: number;
};

export type FileSystemDirectoryEntry = {
  fileName: string;
  isDirectory: boolean;
  isFile: boolean;
};

export type FileSystemReadDirectoryResult = {
  entries: FileSystemDirectoryEntry[];
};

export type FileSystemReadFileResult = {
  dataBase64: string;
};

export type WorkspaceFileIndexState = "missing" | "building" | "ready" | "stale" | "failed";

export type WorkspaceFilesStatusRoot = {
  rootId?: string;
  id?: string;
  name?: string;
  path?: string;
  state?: WorkspaceFileIndexState;
  stale?: boolean;
  fileCount?: number;
  directoryCount?: number;
  message?: string | null;
};

export type WorkspaceFilesStatus = {
  workspaceId: string;
  state: WorkspaceFileIndexState;
  stale: boolean;
  roots: WorkspaceFilesStatusRoot[];
  fileCount: number;
  directoryCount: number;
  message?: string | null;
};

export type WorkspaceFileEntry = {
  rootId: string;
  rootName: string;
  path: string;
  name: string;
  kind: "file" | "directory";
  hasChildren: boolean;
  size?: number | null;
  modifiedMs?: number | null;
};

export type WorkspaceFilesStatusResult = {
  status: WorkspaceFilesStatus;
};

export type WorkspaceFilesRebuildResult = {
  status?: WorkspaceFilesStatus;
};

export type WorkspaceFilesChildrenResult = {
  status: WorkspaceFilesStatus;
  entries: WorkspaceFileEntry[];
};

export type WorkspaceFilesQueryMatch = {
  entry: WorkspaceFileEntry;
  score: number;
  matchPositions: number[];
};

export type WorkspaceFilesQueryResult = {
  status: WorkspaceFilesStatus;
  matches: WorkspaceFilesQueryMatch[];
  indexedFileCount: number;
};

export type WorkspaceFilesReadResult = {
  entry: WorkspaceFileEntry;
  encoding: "utf8" | "binary" | "unsupported";
  text?: string;
  offset: number;
  limit: number;
  totalBytes: number;
  hasMore: boolean;
  truncated: boolean;
};

export type TerminalSnapshot = {
  id: string;
  pid: number;
};

export type ChromeBridgeStatus = {
  state: "stopped" | "starting" | "running" | "error";
  url: string | null;
  token: string | null;
  tokenPreview: string | null;
  pairingUrl: string | null;
  pid: number | null;
  clientCount: number;
  lastEvent?: string;
  message?: string;
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
  imageUrl?: string;
  source?: "browser" | "canvas" | "clipboard" | "file";
};

export type ResolvedDesktopFile = Omit<DesktopAttachment, "id">;

export type TurnInputItem = {
  type: "image" | "local_file" | "text";
  imageUrl?: string;
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

export type HunkDiffLineKind = "context" | "added" | "removed";

export type HunkDiffLine = {
  kind: HunkDiffLineKind;
  text: string;
  oldLine?: number | null;
  newLine?: number | null;
};

export type HunkRollbackState =
  | "available"
  | "applied"
  | { unavailable: { reason: string } }
  | { conflict: { reason: string } };

export type HunkRecord = {
  id: string;
  threadId: string;
  turnId: string;
  path: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  diff: HunkDiffLine[];
  toolCallId: string;
  toolName: string;
  planReviewId?: string | null;
  planStepId?: string | null;
  timelineEventId?: string | null;
  checkpointId?: string | null;
  rollback: HunkRollbackState;
  reversePatch?: string | null;
  createdAt: string;
};

export type PagedHunkDiff = {
  hunk: HunkRecord;
  offset: number;
  limit: number;
  totalLines: number;
  lines: HunkDiffLine[];
  nextOffset?: number | null;
};

export type HunkListResult = {
  hunks: HunkRecord[];
};

export type HunkReadResult = {
  page: PagedHunkDiff | null;
};

export type VcsChangeStatus = "modified" | "added" | "deleted" | "renamed" | "untracked" | "provider_native";

export type VcsChangeArea = "committed" | "staged" | "unstaged" | "untracked";

export type WorkspaceChangeSource = "gitReconciled";

export type WorkspaceChangeConfidence = "observedAfterTool";

export type WorkspaceObservedFile = {
  path: string;
  oldPath?: string | null;
  status: VcsChangeStatus;
  additions: number;
  deletions: number;
  binary: boolean;
};

export type WorkspaceChangeObservation = {
  id: string;
  threadId: string;
  turnId: string;
  toolCallId: string;
  toolName: string;
  source: WorkspaceChangeSource;
  confidence: WorkspaceChangeConfidence;
  files: WorkspaceObservedFile[];
  createdAt: string;
};

export type WorkspaceChangesListResult = {
  changes: WorkspaceChangeObservation[];
};

export type VcsChangedFile = {
  path: string;
  oldPath?: string | null;
  status: VcsChangeStatus;
  areas?: VcsChangeArea[];
  additions: number;
  deletions: number;
  binary: boolean;
};

export type VcsChangesListResult = {
  status: {
    provider: {
      id: string;
      displayName: string;
    };
    workspace: {
      root: string;
      id?: string | null;
    };
    activeLine?: {
      id: string;
      name: string;
      kind: string;
    } | null;
    base?: {
      refName?: string | null;
      sha?: string | null;
    } | null;
    changedFileCount: number;
  };
  files: VcsChangedFile[];
  totals: {
    files: number;
    additions: number;
    deletions: number;
  };
  truncated?: boolean;
};

export type VcsChangesReadResult = {
  path: string;
  content?: string | null;
  offset: number;
  totalLines: number;
  nextOffset?: number | null;
  binary: boolean;
};

export type RoderDesignNode = {
  id: string;
  type: string;
  name: string;
  parentId?: string | null;
  childIds?: string[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number | null;
  opacity?: number | null;
  visible?: boolean | null;
  locked?: boolean | null;
  fill?: unknown;
  stroke?: unknown;
  [key: string]: unknown;
};

export type RoderDesignDocument = {
  version: string;
  documentId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  nodes: Record<string, RoderDesignNode>;
  rootIds: string[];
  variables: Record<string, unknown>;
  assets: Record<string, unknown>;
  metadata: {
    workspaceId?: string | null;
    rootId?: string | null;
    workspaceRoot?: string | null;
    selectedNodeIds?: string[];
  };
};

export type DesignDocumentResult = {
  path: string;
  document: RoderDesignDocument;
};

export type DesignPatchOperation =
  | { op: "insert_node"; parentId?: string | null; index?: number; node: RoderDesignNode }
  | { op: "update_node"; nodeId: string; patch: Partial<RoderDesignNode> }
  | { op: "delete_node"; nodeId: string; recursive?: boolean }
  | { op: "reorder_node"; nodeId: string; index: number }
  | { op: "set_variables"; variables: Record<string, unknown>; replace?: boolean };

export type DesignPatchResult = DesignDocumentResult & {
  applied: number;
};

export type DesignLayoutNode = {
  id: string;
  type: string;
  name: string;
  parentId?: string | null;
  childIds: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  problems: string[];
};

export type DesignSnapshotLayoutResult = {
  path: string;
  nodes: DesignLayoutNode[];
};

export type DesignVariablesResult = {
  path: string;
  variables: Record<string, unknown>;
};

export type DesignNodeAlias = {
  alias: string;
  nodeId: string;
  name: string;
  type: string;
};

export type DesignEditorStateResult = DesignDocumentResult & {
  selectedNodeIds?: string[];
  nodeAliases?: DesignNodeAlias[];
  schema?: unknown;
  rules?: string | null;
};

export type DesignBatchGetResult = {
  path: string;
  nodes: RoderDesignNode[];
  nodeAliases?: DesignNodeAlias[];
};

export type DesignGuidelinesResult = {
  categories: Array<{ name: string; description: string; guidelines: string[] }>;
};

export type DesignExportNodesResult = {
  exported: Array<{ nodeId: string; path: string }>;
};

export type DesignScreenshotResult = {
  path: string;
  nodeId?: string | null;
  mimeType: string;
  dataUrl: string;
};

export type DesignSpawnAgentsResult = {
  path: string;
  planned: Array<{
    alias: string;
    scopeNodeId: string;
    scopeName: string;
    type: string;
    childCount: number;
    prompt: string;
  }>;
  allowPatch: boolean;
  allowExport: boolean;
  requireReview: boolean;
  instructions: string;
};

export type AppCommand = {
  command: "newProject" | "newThread" | "openSettings" | "openBrowser";
};

declare global {
  interface Window {
    roderDesktop: {
      platform: NodeJS.Platform;
      request: (method: string, params?: unknown) => Promise<unknown>;
      setMinWindowWidth: (width: number) => Promise<void>;
      start: () => Promise<RoderStatus>;
      restart: () => Promise<RoderStatus>;
      status: () => Promise<RoderStatus>;
      appearance: () => Promise<SystemAppearance>;
      openExternal: (url: string) => Promise<void>;
      openWorkspaceFolder: (defaultPath?: string) => Promise<string | null>;
      openWorkspaceFolders: (defaultPath?: string) => Promise<string[] | null>;
      terminalStart: (options?: { cols?: number; rows?: number; cwd?: string }) => Promise<TerminalSnapshot>;
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
      chromeBridgeStatus: () => Promise<ChromeBridgeStatus>;
      chromeBridgeStart: () => Promise<ChromeBridgeStatus>;
      chromeBridgeStop: () => Promise<ChromeBridgeStatus>;
      chromeBridgeRestart: () => Promise<ChromeBridgeStatus>;
      chromeBridgeOpenExtensionOptions: () => Promise<void>;
      canvasSavePng: (dataUrl: string) => Promise<ResolvedDesktopFile>;
      clipboardSaveImage: (dataUrl: string) => Promise<ResolvedDesktopFile>;
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
      extensionsUpdatePreference: (
        id: string,
        key: string,
        value: string | boolean | null,
      ) => Promise<ExtensionCatalogSnapshot>;
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
      onChromeBridgeStatus: (callback: (status: ChromeBridgeStatus) => void) => () => void;
      onTerminalExit: (callback: (payload: { id: string; exitCode: number; signal?: number }) => void) => () => void;
    };
  }
}

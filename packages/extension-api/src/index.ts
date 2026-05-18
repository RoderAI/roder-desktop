export type Disposable = {
  dispose: () => void | Promise<void>;
};

export type RoderExtensionActivationEvent =
  | "onStartupFinished"
  | "onWorkspace"
  | `onCommand:${string}`
  | `onTool:${string}`
  | `onView:${string}`;

export type RoderExtensionCapability =
  | "fs.read.workspace"
  | "fs.write.workspace"
  | "process.spawn.shell"
  | "network.web"
  | "secret.read"
  | "desktop.notification"
  | "appserver.request"
  | "ui.panel";

export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

export type JsonSchema = {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: JsonValue[];
  default?: JsonValue;
  additionalProperties?: boolean | JsonSchema;
  [key: string]: unknown;
};

export type RoderCommandHandler<TArgs extends readonly unknown[] = readonly unknown[], TResult = unknown> = (
  ...args: TArgs
) => TResult | Promise<TResult>;

export type RoderToolHandler<TInput extends JsonObject = JsonObject, TResult extends JsonValue = JsonValue> = (
  input: TInput,
  context: RoderToolInvocationContext,
) => TResult | Promise<TResult>;

export type RoderToolInvocationContext = {
  toolCallId: string;
  extensionId: string;
  signal: AbortSignal;
};

export type RoderCommandRegistration = {
  id: string;
  title: string;
  category?: string;
  icon?: string;
};

export type RoderPanelRegistration = {
  id: string;
  title: string;
  html: string;
  icon?: string;
};

export type RoderToolRegistration<TInput extends JsonObject = JsonObject, TResult extends JsonValue = JsonValue> = {
  id: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  handler: RoderToolHandler<TInput, TResult>;
};

export type RoderPreferenceType = "text" | "password" | "checkbox" | "dropdown" | "file" | "directory";

export type RoderPreferenceValue = string | boolean | null;

export type RoderExtensionStorage = {
  get<T extends JsonValue = JsonValue>(key: string, defaultValue?: T): Promise<T | undefined>;
  update(key: string, value: JsonValue | undefined): Promise<void>;
};

export type RoderSecretStorage = {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

export type RoderCommands = {
  registerCommand<TResult = unknown>(command: RoderCommandRegistration, handler: RoderCommandHandler<readonly unknown[], TResult>): Disposable;
  executeCommand<TResult = unknown>(id: string, ...args: unknown[]): Promise<TResult>;
};

export type RoderTools = {
  registerTool<TInput extends JsonObject = JsonObject, TResult extends JsonValue = JsonValue>(registration: RoderToolRegistration<TInput, TResult>): Disposable;
};

export type RoderNotifications = {
  showInformationMessage(message: string): Promise<void>;
  showWarningMessage(message: string): Promise<void>;
  showErrorMessage(message: string): Promise<void>;
};

export type RoderEnvironment = {
  appName: string;
  appVersion: string;
  extensionId: string;
  extensionPath: string;
  globalStoragePath: string;
  workspaceStoragePath?: string;
};

export type RoderWorkspaceContext = {
  folders: Array<{ path: string; name: string }>;
  activeFolder?: { path: string; name: string };
};

export type RoderThreadContext = {
  activeThreadId?: string;
};

export type RoderExtensionContext = {
  extensionId: string;
  extensionPath: string;
  subscriptions: Disposable[];
  globalStoragePath: string;
  workspaceStoragePath?: string;
  globalState: RoderExtensionStorage;
  workspaceState: RoderExtensionStorage;
  secrets: RoderSecretStorage;
  commands: RoderCommands;
  tools: RoderTools;
  notifications: RoderNotifications;
  env: RoderEnvironment;
  workspace: RoderWorkspaceContext;
  thread: RoderThreadContext;
  preferences: Record<string, RoderPreferenceValue>;
};

export type RoderExtensionModule = {
  activate: (context: RoderExtensionContext) => unknown | Promise<unknown>;
  deactivate?: () => unknown | Promise<unknown>;
};

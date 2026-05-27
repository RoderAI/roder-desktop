import type { DesktopAttachment, PolicyMode, RoderModel, RoderStatus, RoderThread, SystemAppearance, TurnInputItem } from "@/types/roder";

export type ThreadListResult = {
  data: RoderThread[];
  nextCursor: string | null;
  backwardsCursor: string | null;
};

export type ThreadReadResult = {
  thread: RoderThread | null;
};

export type ThreadStartResult = {
  thread: RoderThread;
  model: string;
  modelProvider: string;
  reasoning: string;
  cwd: string;
};

export type ProviderSelectResult = {
  provider: string;
  model: string;
  reasoning: string;
};

export type ThreadArchiveResult = {
  threadId: string;
  archived: boolean;
};

export type ModelListResult = {
  models: RoderModel[];
};

export type SettingsGetResult = {
  default_provider: string;
  default_model: string;
  default_reasoning: string;
  default_mode: PolicyMode;
};

export type ThreadStateResult = {
  mode: PolicyMode;
  pendingPlanExit: {
    threadId: string;
    turnId: string;
    requestId: string;
    targetMode: PolicyMode;
    planSummary: string | null;
    requestedAt: string;
    expiresAt: string | null;
  } | null;
};

export type ThreadSetModeResult = {
  mode: PolicyMode;
};

export type SettingsSetDefaultModeResult = {
  default_mode: PolicyMode;
};

export type TurnStartResult = {
  turnId: string;
};

export type TurnStartOptions = {
  modelProvider?: string;
  model?: string;
  reasoning?: string;
  policyMode?: PolicyMode;
};

export type TurnSteerResult = {
  turnId: string;
};

export type TurnInterruptResult = {
  turnId: string | null;
};

export const roderIpc = {
  start: () => window.roderDesktop.start(),
  restart: () => window.roderDesktop.restart(),
  status: () => window.roderDesktop.status(),
  appearance: () => window.roderDesktop.appearance(),
  openWorkspaceFolder: (defaultPath?: string) => window.roderDesktop.openWorkspaceFolder(defaultPath),
  listThreads: (limit = 100) => window.roderDesktop.request("thread/list", { limit }) as Promise<ThreadListResult>,
  readThread: (threadId: string) =>
    window.roderDesktop.request("thread/read", { threadId, includeTurns: true }) as Promise<ThreadReadResult>,
  archiveThread: (threadId: string) =>
    window.roderDesktop.request("thread/archive", { threadId }) as Promise<ThreadArchiveResult>,
  startThread: (model: string, cwd: string, modelProvider?: string, reasoning?: string) =>
    window.roderDesktop.request("thread/start", { model, cwd, modelProvider, reasoning, ephemeral: false }) as Promise<ThreadStartResult>,
  selectProviderDefaults: (provider: string, model?: string, reasoning?: string) =>
    window.roderDesktop.request("providers/select", { provider, model, reasoning }) as Promise<ProviderSelectResult>,
  startTurn: (threadId: string, prompt: string, attachments: DesktopAttachment[] = [], options: TurnStartOptions = {}) => {
    const input = turnInput(prompt, attachments);
    if (input.length > 0) {
      return window.roderDesktop.request("turn/start", { threadId, input, ...options }) as Promise<TurnStartResult>;
    }
    return window.roderDesktop.request("turn/start", { threadId, prompt, ...options }) as Promise<TurnStartResult>;
  },
  steerTurn: (threadId: string, expectedTurnId: string, prompt: string, attachments: DesktopAttachment[] = []) => {
    const input = turnInput(prompt, attachments);
    const params = input.length > 0 ? { threadId, expectedTurnId, input } : { threadId, expectedTurnId, prompt };
    return window.roderDesktop.request("turn/steer", params) as Promise<TurnSteerResult>;
  },
  interruptTurn: (threadId: string, turnId?: string) =>
    window.roderDesktop.request("turn/interrupt", { threadId, turnId: turnId || undefined }) as Promise<TurnInterruptResult>,
  threadState: () => window.roderDesktop.request("thread/state", {}) as Promise<ThreadStateResult>,
  resolveApproval: (params: { approvalId: string; approved: boolean }) =>
    window.roderDesktop.request("thread/resolve_approval", { approvalId: params.approvalId, approved: params.approved }),
  resolveUserInput: (params: { requestId: string; answers: Record<string, string> }) =>
    window.roderDesktop.request("thread/resolve_user_input", { requestId: params.requestId, answers: params.answers }),
  exitPlan: (params: { requestId: string; approved: boolean }) =>
    window.roderDesktop.request("thread/exit_plan", { requestId: params.requestId, approved: params.approved }),
  setThreadMode: (mode: PolicyMode, reason: string) =>
    window.roderDesktop.request("thread/set_mode", { mode, reason }) as Promise<ThreadSetModeResult>,
  setDefaultMode: (mode: PolicyMode) =>
    window.roderDesktop.request("settings/set_default_mode", { mode }) as Promise<SettingsSetDefaultModeResult>,
  settings: () => window.roderDesktop.request("settings/get", {}) as Promise<SettingsGetResult>,
  listModels: () => window.roderDesktop.request("model/list", {}) as Promise<ModelListResult>,
  onStatus: (callback: (status: RoderStatus) => void) => window.roderDesktop.onStatus(callback),
  onNotification: window.roderDesktop.onNotification,
  onStderr: window.roderDesktop.onStderr,
  onAppearance: (callback: (appearance: SystemAppearance) => void) => window.roderDesktop.onAppearance(callback),
};

function turnInput(prompt: string, attachments: DesktopAttachment[]): TurnInputItem[] {
  const input: TurnInputItem[] = [];
  const text = prompt.trim();
  if (text) {
    input.push({ type: "text", text });
  }
  for (const attachment of attachments) {
    if (attachment.path) {
      input.push({ type: "local_file", path: attachment.path });
    }
  }
  return input;
}

import type {
  CommandsListResult,
  CommandsRunResult,
  DesktopAttachment,
  AgentsListResult,
  HunkListResult,
  HunkReadResult,
  PolicyMode,
  ProcessesListResult,
  ProcessesStopAllResult,
  ProcessesStopResult,
  RoderModel,
  RoderStatus,
  RoderThread,
  RoderThreadGoal,
  SkillExposure,
  SkillsListResult,
  SkillsUpdateResult,
  SystemAppearance,
  TasksGetResult,
  TasksListResult,
  TurnInputItem,
  VcsChangesListResult,
  VcsChangesReadResult,
  SpeechProviderDescriptor,
  SpeechTranscribeResult,
  Workspace,
  WorkspaceChangesListResult,
  WorkspaceRoot,
} from "@/types/roder";

export type ThreadListResult = {
  data: RoderThread[];
  nextCursor: string | null;
  backwardsCursor: string | null;
};

export type ThreadReadResult = {
  thread: RoderThread | null;
};

export type ThreadStartOptions = {
  initialPrompt?: string;
};

export type ThreadStartWorkspace = {
  workspaceId: string;
  rootId?: string;
  cwd?: string;
};

export type SkillsListOptions = {
  workspaceId?: string;
  rootId?: string;
  cwd?: string;
};

export type ThreadStartResult = {
  thread: RoderThread;
  model: string;
  modelProvider: string;
  reasoning: string;
  workspaceId: string;
  rootId: string;
  cwd: string;
};

export type WorkspaceListResult = {
  workspaces: Workspace[];
};

export type WorkspaceCreateParams = {
  name?: string;
  roots: Array<{ path: string; name?: string }>;
  defaultRootPath?: string;
};

export type WorkspaceCreateResult = {
  workspace: Workspace;
};

export type WorkspaceUpdateParams = {
  workspaceId: string;
  name?: string;
  roots?: Array<{ path: string; name?: string }>;
  defaultRootId?: string;
};

export type WorkspaceUpdateResult = {
  workspace: Workspace;
};

export type WorkspaceForgetResult = {
  forgotten: boolean;
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

export type ThreadGoalGetResult = {
  goal: RoderThreadGoal | null;
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

export type CommandRunParams = {
  threadId: string;
  name: string;
  arguments: string;
  workspace?: string;
};

export type HunkListOptions = {
  turnId?: string;
  reviewId?: string;
};

export type HunkReadOptions = {
  offset?: number;
  limit?: number;
};

export type WorkspaceChangesListOptions = {
  turnId?: string;
};

export type VcsChangesListOptions = {
  limit?: number;
};

export type VcsChangesReadOptions = {
  offset?: number;
  limit?: number;
};

export const roderIpc = {
  start: () => window.roderDesktop.start(),
  restart: () => window.roderDesktop.restart(),
  status: () => window.roderDesktop.status(),
  appearance: () => window.roderDesktop.appearance(),
  openWorkspaceFolder: (defaultPath?: string) => window.roderDesktop.openWorkspaceFolder(defaultPath),
  listWorkspaces: () => window.roderDesktop.request("workspace/list", {}) as Promise<WorkspaceListResult>,
  createWorkspace: (params: WorkspaceCreateParams) =>
    window.roderDesktop.request("workspace/create", params) as Promise<WorkspaceCreateResult>,
  updateWorkspace: (params: WorkspaceUpdateParams) =>
    window.roderDesktop.request("workspace/update", params) as Promise<WorkspaceUpdateResult>,
  forgetWorkspace: (workspaceId: string) =>
    window.roderDesktop.request("workspace/forget", { workspaceId }) as Promise<WorkspaceForgetResult>,
  listThreads: (limit = 100) => window.roderDesktop.request("thread/list", { limit }) as Promise<ThreadListResult>,
  readThread: (threadId: string) =>
    window.roderDesktop.request("thread/read", { threadId, includeTurns: true }) as Promise<ThreadReadResult>,
  threadGoal: (threadId: string) =>
    window.roderDesktop.request("thread/goal/get", { threadId }) as Promise<ThreadGoalGetResult>,
  archiveThread: (threadId: string) =>
    window.roderDesktop.request("thread/archive", { threadId }) as Promise<ThreadArchiveResult>,
  startThread: (
    model: string,
    workspace: ThreadStartWorkspace,
    modelProvider?: string,
    reasoning?: string,
    options: ThreadStartOptions = {},
  ) =>
    window.roderDesktop.request("thread/start", {
      workspaceId: workspace.workspaceId,
      rootId: workspace.rootId || undefined,
      model,
      cwd: workspace.cwd || undefined,
      modelProvider,
      reasoning,
      ephemeral: false,
      initialPrompt: options.initialPrompt || undefined,
    }) as Promise<ThreadStartResult>,
  selectProviderDefaults: (provider: string, model?: string, reasoning?: string) =>
    window.roderDesktop.request("providers/select", { provider, model, reasoning }) as Promise<ProviderSelectResult>,
  startTurn: (
    threadId: string,
    prompt: string,
    attachments: DesktopAttachment[] = [],
    options: TurnStartOptions = {},
  ) => {
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
    window.roderDesktop.request("turn/interrupt", {
      threadId,
      turnId: turnId || undefined,
    }) as Promise<TurnInterruptResult>,
  listHunks: (threadId: string, options: HunkListOptions = {}) =>
    window.roderDesktop.request("hunk/list", {
      threadId,
      turnId: options.turnId || undefined,
      reviewId: options.reviewId || undefined,
    }) as Promise<HunkListResult>,
  readHunk: (threadId: string, hunkId: string, options: HunkReadOptions = {}) =>
    window.roderDesktop.request("hunk/read", {
      threadId,
      hunkId,
      offset: options.offset,
      limit: options.limit,
    }) as Promise<HunkReadResult>,
  listWorkspaceChanges: (threadId: string, options: WorkspaceChangesListOptions = {}) =>
    window.roderDesktop.request("workspace/changes/list", {
      threadId,
      turnId: options.turnId || undefined,
    }) as Promise<WorkspaceChangesListResult>,
  listVcsChanges: (
    workspace: Pick<WorkspaceRoot, "id"> & { workspaceId: string },
    options: VcsChangesListOptions = {},
  ) =>
    window.roderDesktop.request("vcs/changes/list", {
      workspaceId: workspace.workspaceId,
      rootId: workspace.id,
      limit: options.limit,
    }) as Promise<VcsChangesListResult>,
  readVcsChange: (
    workspace: Pick<WorkspaceRoot, "id"> & { workspaceId: string },
    path: string,
    options: VcsChangesReadOptions = {},
  ) =>
    window.roderDesktop.request("vcs/changes/read", {
      workspaceId: workspace.workspaceId,
      rootId: workspace.id,
      path,
      offset: options.offset,
      limit: options.limit,
    }) as Promise<VcsChangesReadResult>,
  threadState: () => window.roderDesktop.request("thread/state", {}) as Promise<ThreadStateResult>,
  resolveApproval: (params: { approvalId: string; approved: boolean }) =>
    window.roderDesktop.request("thread/resolve_approval", {
      approvalId: params.approvalId,
      approved: params.approved,
    }),
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
  listCommands: () => window.roderDesktop.request("commands/list", {}) as Promise<CommandsListResult>,
  runCommand: (params: CommandRunParams) =>
    window.roderDesktop.request("commands/run", {
      thread_id: params.threadId,
      name: params.name,
      arguments: params.arguments,
      workspace: params.workspace || undefined,
    }) as Promise<CommandsRunResult>,
  listAgents: () => window.roderDesktop.request("agents/list", {}) as Promise<AgentsListResult>,
  listTasks: () => window.roderDesktop.request("tasks/list", {}) as Promise<TasksListResult>,
  getTask: (taskId: string) => window.roderDesktop.request("tasks/get", { task_id: taskId }) as Promise<TasksGetResult>,
  listProcesses: (includeCompleted = false) =>
    window.roderDesktop.request("processes/list", { includeCompleted }) as Promise<ProcessesListResult>,
  stopProcess: (processId: string, reason?: string) =>
    window.roderDesktop.request("processes/stop", {
      processId,
      reason: reason || undefined,
    }) as Promise<ProcessesStopResult>,
  stopAllProcesses: (reason?: string) =>
    window.roderDesktop.request("processes/stopAll", {
      reason: reason || undefined,
    }) as Promise<ProcessesStopAllResult>,
  listSkills: (options: SkillsListOptions = {}) =>
    window.roderDesktop.request("skills/list", {
      workspaceId: options.workspaceId || undefined,
      rootId: options.rootId || undefined,
      cwd: options.cwd || undefined,
    }) as Promise<SkillsListResult>,
  setSkillEnabled: (canonicalPath: string, enabled: boolean) =>
    window.roderDesktop.request("skills/setEnabled", {
      selector: { path: canonicalPath },
      enabled,
    }) as Promise<SkillsUpdateResult>,
  setSkillExposure: (canonicalPath: string, exposure: SkillExposure) =>
    window.roderDesktop.request("skills/setExposure", {
      selector: { path: canonicalPath },
      exposure,
    }) as Promise<SkillsUpdateResult>,
  listSpeechProviders: () =>
    window.roderDesktop.request("speech/providers/list", {}) as Promise<{ providers: SpeechProviderDescriptor[] }>,
  transcribeSpeech: (params: {
    provider?: string;
    model?: string;
    audio: {
      bytesBase64: string;
      mimeType: string;
      filename?: string;
    };
    language?: string;
    prompt?: string;
    diarization?: boolean;
  }) => window.roderDesktop.request("speech/transcribe", params) as Promise<SpeechTranscribeResult>,
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
    if (attachment.imageUrl && attachment.type.startsWith("image/")) {
      input.push({ type: "image", imageUrl: attachment.imageUrl });
    } else if (attachment.path) {
      input.push({ type: "local_file", path: attachment.path });
    }
  }
  return input;
}

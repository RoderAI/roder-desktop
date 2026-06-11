import type {
  CommandsListResult,
  CommandsRunResult,
  DesktopAttachment,
  DesignDocumentResult,
  DesignEditorStateResult,
  DesignExportNodesResult,
  DesignGuidelinesResult,
  DesignPatchOperation,
  DesignPatchResult,
  DesignScreenshotResult,
  DesignSpawnAgentsResult,
  DesignSnapshotLayoutResult,
  DesignVariablesResult,
  FileSystemReadDirectoryResult,
  FileSystemReadFileResult,
  AgentsListResult,
  HunkListResult,
  HunkReadResult,
  PolicyMode,
  ProviderDescriptor,
  ProcessesListResult,
  ProcessesStopAllResult,
  ProcessesStopResult,
  ModelSelectChoice,
  ModelSelectResult,
  ProvidersListResult,
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
  VcsChangeArea,
  VcsChangesListResult,
  VcsChangesReadResult,
  ModelSelectionMode,
  SpeechProviderDescriptor,
  SpeechTranscribeResult,
  Workspace,
  WorkspaceChangesListResult,
  WorkspaceFilesChildrenResult,
  WorkspaceFilesQueryResult,
  WorkspaceFilesReadResult,
  WorkspaceFilesRebuildResult,
  WorkspaceFilesStatusResult,
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
  selection?: ModelSelectChoice;
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
  selectionMode?: RoderThread["selectionMode"];
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

type WireModelSelectionMode =
  | {
      type: "manual";
      provider: string;
      model: string;
      reasoning?: string | null;
    }
  | {
      type: "auto";
      option_id?: string | null;
      router_id?: string | null;
      label?: string | null;
      baseline?: { provider?: string | null; model?: string | null } | null;
      profile?: string | null;
      reasoning?: string | null;
    };

type WireModelSelectChoice =
  | {
      type: "manual";
      provider: string;
      model: string;
      reasoning?: string;
    }
  | {
      type: "auto";
      option_id: string;
    };

type WireModelSelectResult = Omit<ModelSelectResult, "selectionMode"> & {
  selectionMode: WireModelSelectionMode;
};

type WireProviderDescriptor = Omit<ProviderDescriptor, "authType" | "authLabel" | "authDetail" | "sortOrder"> & {
  auth_type?: string;
  auth_label?: string | null;
  auth_detail?: string | null;
  sort_order?: number;
};

type WireProvidersListResult = Omit<ProvidersListResult, "providers" | "selectionMode"> & {
  providers: WireProviderDescriptor[];
  selectionMode?: WireModelSelectionMode | null;
};

type WireThread = Omit<RoderThread, "selectionMode"> & {
  selectionMode?: WireModelSelectionMode | null;
};

type WireThreadStartResult = Omit<ThreadStartResult, "selectionMode" | "thread"> & {
  selectionMode?: WireModelSelectionMode | null;
  thread: WireThread;
};

function modelSelectChoiceToWire(selection: ModelSelectChoice): WireModelSelectChoice {
  if (selection.type === "auto") {
    return {
      type: "auto",
      option_id: selection.optionId,
    };
  }
  return selection;
}

function modelSelectionModeFromWire(selectionMode: WireModelSelectionMode): ModelSelectionMode {
  if (selectionMode.type === "auto") {
    if (!selectionMode.option_id) {
      return {
        type: "manual",
        provider: selectionMode.baseline?.provider ?? "",
        model: selectionMode.baseline?.model ?? "",
        reasoning: selectionMode.reasoning ?? null,
      };
    }
    const mode: ModelSelectionMode = {
      type: "auto",
      optionId: selectionMode.option_id,
      routerId: selectionMode.router_id ?? "",
      label: selectionMode.label ?? "Auto",
      baseline: {
        provider: selectionMode.baseline?.provider ?? "",
        model: selectionMode.baseline?.model ?? "",
      },
    };
    if ("profile" in selectionMode) {
      mode.profile = selectionMode.profile ?? null;
    }
    if ("reasoning" in selectionMode) {
      mode.reasoning = selectionMode.reasoning ?? null;
    }
    return mode;
  }
  return selectionMode;
}

function providerDescriptorFromWire(provider: WireProviderDescriptor): ProviderDescriptor {
  const { auth_type, auth_label, auth_detail, sort_order, ...domainProvider } = provider;
  return {
    ...domainProvider,
    authType: auth_type,
    authLabel: auth_label,
    authDetail: auth_detail,
    sortOrder: sort_order,
  };
}

function modelSelectResultFromWire(result: WireModelSelectResult): ModelSelectResult {
  return {
    ...result,
    selectionMode: modelSelectionModeFromWire(result.selectionMode),
  };
}

function providersListResultFromWire(result: WireProvidersListResult): ProvidersListResult {
  return {
    ...result,
    providers: result.providers.map(providerDescriptorFromWire),
    selectionMode: result.selectionMode ? modelSelectionModeFromWire(result.selectionMode) : result.selectionMode,
  };
}

function threadStartResultFromWire(result: WireThreadStartResult): ThreadStartResult {
  const { selectionMode, thread, ...rest } = result;
  const { selectionMode: threadSelectionMode, ...threadRest } = thread;
  return {
    ...rest,
    selectionMode: selectionMode ? modelSelectionModeFromWire(selectionMode) : selectionMode,
    thread: {
      ...threadRest,
      selectionMode: threadSelectionMode ? modelSelectionModeFromWire(threadSelectionMode) : threadSelectionMode,
    },
  };
}

export type WorkspaceFilesStatusParams = {
  workspaceId: string;
  rootId?: string;
};

export type WorkspaceFilesChildrenParams = {
  workspaceId: string;
  rootId?: string;
  path?: string;
};

export type WorkspaceFilesQueryParams = {
  workspaceId: string;
  rootId?: string;
  query: string;
  limit?: number;
};

export type WorkspaceFilesReadParams = {
  workspaceId: string;
  rootId: string;
  path: string;
  offset?: number;
  limit?: number;
};

export type ProviderSelectResult = {
  provider: string;
  model: string;
  reasoning: string;
};

export type ProviderConfigureResult = {
  provider: string;
  authenticated: boolean;
};

export type ThreadArchiveResult = {
  threadId: string;
  archived: boolean;
};

export type ThreadGoalGetResult = {
  goal: RoderThreadGoal | null;
};

export type ToolCallResult = {
  text: string;
  data: unknown;
  is_error: boolean;
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
  area?: VcsChangeArea;
  ignoreWhitespace?: boolean;
};

export const roderIpc = {
  start: () => window.roderDesktop.start(),
  restart: () => window.roderDesktop.restart(),
  status: () => window.roderDesktop.status(),
  appearance: () => window.roderDesktop.appearance(),
  openWorkspaceFolder: (defaultPath?: string) => window.roderDesktop.openWorkspaceFolder(defaultPath),
  openWorkspaceFolders: (defaultPath?: string) => window.roderDesktop.openWorkspaceFolders(defaultPath),
  listWorkspaces: () => window.roderDesktop.request("workspace/list", {}) as Promise<WorkspaceListResult>,
  createWorkspace: (params: WorkspaceCreateParams) =>
    window.roderDesktop.request("workspace/create", params) as Promise<WorkspaceCreateResult>,
  updateWorkspace: (params: WorkspaceUpdateParams) =>
    window.roderDesktop.request("workspace/update", params) as Promise<WorkspaceUpdateResult>,
  forgetWorkspace: (workspaceId: string) =>
    window.roderDesktop.request("workspace/forget", { workspaceId }) as Promise<WorkspaceForgetResult>,
  readDirectory: (path: string) =>
    window.roderDesktop.request("fs/readDirectory", { path }) as Promise<FileSystemReadDirectoryResult>,
  readFile: (path: string) => window.roderDesktop.request("fs/readFile", { path }) as Promise<FileSystemReadFileResult>,

  workspaceFilesStatus: (params: WorkspaceFilesStatusParams) =>
    window.roderDesktop.request("workspace/files/status", {
      workspaceId: params.workspaceId,
      rootId: params.rootId || undefined,
    }) as Promise<WorkspaceFilesStatusResult>,
  rebuildWorkspaceFiles: (params: WorkspaceFilesStatusParams) =>
    window.roderDesktop.request("workspace/files/rebuild", {
      workspaceId: params.workspaceId,
      rootId: params.rootId || undefined,
    }) as Promise<WorkspaceFilesRebuildResult>,
  listWorkspaceFileChildren: (params: WorkspaceFilesChildrenParams) =>
    window.roderDesktop.request("workspace/files/children", {
      workspaceId: params.workspaceId,
      rootId: params.rootId || undefined,
      path: params.path || undefined,
    }) as Promise<WorkspaceFilesChildrenResult>,
  queryWorkspaceFiles: (params: WorkspaceFilesQueryParams) =>
    window.roderDesktop.request("workspace/files/query", {
      workspaceId: params.workspaceId,
      rootId: params.rootId || undefined,
      query: params.query,
      limit: params.limit,
    }) as Promise<WorkspaceFilesQueryResult>,
  readWorkspaceFile: (params: WorkspaceFilesReadParams) =>
    window.roderDesktop.request("workspace/files/read", {
      workspaceId: params.workspaceId,
      rootId: params.rootId,
      path: params.path,
      offset: params.offset,
      limit: params.limit,
    }) as Promise<WorkspaceFilesReadResult>,
  readDesign: (workspaceId: string, rootId?: string) =>
    window.roderDesktop.request("design/read", {
      workspaceId,
      rootId: rootId || undefined,
    }) as Promise<DesignDocumentResult>,
  patchDesign: (workspaceId: string, rootId: string | undefined, operations: DesignPatchOperation[]) =>
    window.roderDesktop.request("design/patch", {
      workspaceId,
      rootId: rootId || undefined,
      operations,
    }) as Promise<DesignPatchResult>,
  designVariables: (workspaceId: string, rootId?: string) =>
    window.roderDesktop.request("design/get_variables", {
      workspaceId,
      rootId: rootId || undefined,
    }) as Promise<DesignVariablesResult>,
  designSetVariables: (
    workspaceId: string,
    rootId: string | undefined,
    variables: Record<string, unknown>,
    replace = false,
  ) =>
    window.roderDesktop.request("design/set_variables", {
      workspaceId,
      rootId: rootId || undefined,
      variables,
      replace,
    }) as Promise<DesignPatchResult>,
  designSetSelection: (workspaceId: string, rootId: string | undefined, selectedNodeIds: string[]) =>
    window.roderDesktop.request("design/set_selection", {
      workspaceId,
      rootId: rootId || undefined,
      selectedNodeIds,
    }) as Promise<DesignEditorStateResult>,
  designSnapshotLayout: (workspaceId: string, rootId?: string) =>
    window.roderDesktop.request("design/snapshot_layout", {
      workspaceId,
      rootId: rootId || undefined,
    }) as Promise<DesignSnapshotLayoutResult>,
  designGuidelines: (workspaceId: string, rootId?: string) =>
    window.roderDesktop.request("design/get_guidelines", {
      workspaceId,
      rootId: rootId || undefined,
    }) as Promise<DesignGuidelinesResult>,
  designExportNodes: (workspaceId: string, rootId: string | undefined, nodeIds: string[], outputDir?: string) =>
    window.roderDesktop.request("design/export_nodes", {
      workspaceId,
      rootId: rootId || undefined,
      nodeIds,
      outputDir: outputDir || undefined,
      format: "svg",
    }) as Promise<DesignExportNodesResult>,
  designGetScreenshot: (workspaceId: string, rootId: string | undefined, nodeId?: string) =>
    window.roderDesktop.request("design/get_screenshot", {
      workspaceId,
      rootId: rootId || undefined,
      nodeId: nodeId || undefined,
      format: "svg",
    }) as Promise<DesignScreenshotResult>,
  designSpawnAgents: (
    workspaceId: string,
    rootId: string | undefined,
    scopeNodeIds: string[],
    options: { prompt?: string; allowPatch: boolean; allowExport: boolean; requireReview: boolean },
  ) =>
    window.roderDesktop.request("design/spawn_agents", {
      workspaceId,
      rootId: rootId || undefined,
      scopeNodeIds,
      prompt: options.prompt || undefined,
      allowPatch: options.allowPatch,
      allowExport: options.allowExport,
      requireReview: options.requireReview,
    }) as Promise<DesignSpawnAgentsResult>,

  listThreads: (limit = 50, cursor?: string | null) =>
    window.roderDesktop.request("thread/list", { limit, cursor: cursor || undefined }) as Promise<ThreadListResult>,
  readThread: (threadId: string, includeTurns = true) =>
    window.roderDesktop.request("thread/read", { threadId, includeTurns }) as Promise<ThreadReadResult>,
  threadGoal: (threadId: string) =>
    window.roderDesktop.request("thread/goal/get", { threadId }) as Promise<ThreadGoalGetResult>,
  createGoal: (threadId: string, objective: string) =>
    window.roderDesktop.request("tools/call", {
      thread_id: threadId,
      tool_name: "create_goal",
      arguments: { objective },
    }) as Promise<ToolCallResult>,
  archiveThread: (threadId: string) =>
    window.roderDesktop.request("thread/archive", { threadId }) as Promise<ThreadArchiveResult>,
  startThread: (
    model: string,
    workspace: ThreadStartWorkspace,
    modelProvider?: string,
    reasoning?: string,
    options: ThreadStartOptions = {},
  ) =>
    window.roderDesktop
      .request("thread/start", {
        workspaceId: workspace.workspaceId,
        rootId: workspace.rootId || undefined,
        model,
        cwd: workspace.cwd || undefined,
        modelProvider,
        reasoning,
        selection: options.selection ? modelSelectChoiceToWire(options.selection) : undefined,
        ephemeral: false,
        initialPrompt: options.initialPrompt || undefined,
      })
      .then((result) => threadStartResultFromWire(result as WireThreadStartResult)) as Promise<ThreadStartResult>,
  selectProviderDefaults: (provider: string, model?: string, reasoning?: string) =>
    window.roderDesktop.request("providers/select", { provider, model, reasoning }) as Promise<ProviderSelectResult>,
  listProviders: () =>
    window.roderDesktop
      .request("providers/list", {})
      .then((result) => providersListResultFromWire(result as WireProvidersListResult)) as Promise<ProvidersListResult>,
  configureProvider: (provider: string, apiKey: string) =>
    window.roderDesktop.request("providers/configure", { provider, api_key: apiKey }) as Promise<ProviderConfigureResult>,
  selectModel: (selection: ModelSelectChoice, threadId?: string) =>
    window.roderDesktop
      .request("model/select", {
        ...(threadId ? { threadId } : {}),
        selection: modelSelectChoiceToWire(selection),
      })
      .then((result) => modelSelectResultFromWire(result as WireModelSelectResult)) as Promise<ModelSelectResult>,
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
      area: options.area,
      ignoreWhitespace: options.ignoreWhitespace,
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

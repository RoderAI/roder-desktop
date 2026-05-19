import type { DesktopAttachment, RoderModel, RoderStatus, RoderThread, SystemAppearance, TurnInputItem } from "@/types/roder";

export type ThreadListResult = {
  data?: RoderThread[];
  nextCursor?: string | null;
  backwardsCursor?: string | null;
};

export type ThreadReadResult = {
  thread?: RoderThread;
};

export type ThreadStartResult = {
  thread?: RoderThread;
  model?: string;
  modelProvider?: string;
  cwd?: string;
};

export type ThreadArchiveResult = {
  threadId: string;
  archived: boolean;
};

export type ModelListResult = {
  models?: RoderModel[];
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
  startThread: (model: string, cwd?: string, modelProvider?: string) =>
    window.roderDesktop.request("thread/start", { model, cwd, modelProvider, ephemeral: false }) as Promise<ThreadStartResult>,
  startTurn: (threadId: string, prompt: string, attachments: DesktopAttachment[] = []) => {
    const input = turnInput(prompt, attachments);
    if (input.length > 0) {
      return window.roderDesktop.request("turn/start", { threadId, input });
    }
    return window.roderDesktop.request("turn/start", { threadId, prompt });
  },
  steerTurn: (threadId: string, expectedTurnId: string, prompt: string, attachments: DesktopAttachment[] = []) => {
    const input = turnInput(prompt, attachments);
    const params = input.length > 0 ? { threadId, expectedTurnId, input } : { threadId, expectedTurnId, prompt };
    return window.roderDesktop.request("turn/steer", params);
  },
  interruptTurn: (threadId: string, turnId?: string) =>
    window.roderDesktop.request("turn/interrupt", { threadId, turnId: turnId || undefined }),
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

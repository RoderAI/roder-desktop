import type { DesktopAttachment, GodeModel, GodeStatus, GodeThread, SystemAppearance, TurnInputItem } from "@/types/gode";

export type ThreadListResult = {
  data?: GodeThread[];
  nextCursor?: string | null;
  backwardsCursor?: string | null;
};

export type ThreadReadResult = {
  thread?: GodeThread;
};

export type ThreadStartResult = {
  thread?: GodeThread;
  model?: string;
  modelProvider?: string;
  cwd?: string;
};

export type ModelListResult = {
  models?: GodeModel[];
};

export const godeIpc = {
  start: () => window.godeDesktop.start(),
  restart: () => window.godeDesktop.restart(),
  status: () => window.godeDesktop.status(),
  appearance: () => window.godeDesktop.appearance(),
  openWorkspaceFolder: (defaultPath?: string) => window.godeDesktop.openWorkspaceFolder(defaultPath),
  listThreads: (limit = 100) => window.godeDesktop.request("thread/list", { limit }) as Promise<ThreadListResult>,
  readThread: (threadId: string) =>
    window.godeDesktop.request("thread/read", { threadId, includeTurns: true }) as Promise<ThreadReadResult>,
  startThread: (model: string, cwd?: string, modelProvider?: string) =>
    window.godeDesktop.request("thread/start", { model, cwd, modelProvider, ephemeral: false }) as Promise<ThreadStartResult>,
  startTurn: (threadId: string, prompt: string, attachments: DesktopAttachment[] = []) => {
    const input = turnInput(prompt, attachments);
    if (input.length > 0) {
      return window.godeDesktop.request("turn/start", { threadId, input });
    }
    return window.godeDesktop.request("turn/start", { threadId, prompt });
  },
  listModels: () => window.godeDesktop.request("model/list", {}) as Promise<ModelListResult>,
  onStatus: (callback: (status: GodeStatus) => void) => window.godeDesktop.onStatus(callback),
  onNotification: window.godeDesktop.onNotification,
  onStderr: window.godeDesktop.onStderr,
  onAppearance: (callback: (appearance: SystemAppearance) => void) => window.godeDesktop.onAppearance(callback),
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

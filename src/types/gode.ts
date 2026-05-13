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
};

export type GodeModel = {
  id: string;
  name: string;
  description?: string;
  modelProvider: string;
  defaultReasoningEffort?: string;
  isDefault?: boolean;
};

export type ConversationMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  status?: "streaming" | "complete" | "failed";
};

declare global {
  interface Window {
    godeDesktop: {
      request: (method: string, params?: unknown) => Promise<unknown>;
      start: () => Promise<GodeStatus>;
      restart: () => Promise<GodeStatus>;
      status: () => Promise<GodeStatus>;
      onNotification: (callback: (notification: GodeNotification) => void) => () => void;
      onStatus: (callback: (status: GodeStatus) => void) => () => void;
      onStderr: (callback: (message: string) => void) => () => void;
    };
  }
}

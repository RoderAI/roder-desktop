import { useCallback, useEffect, useMemo, useState } from "react";
import { demoMessages, demoThreads } from "@/data/demo";
import type { ConversationMessage, GodeModel, GodeNotification, GodeStatus, GodeThread } from "@/types/gode";

type ThreadListResult = {
  data?: GodeThread[];
};

type ModelListResult = {
  models?: GodeModel[];
};

type ThreadStartResult = {
  thread?: GodeThread;
  model?: string;
};

type AgentState = {
  status: GodeStatus;
  stderr: string[];
  threads: GodeThread[];
  activeThreadId: string;
  messages: ConversationMessage[];
  models: GodeModel[];
  selectedModel: string;
  busy: boolean;
  error: string | null;
};

const initialStatus: GodeStatus = {
  state: "starting",
  binary: "unresolved",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function notificationParams(notification: GodeNotification): Record<string, unknown> {
  return isRecord(notification.params) ? notification.params : {};
}

function firstRealThread(threads: GodeThread[]): GodeThread | undefined {
  return threads.find((thread) => !thread.id.startsWith("demo-"));
}

export function useGodeAgent(): AgentState & {
  selectThread: (threadId: string) => void;
  newThread: () => Promise<void>;
  sendPrompt: (prompt: string) => Promise<void>;
  restart: () => Promise<void>;
  setSelectedModel: (model: string) => void;
} {
  const [state, setState] = useState<AgentState>({
    status: initialStatus,
    stderr: [],
    threads: demoThreads,
    activeThreadId: demoThreads[0].id,
    messages: demoMessages,
    models: [],
    selectedModel: "gpt-5.3-codex",
    busy: false,
    error: null,
  });

  const refresh = useCallback(async () => {
    const readyStatus = await window.godeDesktop.start();
    const [status, threadResult, modelResult] = await Promise.all([
      window.godeDesktop.status().then((current) => (current.state === "starting" ? readyStatus : current)),
      window.godeDesktop.request("thread/list", { limit: 80 }) as Promise<ThreadListResult>,
      window.godeDesktop.request("model/list", {}) as Promise<ModelListResult>,
    ]);

    const liveThreads = threadResult.data ?? [];
    const models = modelResult.models ?? [];
    const mergedThreads = liveThreads.length > 0 ? liveThreads : demoThreads;
    const active = firstRealThread(mergedThreads)?.id ?? mergedThreads[0]?.id ?? demoThreads[0].id;
    const defaultModel = models.find((model) => model.isDefault)?.id ?? models[0]?.id ?? state.selectedModel;

    setState((current) => ({
      ...current,
      status,
      threads: mergedThreads,
      activeThreadId: current.activeThreadId.startsWith("demo-") ? active : current.activeThreadId,
      models,
      selectedModel: current.selectedModel || defaultModel,
      error: null,
    }));
  }, [state.selectedModel]);

  useEffect(() => {
    const offStatus = window.godeDesktop.onStatus((status) => {
      setState((current) => ({ ...current, status }));
    });
    const offStderr = window.godeDesktop.onStderr((message) => {
      setState((current) => ({ ...current, stderr: [message, ...current.stderr].slice(0, 5) }));
    });
    const offNotification = window.godeDesktop.onNotification((notification) => {
      setState((current) => applyNotification(current, notification));
    });

    refresh().catch((error: Error) => {
      setState((current) => ({ ...current, status: { state: "error", binary: "unresolved", message: error.message }, error: error.message }));
    });

    return () => {
      offStatus();
      offStderr();
      offNotification();
    };
  }, [refresh]);

  const selectThread = useCallback((threadId: string) => {
    setState((current) => ({
      ...current,
      activeThreadId: threadId,
      messages: threadId.startsWith("demo-") ? demoMessages : current.messages,
    }));
  }, []);

  const newThread = useCallback(async () => {
    setState((current) => ({ ...current, busy: true, error: null }));
    try {
      const result = (await window.godeDesktop.request("thread/start", {
        model: state.selectedModel,
        ephemeral: false,
      })) as ThreadStartResult;
      const thread = result.thread;
      if (!thread) {
        throw new Error("gode app-server did not return a thread");
      }
      setState((current) => ({
        ...current,
        threads: [thread, ...current.threads.filter((item) => item.id !== thread.id && !item.id.startsWith("demo-"))],
        activeThreadId: thread.id,
        messages: [],
        busy: false,
      }));
    } catch (error) {
      setState((current) => ({ ...current, busy: false, error: (error as Error).message }));
    }
  }, [state.selectedModel]);

  const sendPrompt = useCallback(
    async (prompt: string) => {
      const text = prompt.trim();
      if (!text) {
        return;
      }

      let threadId = state.activeThreadId;
      const isDemo = threadId.startsWith("demo-");
      setState((current) => ({
        ...current,
        busy: true,
        error: null,
        messages: [
          ...(isDemo ? [] : current.messages),
          { id: crypto.randomUUID(), role: "user", text, status: "complete" },
        ],
      }));

      try {
        if (isDemo) {
          const result = (await window.godeDesktop.request("thread/start", {
            model: state.selectedModel,
            ephemeral: false,
          })) as ThreadStartResult;
          if (!result.thread) {
            throw new Error("gode app-server did not return a thread");
          }
          threadId = result.thread.id;
          setState((current) => ({
            ...current,
            threads: [result.thread!, ...current.threads.filter((item) => !item.id.startsWith("demo-"))],
            activeThreadId: threadId,
          }));
        }

        await window.godeDesktop.request("turn/start", {
          threadId,
          prompt: text,
        });
      } catch (error) {
        setState((current) => ({ ...current, busy: false, error: (error as Error).message }));
      }
    },
    [state.activeThreadId, state.selectedModel],
  );

  const restart = useCallback(async () => {
    setState((current) => ({ ...current, busy: true, error: null }));
    try {
      const status = await window.godeDesktop.restart();
      setState((current) => ({ ...current, status, busy: false }));
      await refresh();
    } catch (error) {
      setState((current) => ({ ...current, busy: false, error: (error as Error).message }));
    }
  }, [refresh]);

  const selectedModel = useMemo(() => state.selectedModel, [state.selectedModel]);

  return {
    ...state,
    selectedModel,
    selectThread,
    newThread,
    sendPrompt,
    restart,
    setSelectedModel: (model: string) => setState((current) => ({ ...current, selectedModel: model })),
  };
}

function applyNotification(current: AgentState, notification: GodeNotification): AgentState {
  const params = notificationParams(notification);
  if (notification.method === "thread/started" && isRecord(params.thread)) {
    const thread = params.thread as GodeThread;
    return {
      ...current,
      threads: [thread, ...current.threads.filter((item) => item.id !== thread.id && !item.id.startsWith("demo-"))],
      activeThreadId: thread.id,
    };
  }

  if (notification.method === "item/started") {
    const item = isRecord(params.item) ? params.item : {};
    if (item.type !== "agentMessage") {
      return current;
    }
    return {
      ...current,
      messages: [
        ...current.messages,
        { id: String(item.id), role: "assistant", text: String(item.text ?? ""), status: "streaming" },
      ],
    };
  }

  if (notification.method === "item/agentMessage/delta") {
    const itemId = String(params.itemId ?? "");
    const delta = String(params.delta ?? "");
    return {
      ...current,
      messages: current.messages.map((message) =>
        message.id === itemId ? { ...message, text: message.text + delta, status: "streaming" } : message,
      ),
    };
  }

  if (notification.method === "item/completed") {
    const item = isRecord(params.item) ? params.item : {};
    if (item.type !== "agentMessage") {
      return current;
    }
    const itemId = String(item.id);
    const text = String(item.text ?? "");
    return {
      ...current,
      messages: current.messages.map((message) =>
        message.id === itemId ? { ...message, text: text || message.text, status: "complete" } : message,
      ),
    };
  }

  if (notification.method === "turn/completed") {
    return { ...current, busy: false };
  }

  if (notification.method === "thread/status/changed") {
    const threadId = String(params.threadId ?? "");
    const status = isRecord(params.status) ? (params.status as GodeThread["status"]) : { type: "idle" };
    return {
      ...current,
      threads: current.threads.map((thread) => (thread.id === threadId ? { ...thread, status } : thread)),
    };
  }

  return current;
}

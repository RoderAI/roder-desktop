import type {
  AgentWaitRequest,
  PendingWaitRequestsByThread,
  RoderItem,
  RoderNotification,
  RoderQuestionOption,
  RoderUserInputQuestion,
} from "@/types/roder";

const emptyWaitRequests: AgentWaitRequest[] = [];

export function waitRequestsForThread(pending: PendingWaitRequestsByThread, threadId: string): AgentWaitRequest[] {
  return pending[threadId] ?? emptyWaitRequests;
}

export function reducePendingWaitRequests(
  pending: PendingWaitRequestsByThread,
  notification: RoderNotification,
  fallbackThreadId: string,
): PendingWaitRequestsByThread {
  const params = notificationParams(notification);

  if (notification.method === "thread/approvalRequested") {
    const threadId = stringParam(params.threadId) || fallbackThreadId;
    const approvalId = stringParam(params.approvalId);
    if (!threadId || !approvalId) {
      return pending;
    }
    return upsertWaitRequest(pending, threadId, {
      kind: "approval",
      id: approvalId,
      approvalId,
      threadId,
      turnId: stringParam(params.turnId),
      toolId: stringParam(params.toolId),
      toolName: stringParam(params.toolName) || "tool",
      reason: stringParam(params.reason),
    });
  }

  if (notification.method === "thread/userInputRequested") {
    const threadId = stringParam(params.threadId) || fallbackThreadId;
    const requestId = stringParam(params.requestId);
    if (!threadId || !requestId) {
      return pending;
    }
    return upsertWaitRequest(pending, threadId, {
      kind: "userInput",
      id: requestId,
      requestId,
      threadId,
      turnId: stringParam(params.turnId),
      questions: questionsParam(params.questions),
    });
  }

  if (notification.method === "thread/planExitRequested") {
    const threadId = stringParam(params.threadId) || fallbackThreadId;
    const requestId = stringParam(params.requestId);
    if (!threadId || !requestId) {
      return pending;
    }
    return upsertWaitRequest(pending, threadId, {
      kind: "planExit",
      id: requestId,
      requestId,
      threadId,
      turnId: stringParam(params.turnId),
      targetMode: stringParam(params.targetMode),
      planSummary: stringParam(params.planSummary),
    });
  }

  if (notification.method === "thread/approvalResolved") {
    const threadId = stringParam(params.threadId) || fallbackThreadId;
    return removeWaitRequest(pending, threadId, stringParam(params.approvalId));
  }

  if (notification.method === "thread/userInputResolved" || notification.method === "thread/planExitResolved") {
    const threadId = stringParam(params.threadId) || fallbackThreadId;
    return removeWaitRequest(pending, threadId, stringParam(params.requestId));
  }

  if (notification.method === "turn/completed") {
    const threadId = stringParam(params.threadId) || fallbackThreadId;
    return clearWaitRequestsForThread(pending, threadId);
  }

  return pending;
}

export function setWaitRequestResolving(
  pending: PendingWaitRequestsByThread,
  threadId: string,
  requestId: string,
  resolving: boolean,
  error?: string,
): PendingWaitRequestsByThread {
  const requests = pending[threadId];
  if (!requests) {
    return pending;
  }
  const nextRequests = requests.map((request) =>
    request.id === requestId ? withResolvingState(request, resolving, error) : request,
  );
  return { ...pending, [threadId]: nextRequests };
}

export function shouldDisplayStartedItem(item: Pick<RoderItem, "type"> | Record<string, unknown>): boolean {
  const type = String(item.type ?? "");
  return type === "agentMessage" || type === "toolExecution";
}

function upsertWaitRequest(
  pending: PendingWaitRequestsByThread,
  threadId: string,
  request: AgentWaitRequest,
): PendingWaitRequestsByThread {
  const requests = pending[threadId] ?? [];
  const nextRequests = [...requests.filter((existing) => existing.id !== request.id), request];
  return { ...pending, [threadId]: nextRequests };
}

function removeWaitRequest(
  pending: PendingWaitRequestsByThread,
  threadId: string,
  requestId: string,
): PendingWaitRequestsByThread {
  if (!threadId || !requestId || !pending[threadId]) {
    return pending;
  }
  const nextRequests = pending[threadId].filter((request) => request.id !== requestId);
  if (nextRequests.length === 0) {
    const { [threadId]: _removed, ...rest } = pending;
    return rest;
  }
  return { ...pending, [threadId]: nextRequests };
}

function clearWaitRequestsForThread(
  pending: PendingWaitRequestsByThread,
  threadId: string,
): PendingWaitRequestsByThread {
  if (!threadId || !pending[threadId]) {
    return pending;
  }
  const { [threadId]: _removed, ...rest } = pending;
  return rest;
}

function withResolvingState(request: AgentWaitRequest, resolving: boolean, error?: string): AgentWaitRequest {
  const next = { ...request, resolving };
  if (error) {
    return { ...next, error };
  }
  const { error: _error, ...withoutError } = next;
  return withoutError;
}

function questionsParam(value: unknown): RoderUserInputQuestion[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((question) => {
    if (!isRecord(question)) {
      return [];
    }
    const id = stringParam(question.id);
    const text = stringParam(question.question);
    if (!id || !text) {
      return [];
    }
    return [
      {
        id,
        question: text,
        options: optionsParam(question.options),
      },
    ];
  });
}

function optionsParam(value: unknown): RoderQuestionOption[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((option) => {
    if (!isRecord(option)) {
      return [];
    }
    const label = stringParam(option.label);
    if (!label) {
      return [];
    }
    return [
      {
        label,
        description: stringParam(option.description),
      },
    ];
  });
}

function notificationParams(notification: RoderNotification): Record<string, unknown> {
  return isRecord(notification.params) ? notification.params : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringParam(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

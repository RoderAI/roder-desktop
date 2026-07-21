import type {
  SubagentLifecycleEvent,
  SubagentLifecycleVerb,
  SubagentTraceDelta,
  SubagentTraceItem,
  SubagentTraceStatus,
  SubagentTraceSummary,
  SubagentTraceView,
} from "@/types/roder";
import { normalizedTimestamp } from "@/lib/relative-age";

export type SubagentTracesByThread = Record<string, SubagentTraceView[]>;
export type SubagentLifecycleByThread = Record<string, SubagentLifecycleEvent[]>;

export type SubagentTraceStoreSlice = {
  subagentTracesByThread: SubagentTracesByThread;
  subagentLifecycleByThread: SubagentLifecycleByThread;
  /** teamId → lead thread id, learned from team/started (or member parentThreadId). */
  teamLeadThreadByTeamId: Record<string, string>;
  /** `${teamId}:${memberId}` → display name from team/started or team/member/started. */
  teamMemberTitlesByKey: Record<string, string>;
};

export type ReduceSubagentTraceOptions = {
  /** Used when team notifications omit thread ids and team/started was not seen. */
  fallbackThreadId?: string | null;
  /** Optional lookup for a member's child-thread title (e.g. sidebar preview). */
  resolveThreadTitle?: (threadId: string) => string | null;
};

const TEAM_ACTIVITY_BLURB_MAX = 200;
const LEAD_MEMBER_ID = "lead";

const activeStatuses = new Set<SubagentTraceStatus>(["queued", "running", "waiting_for_approval"]);

export function isSubagentTraceActive(status: SubagentTraceStatus): boolean {
  return activeStatuses.has(status);
}

export function activeSubagentTraces(traces: readonly SubagentTraceView[]): SubagentTraceView[] {
  return traces
    .filter((trace) => isSubagentTraceActive(trace.status))
    .toSorted((left, right) => right.updatedAt - left.updatedAt);
}

export function doneSubagentTraces(traces: readonly SubagentTraceView[]): SubagentTraceView[] {
  return traces
    .filter((trace) => !isSubagentTraceActive(trace.status))
    .toSorted((left, right) => right.updatedAt - left.updatedAt);
}

export function subagentTraceBlurb(trace: SubagentTraceView): string {
  const activity = trace.latestActivity?.trim();
  if (activity) {
    return activity;
  }
  if (trace.errorSummary?.trim()) {
    return trace.errorSummary.trim();
  }
  if (trace.status === "completed") {
    return "Completed";
  }
  if (trace.status === "failed") {
    return "Failed";
  }
  if (trace.status === "cancelled") {
    return "Cancelled";
  }
  if (trace.status === "waiting_for_approval") {
    return "Waiting for approval";
  }
  if (trace.status === "queued") {
    return "Queued";
  }
  return "Working";
}

export function subagentLifecycleLabel(event: SubagentLifecycleEvent): string {
  return `${event.title} — ${event.verb}`;
}

export function mergeHydratedSubagentTraces(
  existing: readonly SubagentTraceView[],
  summaries: readonly SubagentTraceSummary[],
  at = Date.now(),
): SubagentTraceView[] {
  const byId = new Map(existing.map((trace) => [trace.traceId, trace]));
  for (const summary of summaries) {
    const normalized = normalizeSubagentTraceSummary(summary);
    if (!normalized) {
      continue;
    }
    const previous = byId.get(normalized.traceId);
    byId.set(normalized.traceId, {
      ...normalized,
      createdAt: previous?.createdAt ?? at,
      updatedAt: Math.max(previous?.updatedAt ?? 0, at),
    });
  }
  return [...byId.values()];
}

export function reduceSubagentTraceNotification(
  slice: SubagentTraceStoreSlice,
  method: string,
  params: Record<string, unknown>,
  afterMessageId: string | null,
  options?: ReduceSubagentTraceOptions,
): Partial<SubagentTraceStoreSlice> | null {
  if (method === "turn/subagentTraceCreated") {
    const summary = normalizeSubagentTraceSummary(readNestedRecord(params, "summary") ?? params);
    if (!summary) {
      return null;
    }
    const at = parseEventTimestamp(params.timestamp) ?? Date.now();
    return upsertTraceAndLifecycle(slice, summary, at, "started working", afterMessageId);
  }

  if (method === "turn/subagentTraceDelta") {
    const delta = normalizeSubagentTraceDelta(readNestedRecord(params, "delta") ?? params);
    if (!delta) {
      return null;
    }
    const at = parseEventTimestamp(params.timestamp) ?? Date.now();
    const threadId = delta.parent.threadId;
    const existing = slice.subagentTracesByThread[threadId] ?? [];
    const previous = existing.find((trace) => trace.traceId === delta.traceId);
    const activity = activityFromTraceItem(delta.item);
    const nextTrace: SubagentTraceView = previous
      ? {
          ...previous,
          latestActivity: activity ?? previous.latestActivity,
          updatedAt: at,
        }
      : {
          traceId: delta.traceId,
          parent: delta.parent,
          childThreadId: "",
          childTurnId: "",
          title: "Subagent",
          role: "subagent",
          status: "running",
          elapsedMs: 0,
          latestActivity: activity,
          createdAt: at,
          updatedAt: at,
        };
    return {
      subagentTracesByThread: {
        ...slice.subagentTracesByThread,
        [threadId]: upsertTrace(existing, nextTrace),
      },
      subagentLifecycleByThread: appendLifecycleEvent(slice.subagentLifecycleByThread, {
        id: `lifecycle:${delta.traceId}:updated:${at}`,
        traceId: delta.traceId,
        threadId,
        turnId: delta.parent.turnId,
        title: nextTrace.title,
        role: nextTrace.role,
        verb: "updated",
        at,
        afterMessageId,
      }),
    };
  }

  if (method === "turn/subagentTraceStatusChanged") {
    const traceId = stringField(params, "traceId", "trace_id");
    const parent = normalizeParentTurnRef(readNestedRecord(params, "parent") ?? params);
    const status = normalizeSubagentTraceStatus(params.status);
    if (!traceId || !parent || !status) {
      return null;
    }
    const detail = optionalString(params.detail);
    const at = parseEventTimestamp(params.timestamp) ?? Date.now();
    const existing = slice.subagentTracesByThread[parent.threadId] ?? [];
    const previous = existing.find((trace) => trace.traceId === traceId);
    const nextTrace: SubagentTraceView = previous
      ? {
          ...previous,
          status,
          latestActivity: detail ?? previous.latestActivity,
          updatedAt: at,
        }
      : {
          traceId,
          parent,
          childThreadId: "",
          childTurnId: "",
          title: "Subagent",
          role: "subagent",
          status,
          elapsedMs: 0,
          latestActivity: detail,
          createdAt: at,
          updatedAt: at,
        };
    const verb = lifecycleVerbForStatus(status, "statusChanged");
    return {
      subagentTracesByThread: {
        ...slice.subagentTracesByThread,
        [parent.threadId]: upsertTrace(existing, nextTrace),
      },
      subagentLifecycleByThread: verb
        ? appendLifecycleEvent(slice.subagentLifecycleByThread, {
            id: `lifecycle:${traceId}:${verb}:${at}`,
            traceId,
            threadId: parent.threadId,
            turnId: parent.turnId,
            title: nextTrace.title,
            role: nextTrace.role,
            verb,
            at,
            afterMessageId,
          })
        : slice.subagentLifecycleByThread,
    };
  }

  if (method === "turn/subagentTraceCompleted") {
    const summary = normalizeSubagentTraceSummary(readNestedRecord(params, "summary") ?? params);
    if (!summary) {
      return null;
    }
    const at = parseEventTimestamp(params.timestamp) ?? Date.now();
    return upsertTraceAndLifecycle(slice, { ...summary, status: "completed" }, at, "finished", afterMessageId);
  }

  if (method === "turn/subagentTraceFailed") {
    const summary = normalizeSubagentTraceSummary(readNestedRecord(params, "summary") ?? params);
    if (!summary) {
      return null;
    }
    const error = optionalString(params.error);
    const at = parseEventTimestamp(params.timestamp) ?? Date.now();
    return upsertTraceAndLifecycle(
      slice,
      {
        ...summary,
        status: "failed",
        errorSummary: error ?? summary.errorSummary,
        latestActivity: error ?? summary.latestActivity ?? summary.errorSummary,
      },
      at,
      "failed",
      afterMessageId,
    );
  }

  const teamPatch = reduceTeamSubagentNotification(slice, method, params, afterMessageId, options);
  if (teamPatch) {
    return teamPatch;
  }

  return null;
}

function reduceTeamSubagentNotification(
  slice: SubagentTraceStoreSlice,
  method: string,
  params: Record<string, unknown>,
  afterMessageId: string | null,
  options?: ReduceSubagentTraceOptions,
): Partial<SubagentTraceStoreSlice> | null {
  if (method === "team/started") {
    const team = readNestedRecord(params, "team");
    if (!team) {
      return null;
    }
    const teamId = stringField(team, "id", "team_id");
    const leadThreadId =
      stringField(team, "leadThreadId", "lead_thread_id") ?? optionalString(options?.fallbackThreadId);
    if (!teamId || !leadThreadId) {
      return null;
    }
    const at = parseEventTimestamp(params.timestamp) ?? Date.now();
    let nextSlice: SubagentTraceStoreSlice = {
      ...slice,
      teamLeadThreadByTeamId: { ...slice.teamLeadThreadByTeamId, [teamId]: leadThreadId },
    };
    const members = Array.isArray(team.members) ? team.members : [];
    let patch: Partial<SubagentTraceStoreSlice> = {
      teamLeadThreadByTeamId: nextSlice.teamLeadThreadByTeamId,
      teamMemberTitlesByKey: { ...slice.teamMemberTitlesByKey },
    };
    for (const raw of members) {
      if (!isRecord(raw)) {
        continue;
      }
      const memberId = stringField(raw, "id", "member_id");
      const role = optionalString(raw.role) ?? "teammate";
      if (!memberId || isLeadTeamMember(memberId, role)) {
        continue;
      }
      const title = resolveTeamMemberTitleFromDescriptor(raw, memberId, {
        tasks: Array.isArray(team.tasks) ? team.tasks : [],
        resolveThreadTitle: options?.resolveThreadTitle,
      });
      const titleKey = teamMemberTitleKey(teamId, memberId);
      patch = {
        ...patch,
        teamMemberTitlesByKey: { ...(patch.teamMemberTitlesByKey ?? {}), [titleKey]: title },
      };
      nextSlice = { ...nextSlice, ...patch, teamMemberTitlesByKey: patch.teamMemberTitlesByKey! };
      const memberPatch = upsertTeamMemberTrace(nextSlice, {
        teamId,
        memberId,
        threadId: leadThreadId,
        turnId: stringField(raw, "currentTurnId", "current_turn_id") ?? "",
        title,
        role,
        status: mapTeamMemberStatus(raw.status) ?? "running",
        childThreadId: stringField(raw, "threadId", "thread_id") ?? "",
        model: optionalString(raw.model),
        latestActivity: optionalString(raw.finalMessage) ?? optionalString(raw.final_message),
        errorSummary: optionalString(raw.terminalError) ?? optionalString(raw.terminal_error),
        at,
        afterMessageId,
        verb: "started working",
      });
      nextSlice = { ...nextSlice, ...memberPatch };
      patch = { ...patch, ...memberPatch };
    }
    return patch;
  }

  if (method === "team/member/started") {
    const teamId = stringField(params, "teamId", "team_id");
    const member = readNestedRecord(params, "member");
    if (!teamId || !member) {
      return null;
    }
    const memberId = stringField(member, "id", "member_id");
    const role = optionalString(member.role) ?? "teammate";
    if (!memberId || isLeadTeamMember(memberId, role)) {
      return null;
    }
    const threadId =
      stringField(member, "parentThreadId", "parent_thread_id") ??
      slice.teamLeadThreadByTeamId[teamId] ??
      optionalString(options?.fallbackThreadId);
    if (!threadId) {
      return null;
    }
    const title = resolveTeamMemberTitleFromDescriptor(member, memberId, {
      resolveThreadTitle: options?.resolveThreadTitle,
    });
    const at = parseEventTimestamp(params.timestamp) ?? Date.now();
    const titleKey = teamMemberTitleKey(teamId, memberId);
    const withMeta: SubagentTraceStoreSlice = {
      ...slice,
      teamLeadThreadByTeamId: {
        ...slice.teamLeadThreadByTeamId,
        [teamId]: slice.teamLeadThreadByTeamId[teamId] ?? threadId,
      },
      teamMemberTitlesByKey: { ...slice.teamMemberTitlesByKey, [titleKey]: title },
    };
    const memberPatch = upsertTeamMemberTrace(withMeta, {
      teamId,
      memberId,
      threadId,
      turnId: stringField(member, "currentTurnId", "current_turn_id") ?? "",
      title,
      role,
      status: mapTeamMemberStatus(member.status) ?? "running",
      childThreadId: stringField(member, "threadId", "thread_id") ?? "",
      model: optionalString(member.model),
      latestActivity: optionalString(member.finalMessage) ?? optionalString(member.final_message),
      errorSummary: optionalString(member.terminalError) ?? optionalString(member.terminal_error),
      at,
      afterMessageId,
      verb: "started working",
    });
    return {
      teamLeadThreadByTeamId: withMeta.teamLeadThreadByTeamId,
      teamMemberTitlesByKey: withMeta.teamMemberTitlesByKey,
      ...memberPatch,
    };
  }

  if (method === "team/member/messageDelta") {
    const teamId = stringField(params, "teamId", "team_id");
    const memberId = stringField(params, "memberId", "member_id");
    const turnId = stringField(params, "turnId", "turn_id");
    const delta = typeof params.delta === "string" ? params.delta : "";
    if (!teamId || !memberId || !turnId || isLeadTeamMember(memberId, null)) {
      return null;
    }
    const threadId = resolveTeamThreadId(slice, teamId, options);
    if (!threadId) {
      return null;
    }
    const at = parseEventTimestamp(params.timestamp) ?? Date.now();
    const traceId = teamTraceId(teamId, memberId);
    const existing = slice.subagentTracesByThread[threadId] ?? [];
    const previous = existing.find((trace) => trace.traceId === traceId);
    const titleKey = teamMemberTitleKey(teamId, memberId);
    let titlesByKey = slice.teamMemberTitlesByKey;
    let resolvedTitle = titlesByKey[titleKey];
    if (!resolvedTitle) {
      const extracted = memberNameFromTeamText(delta);
      if (extracted) {
        resolvedTitle = humanizeTeamMemberName(extracted);
        titlesByKey = { ...titlesByKey, [titleKey]: resolvedTitle };
      }
    }
    const title = resolvedTitle ?? previous?.title ?? humanizeTeamMemberName(memberId);
    const activity = appendRollingBlurb(previous?.latestActivity, delta);
    const nextTrace: SubagentTraceView = previous
      ? {
          ...previous,
          parent: { threadId, turnId: previous.parent.turnId || turnId },
          title,
          latestActivity: activity,
          status: isSubagentTraceActive(previous.status) ? previous.status : "running",
          updatedAt: at,
        }
      : {
          traceId,
          parent: { threadId, turnId },
          childThreadId: "",
          childTurnId: turnId,
          title,
          role: "teammate",
          status: "running",
          elapsedMs: 0,
          latestActivity: activity,
          createdAt: at,
          updatedAt: at,
        };
    const verb: SubagentLifecycleVerb = previous ? "updated" : "started working";
    return {
      teamMemberTitlesByKey: titlesByKey,
      subagentTracesByThread: {
        ...slice.subagentTracesByThread,
        [threadId]: upsertTrace(existing, nextTrace),
      },
      subagentLifecycleByThread: appendLifecycleEvent(slice.subagentLifecycleByThread, {
        id: `lifecycle:${traceId}:${verb}:${at}`,
        traceId,
        threadId,
        turnId,
        title: nextTrace.title,
        role: nextTrace.role,
        verb,
        at,
        afterMessageId,
      }),
    };
  }

  if (method === "team/member/statusChanged") {
    const teamId = stringField(params, "teamId", "team_id");
    const memberId = stringField(params, "memberId", "member_id");
    const status = mapTeamMemberStatus(params.status);
    if (!teamId || !memberId || !status || isLeadTeamMember(memberId, null)) {
      return null;
    }
    const threadId = resolveTeamThreadId(slice, teamId, options);
    if (!threadId) {
      return null;
    }
    const at = parseEventTimestamp(params.timestamp) ?? Date.now();
    const title =
      slice.teamMemberTitlesByKey[teamMemberTitleKey(teamId, memberId)] ?? humanizeTeamMemberName(memberId);
    return upsertTeamMemberTrace(slice, {
      teamId,
      memberId,
      threadId,
      turnId: "",
      title,
      role: "teammate",
      status,
      at,
      afterMessageId,
      verb: lifecycleVerbForStatus(status, "statusChanged") ?? "updated",
    });
  }

  if (method === "team/member/completed") {
    const teamId = stringField(params, "teamId", "team_id");
    const memberId = stringField(params, "memberId", "member_id");
    if (!teamId || !memberId || isLeadTeamMember(memberId, null)) {
      return null;
    }
    const threadId = resolveTeamThreadId(slice, teamId, options);
    if (!threadId) {
      return null;
    }
    const mappedStatus = mapTeamMemberStatus(params.status) ?? "completed";
    const status: SubagentTraceStatus =
      mappedStatus === "failed" || mappedStatus === "cancelled" ? mappedStatus : "completed";
    const finalMessage =
      optionalString(params.finalMessage) ?? optionalString(params.final_message);
    const error = optionalString(params.error);
    const at = parseEventTimestamp(params.timestamp) ?? Date.now();
    const turnId = stringField(params, "turnId", "turn_id") ?? "";
    const titleKey = teamMemberTitleKey(teamId, memberId);
    let titlesByKey = slice.teamMemberTitlesByKey;
    let resolvedTitle = titlesByKey[titleKey];
    if (!resolvedTitle) {
      const extracted = memberNameFromTeamText(finalMessage) ?? memberNameFromTeamText(error);
      if (extracted) {
        resolvedTitle = humanizeTeamMemberName(extracted);
        titlesByKey = { ...titlesByKey, [titleKey]: resolvedTitle };
      }
    }
    const title = resolvedTitle ?? humanizeTeamMemberName(memberId);
    const verb: SubagentLifecycleVerb =
      status === "failed" || status === "cancelled" ? "failed" : "finished";
    return {
      teamMemberTitlesByKey: titlesByKey,
      ...upsertTeamMemberTrace(slice, {
        teamId,
        memberId,
        threadId,
        turnId,
        title,
        role: "teammate",
        status,
        latestActivity: status === "failed" ? error ?? finalMessage : finalMessage ?? error,
        errorSummary: status === "failed" ? error ?? finalMessage : error,
        at,
        afterMessageId,
        verb,
      }),
    };
  }

  return null;
}

function upsertTeamMemberTrace(
  slice: SubagentTraceStoreSlice,
  input: {
    teamId: string;
    memberId: string;
    threadId: string;
    turnId: string;
    title: string;
    role: string;
    status: SubagentTraceStatus;
    childThreadId?: string;
    model?: string | null;
    latestActivity?: string | null;
    errorSummary?: string | null;
    at: number;
    afterMessageId: string | null;
    verb: SubagentLifecycleVerb;
  },
): Partial<SubagentTraceStoreSlice> {
  const traceId = teamTraceId(input.teamId, input.memberId);
  const existing = slice.subagentTracesByThread[input.threadId] ?? [];
  const previous = existing.find((trace) => trace.traceId === traceId);
  const nextTrace: SubagentTraceView = {
    traceId,
    parent: {
      threadId: input.threadId,
      turnId: input.turnId || previous?.parent.turnId || "",
    },
    childThreadId: input.childThreadId ?? previous?.childThreadId ?? "",
    childTurnId: previous?.childTurnId || input.turnId || "",
    title: input.title,
    role: input.role,
    model: input.model ?? previous?.model,
    status: input.status,
    elapsedMs: previous?.elapsedMs ?? 0,
    latestActivity: input.latestActivity ?? previous?.latestActivity,
    errorSummary: input.errorSummary ?? previous?.errorSummary,
    createdAt: previous?.createdAt ?? input.at,
    updatedAt: input.at,
  };
  return {
    subagentTracesByThread: {
      ...slice.subagentTracesByThread,
      [input.threadId]: upsertTrace(existing, nextTrace),
    },
    subagentLifecycleByThread: appendLifecycleEvent(slice.subagentLifecycleByThread, {
      id: `lifecycle:${traceId}:${input.verb}:${input.at}`,
      traceId,
      threadId: input.threadId,
      turnId: nextTrace.parent.turnId,
      title: nextTrace.title,
      role: nextTrace.role,
      verb: input.verb,
      at: input.at,
      afterMessageId: input.afterMessageId,
    }),
  };
}

export function teamTraceId(teamId: string, memberId: string): string {
  return `team:${teamId}:${memberId}`;
}

/**
 * "haiku_writer" → "Haiku writer", "native-runner-review" → "Native runner review",
 * "member-5" → "Member 5". Known acronyms stay uppercased ("api_docs" → "API docs").
 */
export function humanizeTeamMemberName(raw: string): string {
  const parts = raw.split(/[-_\s]+/).filter(Boolean);
  if (parts.length === 0) {
    return raw;
  }
  return parts
    .map((part, index) => {
      const acronym = uppercasedAcronym(part);
      if (acronym) {
        return acronym;
      }
      const lowered = part.toLowerCase();
      return index === 0 ? `${lowered.slice(0, 1).toUpperCase()}${lowered.slice(1)}` : lowered;
    })
    .join(" ");
}

// Mirrors the acronym handling in roder-skills humanizedSkillNamePart.
function uppercasedAcronym(value: string): string | null {
  switch (value.toLowerCase()) {
    case "ai":
    case "api":
    case "ci":
    case "cd":
    case "css":
    case "dom":
    case "html":
    case "js":
    case "json":
    case "mcp":
    case "sdk":
    case "tdd":
    case "ts":
    case "ui":
    case "url":
      return value.toUpperCase();
    default:
      return null;
  }
}

// Matches "Sender: /root/haiku_writer" / "Task name: /root/file_counter" in
// team payload text; captures the last path segment.
const teamSenderPathPattern = /(?:sender|task name)\s*:\s*\/?(?:[\w.-]+\/)*([A-Za-z][\w-]*)/i;

function memberNameFromTeamText(text: string | null | undefined): string | null {
  if (!text) {
    return null;
  }
  const match = teamSenderPathPattern.exec(text);
  return match?.[1] ?? null;
}

function lastPathSegment(path: string | null): string | null {
  if (!path) {
    return null;
  }
  return path.split("/").filter(Boolean).at(-1) ?? null;
}

function resolveTeamMemberTitleFromDescriptor(
  member: Record<string, unknown>,
  memberId: string,
  context: {
    tasks?: unknown[];
    resolveThreadTitle?: (threadId: string) => string | null;
  },
): string {
  const name = optionalString(member.name);
  if (name) {
    return humanizeTeamMemberName(name);
  }
  const taskName = optionalString(member.taskName) ?? optionalString(member.task_name);
  if (taskName) {
    return humanizeTeamMemberName(lastPathSegment(taskName) ?? taskName);
  }
  const assignedTask = (context.tasks ?? []).find(
    (task) =>
      isRecord(task) &&
      (stringField(task, "assigneeMemberId", "assignee_member_id") ?? "") === memberId &&
      optionalString(task.title),
  );
  if (isRecord(assignedTask)) {
    return humanizeTeamMemberName(optionalString(assignedTask.title)!);
  }
  const agentPathSegment = lastPathSegment(stringField(member, "agentPath", "agent_path"));
  if (agentPathSegment) {
    return humanizeTeamMemberName(agentPathSegment);
  }
  const childThreadId = stringField(member, "threadId", "thread_id");
  const threadTitle = childThreadId ? context.resolveThreadTitle?.(childThreadId) : null;
  if (threadTitle) {
    return humanizeTeamMemberName(threadTitle);
  }
  return humanizeTeamMemberName(memberId);
}

export function teamMemberTitleKey(teamId: string, memberId: string): string {
  return `${teamId}:${memberId}`;
}

export function isLeadTeamMember(memberId: string, role: string | null): boolean {
  if (memberId === LEAD_MEMBER_ID) {
    return true;
  }
  return role === "lead";
}

function resolveTeamThreadId(
  slice: SubagentTraceStoreSlice,
  teamId: string,
  options?: ReduceSubagentTraceOptions,
): string | null {
  return slice.teamLeadThreadByTeamId[teamId] ?? optionalString(options?.fallbackThreadId);
}

function appendRollingBlurb(previous: string | null | undefined, delta: string): string {
  const combined = `${previous ?? ""}${delta}`;
  if (combined.length <= TEAM_ACTIVITY_BLURB_MAX) {
    return combined;
  }
  return combined.slice(-TEAM_ACTIVITY_BLURB_MAX);
}

function mapTeamMemberStatus(value: unknown): SubagentTraceStatus | null {
  if (typeof value !== "string") {
    return null;
  }
  switch (value) {
    case "idle":
      return "queued";
    case "running":
      return "running";
    case "blocked":
      return "waiting_for_approval";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "interrupted":
    case "closed":
    case "cancelled":
      return "cancelled";
    default:
      return normalizeSubagentTraceStatus(value);
  }
}

function upsertTraceAndLifecycle(
  slice: SubagentTraceStoreSlice,
  summary: SubagentTraceSummary,
  at: number,
  verb: SubagentLifecycleVerb,
  afterMessageId: string | null,
): Partial<SubagentTraceStoreSlice> {
  const threadId = summary.parent.threadId;
  const existing = slice.subagentTracesByThread[threadId] ?? [];
  const previous = existing.find((trace) => trace.traceId === summary.traceId);
  const nextTrace: SubagentTraceView = {
    ...summary,
    createdAt: previous?.createdAt ?? at,
    updatedAt: at,
  };
  return {
    subagentTracesByThread: {
      ...slice.subagentTracesByThread,
      [threadId]: upsertTrace(existing, nextTrace),
    },
    subagentLifecycleByThread: appendLifecycleEvent(slice.subagentLifecycleByThread, {
      id: `lifecycle:${summary.traceId}:${verb}:${at}`,
      traceId: summary.traceId,
      threadId,
      turnId: summary.parent.turnId,
      title: summary.title,
      role: summary.role,
      verb,
      at,
      afterMessageId,
    }),
  };
}

function upsertTrace(existing: readonly SubagentTraceView[], next: SubagentTraceView): SubagentTraceView[] {
  const index = existing.findIndex((trace) => trace.traceId === next.traceId);
  if (index === -1) {
    return [...existing, next];
  }
  const copy = [...existing];
  copy[index] = next;
  return copy;
}

function appendLifecycleEvent(
  byThread: SubagentLifecycleByThread,
  event: SubagentLifecycleEvent,
): SubagentLifecycleByThread {
  const existing = byThread[event.threadId] ?? [];
  if (existing.some((entry) => entry.id === event.id)) {
    return byThread;
  }
  // Collapse consecutive "updated" chips for the same trace so the transcript
  // stays readable while still showing start/finish milestones.
  if (event.verb === "updated") {
    const last = existing.at(-1);
    if (last?.traceId === event.traceId && last.verb === "updated") {
      const next = [...existing];
      next[next.length - 1] = event;
      return { ...byThread, [event.threadId]: next };
    }
  }
  return { ...byThread, [event.threadId]: [...existing, event] };
}

function lifecycleVerbForStatus(
  status: SubagentTraceStatus,
  source: "statusChanged",
): SubagentLifecycleVerb | null {
  void source;
  if (status === "running" || status === "queued") {
    return "started working";
  }
  if (status === "completed") {
    return "finished";
  }
  if (status === "failed" || status === "cancelled") {
    return "failed";
  }
  return "updated";
}

export function normalizeSubagentTraceSummary(value: unknown): SubagentTraceSummary | null {
  if (!isRecord(value)) {
    return null;
  }
  const parent = normalizeParentTurnRef(readNestedRecord(value, "parent") ?? value);
  const traceId = stringField(value, "traceId", "trace_id");
  const title = optionalString(value.title) ?? optionalString(value.role) ?? "Subagent";
  const role = optionalString(value.role) ?? "subagent";
  const status = normalizeSubagentTraceStatus(value.status) ?? "running";
  if (!traceId || !parent) {
    return null;
  }
  return {
    traceId,
    parent,
    childThreadId: stringField(value, "childThreadId", "child_thread_id") ?? "",
    childTurnId: stringField(value, "childTurnId", "child_turn_id") ?? "",
    title,
    role,
    model: optionalString(value.model),
    lane: optionalString(value.lane),
    status,
    elapsedMs: numberField(value, "elapsedMs", "elapsed_ms") ?? 0,
    usage: value.usage,
    destination: normalizeDestination(value.destination),
    latestActivity: optionalString(value.latestActivity) ?? optionalString(value.latest_activity),
    errorSummary: optionalString(value.errorSummary) ?? optionalString(value.error_summary),
    exitReason: optionalString(value.exitReason) ?? optionalString(value.exit_reason),
  };
}

function normalizeSubagentTraceDelta(value: unknown): SubagentTraceDelta | null {
  if (!isRecord(value)) {
    return null;
  }
  const parent = normalizeParentTurnRef(readNestedRecord(value, "parent") ?? value);
  const traceId = stringField(value, "traceId", "trace_id");
  const item = normalizeTraceItem(value.item);
  if (!traceId || !parent || !item) {
    return null;
  }
  return { traceId, parent, item };
}

function normalizeParentTurnRef(value: unknown): SubagentTraceSummary["parent"] | null {
  if (!isRecord(value)) {
    return null;
  }
  const threadId = stringField(value, "threadId", "thread_id");
  const turnId = stringField(value, "turnId", "turn_id");
  if (!threadId || !turnId) {
    return null;
  }
  return { threadId, turnId };
}

function normalizeSubagentTraceStatus(value: unknown): SubagentTraceStatus | null {
  if (typeof value !== "string") {
    return null;
  }
  switch (value) {
    case "queued":
    case "running":
    case "waiting_for_approval":
    case "completed":
    case "failed":
    case "cancelled":
      return value;
    default:
      return null;
  }
}

function normalizeDestination(value: unknown): SubagentTraceSummary["destination"] {
  if (!isRecord(value)) {
    return null;
  }
  const kindRaw = optionalString(value.kind);
  const label = optionalString(value.label);
  if (!label) {
    return null;
  }
  const kind =
    kindRaw === "in_process" || kindRaw === "local_worktree" || kindRaw === "remote_runner"
      ? kindRaw
      : "in_process";
  return {
    kind,
    label,
    path: optionalString(value.path),
    providerId: optionalString(value.providerId) ?? optionalString(value.provider_id),
    destinationId: optionalString(value.destinationId) ?? optionalString(value.destination_id),
  };
}

function normalizeTraceItem(value: unknown): SubagentTraceItem | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }
  if (value.type === "message" && typeof value.role === "string") {
    return {
      type: "message",
      role: value.role,
      content: { text: textFromPaged(value.content) },
    };
  }
  if (value.type === "reasoning") {
    return { type: "reasoning", content: { text: textFromPaged(value.content) } };
  }
  if (value.type === "toolCall" || value.type === "tool_call") {
    return {
      type: "toolCall",
      toolId: stringField(value, "toolId", "tool_id") ?? "",
      toolName: stringField(value, "toolName", "tool_name") ?? "tool",
      input: value.input,
    };
  }
  if (value.type === "toolResult" || value.type === "tool_result") {
    return {
      type: "toolResult",
      toolId: stringField(value, "toolId", "tool_id") ?? "",
      isError: Boolean(value.isError ?? value.is_error),
      output: { text: textFromPaged(value.output) },
    };
  }
  if (value.type === "status") {
    const status = normalizeSubagentTraceStatus(value.status) ?? "running";
    return {
      type: "status",
      status,
      detail: optionalString(value.detail),
    };
  }
  return null;
}

function activityFromTraceItem(item: SubagentTraceItem): string | undefined {
  switch (item.type) {
    case "message":
      return singleLine(item.content.text) || undefined;
    case "reasoning":
      return singleLine(item.content.text) ? `thinking: ${singleLine(item.content.text)}` : "thinking";
    case "toolCall":
      return `tool: ${item.toolName}`;
    case "toolResult":
      return item.isError ? "tool error" : "tool result";
    case "status":
      return item.detail?.trim() || item.status;
  }
}

function textFromPaged(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (isRecord(value) && typeof value.text === "string") {
    return value.text;
  }
  return "";
}

function singleLine(text: string): string {
  return text.split(/\r?\n/, 1)[0]?.trim() ?? "";
}

function parseEventTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return normalizedTimestamp(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readNestedRecord(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const nested = value[key];
  return isRecord(nested) ? nested : null;
}

function stringField(value: Record<string, unknown>, camel: string, snake: string): string | null {
  return optionalString(value[camel]) ?? optionalString(value[snake]);
}

function numberField(value: Record<string, unknown>, camel: string, snake: string): number | null {
  const raw = value[camel] ?? value[snake];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

import { conversationIdForMessage } from "@/lib/team-conversations";
import type { RoderTeam, RoderTeamChannelId, RoderTeamMemberStatus, RoderTeamMessage, RoderTeamNotification } from "@/types/team";

export type TeamState = {
  teams: RoderTeam[];
  teamById: Record<string, RoderTeam>;
  activeTeamId: string | null;
  activeChannelId: string | null;
  selectedMessageId: string | null;
  selectedThreadTs: string | null;
  unreadByChannelId: Record<string, number>;
  memberStatusById: Record<string, RoderTeamMemberStatus>;
  schedulerRunning: boolean;
  aggressiveAlwaysOn: boolean;
  messagesByChannel: Record<string, RoderTeamMessage[]>;
};

export type TeamAction =
  | { type: "teams/listed"; teams: RoderTeam[] }
  | { type: "team/loaded"; team: RoderTeam }
  | { type: "team/removed"; teamId: string }
  | { type: "channel/selected"; channelId: string }
  | { type: "message/selected"; messageId: string | null; threadTs?: string | null }
  | { type: "message/received"; message: RoderTeamMessage }
  | { type: "member/status"; memberId: string; status: RoderTeamMemberStatus }
  | { type: "scheduler/set"; running: boolean }
  | { type: "aggressiveAlwaysOn/set"; enabled: boolean }
  | { type: "notification/received"; notification: RoderTeamNotification };

export function initialTeamState(): TeamState {
  return {
    teams: [],
    teamById: {},
    activeTeamId: null,
    activeChannelId: null,
    selectedMessageId: null,
    selectedThreadTs: null,
    unreadByChannelId: {},
    memberStatusById: {},
    schedulerRunning: false,
    aggressiveAlwaysOn: false,
    messagesByChannel: {},
  };
}

export function teamReducer(state: TeamState, action: TeamAction): TeamState {
  switch (action.type) {
    case "teams/listed":
      return mergeTeams(state, action.teams);
    case "team/loaded":
      return loadTeam(state, action.team);
    case "team/removed":
      return removeTeam(state, action.teamId);
    case "channel/selected":
      return selectChannel(state, action.channelId);
    case "message/selected":
      return { ...state, selectedMessageId: action.messageId, selectedThreadTs: action.threadTs ?? null };
    case "message/received":
      return receiveMessage(state, action.message);
    case "member/status":
      return { ...state, memberStatusById: { ...state.memberStatusById, [action.memberId]: action.status } };
    case "scheduler/set":
      return { ...state, schedulerRunning: action.running };
    case "aggressiveAlwaysOn/set":
      return { ...state, aggressiveAlwaysOn: action.enabled };
    case "notification/received":
      return reduceTeamNotification(state, action.notification);
  }
}

function mergeTeams(state: TeamState, teams: RoderTeam[]): TeamState {
  const teamById = { ...state.teamById };
  for (const team of teams) {
    teamById[team.id] = team;
  }
  const activeTeamId = state.activeTeamId && teamById[state.activeTeamId] ? state.activeTeamId : teams[0]?.id ?? state.activeTeamId;
  const activeTeam = activeTeamId ? teamById[activeTeamId] : undefined;
  return {
    ...state,
    teams,
    teamById,
    activeTeamId,
    activeChannelId: state.activeChannelId ?? defaultChannelId(activeTeam),
  };
}

function loadTeam(state: TeamState, team: RoderTeam): TeamState {
  const teams = upsertTeam(state.teams, team);
  const activeChannelId = state.activeTeamId === team.id && state.activeChannelId ? state.activeChannelId : defaultChannelId(team);
  return {
    ...state,
    teams,
    teamById: { ...state.teamById, [team.id]: team },
    activeTeamId: team.id,
    activeChannelId,
    memberStatusById: memberStatuses(team),
    schedulerRunning: team.scheduler_running,
    aggressiveAlwaysOn: team.aggressive_always_on,
    messagesByChannel: groupMessagesByChannel(team.messages),
  };
}

function removeTeam(state: TeamState, teamId: string): TeamState {
  const { [teamId]: _removed, ...teamById } = state.teamById;
  const teams = state.teams.filter((team) => team.id !== teamId);
  const activeTeamId = state.activeTeamId === teamId ? teams[0]?.id ?? null : state.activeTeamId;
  const activeTeam = activeTeamId ? teamById[activeTeamId] : undefined;
  return {
    ...state,
    teams,
    teamById,
    activeTeamId,
    activeChannelId: state.activeTeamId === teamId ? defaultChannelId(activeTeam) : state.activeChannelId,
    selectedMessageId: state.activeTeamId === teamId ? null : state.selectedMessageId,
    selectedThreadTs: state.activeTeamId === teamId ? null : state.selectedThreadTs,
  };
}

function selectChannel(state: TeamState, channelId: string): TeamState {
  const { [channelId]: _read, ...unreadByChannelId } = state.unreadByChannelId;
  return {
    ...state,
    activeChannelId: channelId,
    selectedMessageId: null,
    selectedThreadTs: null,
    unreadByChannelId,
  };
}

function receiveMessage(state: TeamState, message: RoderTeamMessage): TeamState {
  const channelId = conversationIdForMessage(message);
  const currentMessages = state.messagesByChannel[channelId] ?? [];
  const nextMessages = upsertMessage(currentMessages, message);
  const unreadByChannelId =
    channelId === state.activeChannelId
      ? state.unreadByChannelId
      : { ...state.unreadByChannelId, [channelId]: (state.unreadByChannelId[channelId] ?? 0) + 1 };
  return {
    ...state,
    unreadByChannelId,
    messagesByChannel: {
      ...state.messagesByChannel,
      [channelId]: nextMessages,
    },
  };
}

function reduceTeamNotification(state: TeamState, notification: RoderTeamNotification): TeamState {
  const params = notificationParams(notification);
  if ((notification.method === "team/started" || notification.method === "team/updated") && isRecord(params.team)) {
    return loadTeam(state, params.team as RoderTeam);
  }
  if ((notification.method === "team/channel/message" || notification.method === "team/member/message") && isRecord(params.message)) {
    return receiveMessage(state, params.message as RoderTeamMessage);
  }
  if (notification.method === "team/member/statusChanged") {
    const memberId = stringParam(params, "member_id") ?? stringParam(params, "memberId");
    const status = stringParam(params, "status");
    if (memberId && status) {
      return teamReducer(state, { type: "member/status", memberId, status });
    }
  }
  if (notification.method === "team/scheduler/changed" && typeof params.running === "boolean") {
    return teamReducer(state, { type: "scheduler/set", running: params.running });
  }
  if (notification.method === "team/cleanupCompleted") {
    const teamId = stringParam(params, "team_id") ?? stringParam(params, "teamId");
    return teamId ? removeTeam(state, teamId) : state;
  }
  return state;
}

function groupMessagesByChannel(messages: RoderTeamMessage[]): Record<string, RoderTeamMessage[]> {
  const grouped: Record<string, RoderTeamMessage[]> = {};
  for (const message of messages) {
    const channelId = conversationIdForMessage(message);
    grouped[channelId] = upsertMessage(grouped[channelId] ?? [], message);
  }
  return grouped;
}

function memberStatuses(team: RoderTeam): Record<string, RoderTeamMemberStatus> {
  return Object.fromEntries(team.members.map((member) => [member.id, member.status]));
}

function upsertTeam(teams: RoderTeam[], team: RoderTeam): RoderTeam[] {
  const index = teams.findIndex((item) => item.id === team.id);
  if (index === -1) {
    return [team, ...teams].sort(sortTeams);
  }
  const next = [...teams];
  next[index] = team;
  return next.sort(sortTeams);
}

function upsertMessage(messages: RoderTeamMessage[], message: RoderTeamMessage): RoderTeamMessage[] {
  const index = messages.findIndex((item) => item.id === message.id);
  if (index === -1) {
    return [...messages, message].sort(sortMessages);
  }
  const next = [...messages];
  next[index] = message;
  return next.sort(sortMessages);
}

function sortTeams(left: RoderTeam, right: RoderTeam): number {
  return timestampMs(right.updated_at) - timestampMs(left.updated_at);
}

function sortMessages(left: RoderTeamMessage, right: RoderTeamMessage): number {
  return timestampMs(left.created_at) - timestampMs(right.created_at);
}

function defaultChannelId(team: RoderTeam | undefined): RoderTeamChannelId | null {
  return team?.channels.find((channel) => channel.id === "general")?.id ?? team?.channels[0]?.id ?? null;
}

function notificationParams(notification: RoderTeamNotification): Record<string, unknown> {
  return isRecord(notification.params) ? notification.params : {};
}

function stringParam(params: Record<string, unknown>, key: string): string | null {
  return typeof params[key] === "string" ? params[key] : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function timestampMs(value: number | string | null | undefined): number {
  if (typeof value === "number") {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

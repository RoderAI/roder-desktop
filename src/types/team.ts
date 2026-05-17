import type { GodeModel, GodeNotification } from "./gode";

export type RoderTeamId = string;
export type RoderTeamChannelId = string;
export type RoderTeamMemberId = string;
export type RoderTeamMessageId = string;

export type RoderTeamMemberStatus = "idle" | "working" | "blocked" | "offline" | "error" | string;

export type RoderTeamMember = {
  id: RoderTeamMemberId;
  name?: string;
  display_name?: string;
  role: string;
  status: RoderTeamMemberStatus;
  provider: string;
  model: string;
  worktree_path?: string | null;
  thread_id?: string | null;
  last_active_at?: number | null;
};

export type RoderTeamChannel = {
  id: RoderTeamChannelId;
  name: string;
  description?: string | null;
  topic?: string | null;
};

export type RoderTeamMessageAuthorKind = "user" | "member" | "system" | string;

export type RoderTeamMessage = {
  id: RoderTeamMessageId;
  team_id: RoderTeamId;
  channel_id?: RoderTeamChannelId | null;
  author_kind: RoderTeamMessageAuthorKind;
  author_member_id?: RoderTeamMemberId | null;
  target_member_id?: RoderTeamMemberId | null;
  text: string;
  thread_ts?: string | null;
  turn_id?: string | null;
  created_at: number | string;
  updated_at?: number | string | null;
};

export type RoderTeam = {
  id: RoderTeamId;
  name: string;
  workspace?: string | null;
  provider: string;
  model: string;
  channels: RoderTeamChannel[];
  members: RoderTeamMember[];
  messages: RoderTeamMessage[];
  scheduler_running: boolean;
  aggressive_always_on: boolean;
  created_at: number | string;
  updated_at: number | string;
};

export type TeamStartParams = {
  name?: string | null;
  workspace?: string | null;
  provider?: string | null;
  model?: string | null;
};

export type TeamStartResult = {
  team: RoderTeam;
};

export type TeamListResult = {
  teams?: RoderTeam[];
  data?: RoderTeam[];
};

export type TeamReadParams = {
  team_id: RoderTeamId;
};

export type TeamReadResult = {
  team: RoderTeam;
};

export type TeamChannelMessageParams = {
  team_id: RoderTeamId;
  channel_id: RoderTeamChannelId;
  text: string;
  author_member_id?: RoderTeamMemberId | null;
  project_context?: string | null;
  thread_ts?: string | null;
};

export type TeamChannelMessageResult = {
  message: RoderTeamMessage;
  team?: RoderTeam;
};

export type TeamMemberMessageParams = {
  team_id: RoderTeamId;
  member_id: RoderTeamMemberId;
  channel_id?: RoderTeamChannelId | null;
  text: string;
};

export type TeamMemberMessageResult = {
  member: RoderTeamMember;
  message?: RoderTeamMessage;
  turn_id?: string | null;
  team?: RoderTeam;
};

export type TeamMemberInterruptParams = {
  team_id: RoderTeamId;
  member_id: RoderTeamMemberId;
};

export type TeamMemberInterruptResult = {
  member: RoderTeamMember;
  team?: RoderTeam;
};

export type TeamSchedulerSetParams = {
  team_id: RoderTeamId;
  running: boolean;
};

export type TeamSchedulerSetResult = {
  team: RoderTeam;
};

export type TeamCleanupParams = {
  team_id: RoderTeamId;
};

export type TeamCleanupResult = {
  team_id?: RoderTeamId;
  cleaned?: boolean;
};

export type TeamModelListResult = {
  models?: GodeModel[];
};

export type RoderTeamNotification = GodeNotification;

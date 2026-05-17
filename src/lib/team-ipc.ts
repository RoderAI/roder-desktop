import type {
  TeamChannelMessageParams,
  TeamChannelMessageResult,
  TeamCleanupResult,
  TeamListResult,
  TeamMemberInterruptResult,
  TeamMemberMessageParams,
  TeamMemberMessageResult,
  TeamModelListResult,
  TeamReadResult,
  TeamSchedulerSetResult,
  TeamStartParams,
  TeamStartResult,
} from "@/types/team";

export type SendChannelMessageInput = {
  teamId: string;
  channelId: string;
  text: string;
  authorMemberId?: string | null;
  projectContext?: string | null;
  threadTs?: string | null;
};

export type SendMemberMessageInput = {
  teamId: string;
  memberId: string;
  channelId?: string | null;
  text: string;
};

export const teamIpc = {
  listModels: () => window.godeDesktop.request("model/list", {}) as Promise<TeamModelListResult>,
  startTeam: (params: TeamStartParams = {}) => window.godeDesktop.request("team/start", params) as Promise<TeamStartResult>,
  listTeams: () => window.godeDesktop.request("team/list", {}) as Promise<TeamListResult>,
  readTeam: (teamId: string) => window.godeDesktop.request("team/read", { team_id: teamId }) as Promise<TeamReadResult>,
  sendChannelMessage: (input: SendChannelMessageInput) =>
    window.godeDesktop.request("team/channel/message", channelMessageParams(input)) as Promise<TeamChannelMessageResult>,
  sendMemberMessage: (input: SendMemberMessageInput) =>
    window.godeDesktop.request("team/member/message", memberMessageParams(input)) as Promise<TeamMemberMessageResult>,
  interruptMember: (teamId: string, memberId: string) =>
    window.godeDesktop.request("team/member/interrupt", { team_id: teamId, member_id: memberId }) as Promise<TeamMemberInterruptResult>,
  setScheduler: (teamId: string, running: boolean) =>
    window.godeDesktop.request("team/scheduler/set", { team_id: teamId, running }) as Promise<TeamSchedulerSetResult>,
  cleanupTeam: (teamId: string) => window.godeDesktop.request("team/cleanup", { team_id: teamId }) as Promise<TeamCleanupResult>,
};

function channelMessageParams(input: SendChannelMessageInput): TeamChannelMessageParams {
  return {
    team_id: input.teamId,
    channel_id: input.channelId,
    text: input.text,
    author_member_id: input.authorMemberId ?? null,
    project_context: input.projectContext ?? null,
    thread_ts: input.threadTs ?? null,
  };
}

function memberMessageParams(input: SendMemberMessageInput): TeamMemberMessageParams {
  return {
    team_id: input.teamId,
    member_id: input.memberId,
    channel_id: input.channelId ?? null,
    text: input.text,
  };
}

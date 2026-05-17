import { create } from "zustand";
import { teamIpc, type SendChannelMessageInput, type SendMemberMessageInput } from "@/lib/team-ipc";
import { initialTeamState, teamReducer, type TeamState } from "@/lib/team-reducer";
import { recordDebugEvent } from "@/stores/debug-event-store";
import type { GodeModel } from "@/types/gode";
import type { RoderTeam, RoderTeamNotification } from "@/types/team";

type TeamStore = TeamState & {
  models: GodeModel[];
  busy: boolean;
  hydrated: boolean;
  error: string | null;
  bootstrap: () => Promise<void>;
  refreshTeams: () => Promise<void>;
  selectTeam: (teamId: string) => Promise<void>;
  selectChannel: (channelId: string) => void;
  selectMessage: (messageId: string | null, threadTs?: string | null) => void;
  sendChannelMessage: (input: SendChannelMessageInput) => Promise<void>;
  sendMemberMessage: (input: SendMemberMessageInput) => Promise<void>;
  interruptMember: (memberId: string) => Promise<void>;
  setSchedulerRunning: (running: boolean) => Promise<void>;
  setAggressiveAlwaysOn: (enabled: boolean) => void;
  cleanupTeam: (teamId?: string) => Promise<void>;
  applyNotification: (notification: RoderTeamNotification) => void;
};

const codexGpt55Error = "codex/gpt-5.5 is not available in model/list; refusing to silently fall back.";
const memberReplyPollIntervalMs = 500;
const memberReplyPollTimeoutMs = 45_000;
const channelReplyPollIntervalMs = 500;
const channelReplyPollTimeoutMs = 45_000;

export const useTeamStore = create<TeamStore>()((set, get) => ({
  ...initialTeamState(),
  models: [],
  busy: false,
  hydrated: false,
  error: null,

  bootstrap: async () => {
    recordDebugEvent({ source: "team-store", event: "bootstrap:start" });
    set({ busy: true, error: null });
    try {
      const [teamResult, modelResult] = await Promise.all([teamIpc.listTeams(), teamIpc.listModels()]);
      const models = modelResult.models ?? [];
      const teams = teamResult.teams ?? teamResult.data ?? [];

      set((state) => ({
        ...teamReducer(state, { type: "teams/listed", teams }),
        models,
      }));

      if (teams.length > 0) {
        await get().selectTeam(get().activeTeamId ?? teams[0]?.id ?? "");
        recordDebugEvent({ source: "team-store", event: "bootstrap:existing-team", payload: { teamCount: teams.length } });
        set({ busy: false, hydrated: true, error: null });
        return;
      }

      if (!hasCodexGpt55(models)) {
        recordDebugEvent({ source: "team-store", event: "bootstrap:model-missing", level: "error", payload: { modelCount: models.length } });
        set({ busy: false, hydrated: true, error: codexGpt55Error });
        return;
      }

      const started = await teamIpc.startTeam({ provider: "codex", model: "gpt-5.5" });
      recordDebugEvent({ source: "team-store", event: "bootstrap:started", payload: { teamId: started.team.id } });
      set((state) => ({
        ...teamReducer(state, { type: "team/loaded", team: started.team }),
        busy: false,
        hydrated: true,
        error: null,
      }));
    } catch (error) {
      recordDebugEvent({ source: "team-store", event: "bootstrap:error", level: "error", payload: { error: (error as Error).message } });
      set({ busy: false, hydrated: true, error: (error as Error).message });
    }
  },

  refreshTeams: async () => {
    const result = await teamIpc.listTeams();
    set((state) => teamReducer(state, { type: "teams/listed", teams: result.teams ?? result.data ?? [] }));
  },

  selectTeam: async (teamId) => {
    if (!teamId) {
      return;
    }
    set({ busy: true, error: null });
    try {
      const result = await teamIpc.readTeam(teamId);
      set((state) => ({
        ...teamReducer(state, { type: "team/loaded", team: result.team }),
        busy: false,
      }));
    } catch (error) {
      set({ busy: false, error: (error as Error).message });
    }
  },

  selectChannel: (channelId) => {
    recordDebugEvent({ source: "team-store", event: "channel:selected", payload: { channelId } });
    set((state) => teamReducer(state, { type: "channel/selected", channelId }));
  },
  selectMessage: (messageId, threadTs = null) => set((state) => teamReducer(state, { type: "message/selected", messageId, threadTs })),

  sendChannelMessage: async (input) => {
    recordDebugEvent({ source: "ipc", event: "team/channel/message:request", payload: input });
    set({ error: null });
    try {
      const result = await teamIpc.sendChannelMessage(input);
      recordDebugEvent({
        source: "ipc",
        event: "team/channel/message:response",
        payload: { messageId: result.message.id, channelId: result.message.channel_id, teamMessageCount: result.team?.messages.length },
      });
      set((state) => {
        const withTeam = result.team ? teamReducer(state, { type: "team/loaded", team: result.team }) : state;
        return teamReducer(withTeam, { type: "message/received", message: result.message });
      });
      if (result.message.author_kind === "user") {
        void pollForChannelReplies({
          teamId: input.teamId,
          channelId: input.channelId,
          promptCreatedAt: result.message.created_at,
          activeTeamId: () => get().activeTeamId,
          applyTeam: (team) => set((state) => teamReducer(state, { type: "team/loaded", team })),
        });
      }
    } catch (error) {
      recordDebugEvent({ source: "ipc", event: "team/channel/message:error", level: "error", payload: { error: (error as Error).message, input } });
      set({ error: (error as Error).message });
    }
  },

  sendMemberMessage: async (input) => {
    recordDebugEvent({ source: "ipc", event: "team/member/message:request", payload: input });
    set({ error: null });
    try {
      const result = await teamIpc.sendMemberMessage(input);
      recordDebugEvent({
        source: "ipc",
        event: "team/member/message:response",
        payload: { memberId: result.member.id, status: result.member.status, messageId: result.message?.id, turnId: result.turn_id },
      });
      set((state) => {
        const withTeam = result.team ? teamReducer(state, { type: "team/loaded", team: result.team }) : state;
        const withMember = teamReducer(withTeam, { type: "member/status", memberId: result.member.id, status: result.member.status });
        return result.message ? teamReducer(withMember, { type: "message/received", message: result.message }) : withMember;
      });
      if (result.turn_id) {
        void pollForMemberReply({
          teamId: input.teamId,
          memberId: result.member.id,
          turnId: result.turn_id,
          activeTeamId: () => get().activeTeamId,
          applyTeam: (team) => set((state) => teamReducer(state, { type: "team/loaded", team })),
        });
      }
    } catch (error) {
      recordDebugEvent({ source: "ipc", event: "team/member/message:error", level: "error", payload: { error: (error as Error).message, input } });
      set({ error: (error as Error).message });
    }
  },

  interruptMember: async (memberId) => {
    const teamId = get().activeTeamId;
    if (!teamId) {
      return;
    }
    set({ error: null });
    try {
      const result = await teamIpc.interruptMember(teamId, memberId);
      set((state) => {
        const withTeam = result.team ? teamReducer(state, { type: "team/loaded", team: result.team }) : state;
        return teamReducer(withTeam, { type: "member/status", memberId: result.member.id, status: result.member.status });
      });
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  setSchedulerRunning: async (running) => {
    const teamId = get().activeTeamId;
    if (!teamId) {
      return;
    }
    set({ error: null });
    try {
      const result = await teamIpc.setScheduler(teamId, running);
      set((state) => teamReducer(state, { type: "team/loaded", team: result.team }));
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  setAggressiveAlwaysOn: (enabled) => set((state) => teamReducer(state, { type: "aggressiveAlwaysOn/set", enabled })),

  cleanupTeam: async (teamId = get().activeTeamId ?? "") => {
    if (!teamId) {
      return;
    }
    set({ error: null });
    try {
      await teamIpc.cleanupTeam(teamId);
      set((state) => teamReducer(state, { type: "team/removed", teamId }));
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  applyNotification: (notification) => {
    recordDebugEvent({ source: "notification", event: notification.method, payload: notification.params });
    set((state) => teamReducer(state, { type: "notification/received", notification }));
  },
}));

function hasCodexGpt55(models: GodeModel[]): boolean {
  return models.some((model) => model.id === "codex/gpt-5.5" || (model.modelProvider === "codex" && model.id === "gpt-5.5"));
}

type MemberReplyPollOptions = {
  teamId: string;
  memberId: string;
  turnId: string;
  activeTeamId: () => string | null;
  applyTeam: (team: RoderTeam) => void;
};

async function pollForMemberReply(options: MemberReplyPollOptions): Promise<void> {
  const startedAt = Date.now();
  let attempt = 0;
  recordDebugEvent({
    source: "team-store",
    event: "team/member/reply:poll-start",
    payload: { teamId: options.teamId, memberId: options.memberId, turnId: options.turnId },
  });

  while (Date.now() - startedAt < memberReplyPollTimeoutMs) {
    await sleep(memberReplyPollIntervalMs);
    attempt += 1;

    try {
      const result = await teamIpc.readTeam(options.teamId);
      const team = result.team;
      if (options.activeTeamId() === options.teamId) {
        options.applyTeam(team);
      }

      if (hasMemberReplyForTurn(team, options.memberId, options.turnId)) {
        recordDebugEvent({
          source: "team-store",
          event: "team/member/reply:received",
          payload: { teamId: options.teamId, memberId: options.memberId, turnId: options.turnId, attempt },
        });
        return;
      }

      const status = team.members.find((member) => member.id === options.memberId)?.status;
      recordDebugEvent({
        source: "team-store",
        event: "team/member/reply:poll",
        payload: { teamId: options.teamId, memberId: options.memberId, turnId: options.turnId, attempt, status },
      });
      if (status && status !== "working") {
        recordDebugEvent({
          source: "team-store",
          event: "team/member/reply:stopped",
          payload: { teamId: options.teamId, memberId: options.memberId, turnId: options.turnId, attempt, status },
        });
        return;
      }
    } catch (error) {
      recordDebugEvent({
        source: "team-store",
        event: "team/member/reply:poll-error",
        level: "error",
        payload: { teamId: options.teamId, memberId: options.memberId, turnId: options.turnId, attempt, error: (error as Error).message },
      });
      return;
    }
  }

  recordDebugEvent({
    source: "team-store",
    event: "team/member/reply:timeout",
    level: "warn",
    payload: { teamId: options.teamId, memberId: options.memberId, turnId: options.turnId },
  });
}

type ChannelRepliesPollOptions = {
  teamId: string;
  channelId: string;
  promptCreatedAt: number | string;
  activeTeamId: () => string | null;
  applyTeam: (team: RoderTeam) => void;
};

async function pollForChannelReplies(options: ChannelRepliesPollOptions): Promise<void> {
  const startedAt = Date.now();
  let attempt = 0;
  recordDebugEvent({
    source: "team-store",
    event: "team/channel/replies:poll-start",
    payload: { teamId: options.teamId, channelId: options.channelId },
  });

  while (Date.now() - startedAt < channelReplyPollTimeoutMs) {
    await sleep(channelReplyPollIntervalMs);
    attempt += 1;

    try {
      const result = await teamIpc.readTeam(options.teamId);
      const team = result.team;
      if (options.activeTeamId() === options.teamId) {
        options.applyTeam(team);
      }

      const replies = channelRepliesAfter(team, options.channelId, options.promptCreatedAt);
      const working = team.members.filter((member) => member.status === "working").length;
      recordDebugEvent({
        source: "team-store",
        event: "team/channel/replies:poll",
        payload: { teamId: options.teamId, channelId: options.channelId, attempt, replies: replies.length, working },
      });

      if (replies.length > 0 && working === 0) {
        recordDebugEvent({
          source: "team-store",
          event: "team/channel/replies:received",
          payload: { teamId: options.teamId, channelId: options.channelId, attempt, replies: replies.length },
        });
        return;
      }

      if (attempt > 1 && working === 0) {
        recordDebugEvent({
          source: "team-store",
          event: "team/channel/replies:stopped",
          payload: { teamId: options.teamId, channelId: options.channelId, attempt, replies: replies.length },
        });
        return;
      }
    } catch (error) {
      recordDebugEvent({
        source: "team-store",
        event: "team/channel/replies:poll-error",
        level: "error",
        payload: { teamId: options.teamId, channelId: options.channelId, attempt, error: (error as Error).message },
      });
      return;
    }
  }

  recordDebugEvent({
    source: "team-store",
    event: "team/channel/replies:timeout",
    level: "warn",
    payload: { teamId: options.teamId, channelId: options.channelId },
  });
}

function hasMemberReplyForTurn(team: RoderTeam, memberId: string, turnId: string): boolean {
  return team.messages.some(
    (message) => message.author_kind === "member" && message.author_member_id === memberId && message.turn_id === turnId,
  );
}

function channelRepliesAfter(team: RoderTeam, channelId: string, promptCreatedAt: number | string): RoderTeam["messages"] {
  const promptTime = timestampMs(promptCreatedAt);
  return team.messages.filter(
    (message) => message.author_kind === "member" && message.channel_id === channelId && timestampMs(message.created_at) >= promptTime,
  );
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

import { create } from "zustand";
import { teamIpc, type SendChannelMessageInput, type SendMemberMessageInput } from "@/lib/team-ipc";
import { initialTeamState, teamReducer, type TeamState } from "@/lib/team-reducer";
import type { GodeModel } from "@/types/gode";
import type { RoderTeamNotification } from "@/types/team";

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

export const useTeamStore = create<TeamStore>()((set, get) => ({
  ...initialTeamState(),
  models: [],
  busy: false,
  hydrated: false,
  error: null,

  bootstrap: async () => {
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
        set({ busy: false, hydrated: true, error: null });
        return;
      }

      if (!hasCodexGpt55(models)) {
        set({ busy: false, hydrated: true, error: codexGpt55Error });
        return;
      }

      const started = await teamIpc.startTeam({ provider: "codex", model: "gpt-5.5" });
      set((state) => ({
        ...teamReducer(state, { type: "team/loaded", team: started.team }),
        busy: false,
        hydrated: true,
        error: null,
      }));
    } catch (error) {
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

  selectChannel: (channelId) => set((state) => teamReducer(state, { type: "channel/selected", channelId })),
  selectMessage: (messageId, threadTs = null) => set((state) => teamReducer(state, { type: "message/selected", messageId, threadTs })),

  sendChannelMessage: async (input) => {
    set({ error: null });
    try {
      const result = await teamIpc.sendChannelMessage(input);
      set((state) => {
        const withTeam = result.team ? teamReducer(state, { type: "team/loaded", team: result.team }) : state;
        return teamReducer(withTeam, { type: "message/received", message: result.message });
      });
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  sendMemberMessage: async (input) => {
    set({ error: null });
    try {
      const result = await teamIpc.sendMemberMessage(input);
      set((state) => {
        const withTeam = result.team ? teamReducer(state, { type: "team/loaded", team: result.team }) : state;
        const withMember = teamReducer(withTeam, { type: "member/status", memberId: result.member.id, status: result.member.status });
        return result.message ? teamReducer(withMember, { type: "message/received", message: result.message }) : withMember;
      });
    } catch (error) {
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

  applyNotification: (notification) => set((state) => teamReducer(state, { type: "notification/received", notification })),
}));

function hasCodexGpt55(models: GodeModel[]): boolean {
  return models.some((model) => model.id === "codex/gpt-5.5" || (model.modelProvider === "codex" && model.id === "gpt-5.5"));
}

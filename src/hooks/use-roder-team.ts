import { useEffect } from "react";
import { godeIpc } from "@/lib/gode-ipc";
import { useTeamStore } from "@/stores/team-store";
import type { RoderTeamMessage } from "@/types/team";

const emptyMessages: RoderTeamMessage[] = [];

export function useRoderTeam() {
  useRoderTeamBootstrap();
  const teams = useTeamStore((state) => state.teams);
  const teamById = useTeamStore((state) => state.teamById);
  const activeTeamId = useTeamStore((state) => state.activeTeamId);
  const activeChannelId = useTeamStore((state) => state.activeChannelId);
  const selectedMessageId = useTeamStore((state) => state.selectedMessageId);
  const selectedThreadTs = useTeamStore((state) => state.selectedThreadTs);
  const unreadByChannelId = useTeamStore((state) => state.unreadByChannelId);
  const memberStatusById = useTeamStore((state) => state.memberStatusById);
  const schedulerRunning = useTeamStore((state) => state.schedulerRunning);
  const aggressiveAlwaysOn = useTeamStore((state) => state.aggressiveAlwaysOn);
  const busy = useTeamStore((state) => state.busy);
  const hydrated = useTeamStore((state) => state.hydrated);
  const error = useTeamStore((state) => state.error);
  const refreshTeams = useTeamStore((state) => state.refreshTeams);
  const selectTeam = useTeamStore((state) => state.selectTeam);
  const selectChannel = useTeamStore((state) => state.selectChannel);
  const selectMessage = useTeamStore((state) => state.selectMessage);
  const sendChannelMessage = useTeamStore((state) => state.sendChannelMessage);
  const sendMemberMessage = useTeamStore((state) => state.sendMemberMessage);
  const interruptMember = useTeamStore((state) => state.interruptMember);
  const setSchedulerRunning = useTeamStore((state) => state.setSchedulerRunning);
  const setAggressiveAlwaysOn = useTeamStore((state) => state.setAggressiveAlwaysOn);
  const cleanupTeam = useTeamStore((state) => state.cleanupTeam);
  const activeTeam = activeTeamId ? (teamById[activeTeamId] ?? null) : null;
  const activeMessages = useTeamStore((state) =>
    state.activeChannelId ? (state.messagesByChannel[state.activeChannelId] ?? emptyMessages) : emptyMessages,
  );

  return {
    teams,
    teamById,
    activeTeamId,
    activeChannelId,
    activeTeam,
    activeMessages,
    selectedMessageId,
    selectedThreadTs,
    unreadByChannelId,
    memberStatusById,
    schedulerRunning,
    aggressiveAlwaysOn,
    busy,
    hydrated,
    error,
    refreshTeams,
    selectTeam,
    selectChannel,
    selectMessage,
    sendChannelMessage,
    sendMemberMessage,
    interruptMember,
    setSchedulerRunning,
    setAggressiveAlwaysOn,
    cleanupTeam,
  };
}

function useRoderTeamBootstrap(): void {
  const bootstrap = useTeamStore((state) => state.bootstrap);
  const applyNotification = useTeamStore((state) => state.applyNotification);

  useEffect(() => {
    const offNotification = godeIpc.onNotification(applyNotification);
    void bootstrap();
    return () => {
      offNotification();
    };
  }, [applyNotification, bootstrap]);
}

import { useMemo } from "react";
import { dmChannelId, memberIdFromDmChannelId } from "@/lib/team-conversations";
import { DEFAULT_TEAM_APP_SHORTCUTS, DEFAULT_TEAM_CHANNELS } from "@/lib/team-view-model";
import { AppShortcuts } from "./app-shortcuts";
import { ChannelHeader } from "./channel-header";
import { ChannelSidebar } from "./channel-sidebar";
import { MessageTimeline } from "./message-timeline";
import { RightDrawer } from "./right-drawer";
import { TeamComposer } from "./team-composer";
import { WorkspaceRail } from "./workspace-rail";
import type { TeamDrawer, TeamShellProps } from "./types";

export function TeamShell({
  team,
  activeChannelId,
  messages,
  members,
  debugEvents,
  activeDrawer,
  schedulerRunning,
  onSelectChannel,
  onSendChannelMessage,
  onSendMemberDM,
  onToggleScheduler,
  onOpenAppDrawer,
  onOpenDrawer,
  onClearDebugEvents,
  onStopMember,
}: TeamShellProps): React.JSX.Element {
  const channels = team.channels?.length ? team.channels : DEFAULT_TEAM_CHANNELS;
  const activeDmMemberId = memberIdFromDmChannelId(activeChannelId);
  const activeDmMember = activeDmMemberId ? members.find((member) => member.id === activeDmMemberId) : undefined;
  const activeChannel =
    activeDmMember ?
      { id: dmChannelId(activeDmMember.id), name: activeDmMember.name, topic: activeDmMember.title ?? "Direct message" }
    : channels.find((channel) => channel.id === activeChannelId) ?? channels[0] ?? DEFAULT_TEAM_CHANNELS[0];
  const channelMessages = messages.filter((message) => message.channelId === activeChannel.id);
  const membersById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const shortcuts = team.appShortcuts?.length ? team.appShortcuts : DEFAULT_TEAM_APP_SHORTCUTS;
  const handleComposerSend = activeDmMember
    ? (_channelId: string, body: string) => onSendMemberDM(activeDmMember.id, body)
    : onSendChannelMessage;

  return (
    <div className="flex h-full w-full overflow-hidden bg-background text-foreground">
      <WorkspaceRail team={team} schedulerRunning={schedulerRunning} onToggleScheduler={onToggleScheduler} />
      <ChannelSidebar
        team={team}
        channels={channels}
        activeChannelId={activeChannel.id}
        members={members}
        onSelectChannel={onSelectChannel}
        onSelectMemberDm={(memberId) => onSelectChannel(dmChannelId(memberId))}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <ChannelHeader
          channel={activeChannel}
          memberCount={members.length}
          activeDrawer={activeDrawer}
          onOpenDetails={() => onOpenDrawer?.({ type: "details" })}
          onOpenMembers={() => onOpenDrawer?.({ type: "members" })}
        />
        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col">
            <MessageTimeline messages={channelMessages} membersById={membersById} />
            <AppShortcuts shortcuts={shortcuts} onOpenAppDrawer={onOpenAppDrawer} />
            <TeamComposer
              channelId={activeChannel.id}
              channelName={activeChannel.name}
              members={members}
              placeholder={activeDmMember ? `Message ${activeDmMember.name}` : undefined}
              onSendChannelMessage={handleComposerSend}
            />
          </section>
          <RightDrawer
            drawer={normalizeDrawer(activeDrawer)}
            channel={activeChannel}
            members={members}
            schedulerRunning={schedulerRunning}
            debugEvents={debugEvents}
            onOpenAppDrawer={onOpenAppDrawer}
            onOpenDrawer={onOpenDrawer}
            onSendMemberDM={onSendMemberDM}
            onClearDebugEvents={onClearDebugEvents}
            onStopMember={onStopMember}
          />
        </div>
      </main>
    </div>
  );
}

function normalizeDrawer(drawer: TeamDrawer): TeamDrawer {
  return drawer;
}

import { ChevronDown, Circle, Hash, Headphones, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dmChannelId } from "@/lib/team-conversations";
import { cn } from "@/lib/utils";
import { LOCAL_MEMBER_ID, SYSTEM_MEMBER_ID, type TeamChannel } from "@/lib/team-view-model";
import type { TeamMember, TeamShellTeam } from "./types";
import { MemberAvatar } from "./member-avatar";

type ChannelSidebarProps = {
  team: TeamShellTeam;
  channels: TeamChannel[];
  activeChannelId: string;
  members: TeamMember[];
  onSelectChannel: (channelId: string) => void;
  onSelectMemberDm: (memberId: string) => void;
};

export function ChannelSidebar({
  team,
  channels,
  activeChannelId,
  members,
  onSelectChannel,
  onSelectMemberDm,
}: ChannelSidebarProps): React.JSX.Element {
  const visibleMembers = members.filter((member) => member.id !== SYSTEM_MEMBER_ID && member.id !== LOCAL_MEMBER_ID).slice(0, 7);

  return (
    <aside className="team-scrollbar flex h-screen w-[270px] shrink-0 flex-col overflow-y-auto border-r border-border bg-sidebar text-sidebar-foreground">
      <div className="drag-region flex h-[56px] items-center border-b border-border px-4">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-sidebar-active-foreground">{team.name}</div>
          <div className="truncate text-xs text-sidebar-heading">{team.subtitle ?? "Product workspace"}</div>
        </div>
        <Button variant="ghost" size="icon" className="no-drag ml-auto size-8 text-sidebar-foreground" aria-label="Workspace menu">
          <MoreHorizontal className="size-4" />
        </Button>
      </div>
      <div className="no-drag px-3 py-3">
        <button className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-sidebar-accent">
          <Headphones className="size-4" />
          Huddles
          <span className="ml-auto rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] text-emerald-600">live</span>
        </button>
      </div>
      <SidebarSection title="Channels">
        {channels.map((channel) => (
          <button
            key={channel.id}
            type="button"
            className={cn(
              "group flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-sidebar-accent",
              activeChannelId === channel.id && "bg-sidebar-active font-medium text-sidebar-active-foreground",
            )}
            onClick={() => onSelectChannel(channel.id)}
          >
            <Hash className="size-3.5 shrink-0 opacity-70" />
            <span className="min-w-0 flex-1 truncate">{channel.name}</span>
            {channel.mentionCount ? (
              <span className="rounded-full bg-rose-600 px-1.5 text-[11px] font-semibold text-white">{channel.mentionCount}</span>
            ) : channel.unreadCount ? (
              <span className="text-[11px] text-sidebar-heading">{channel.unreadCount}</span>
            ) : null}
          </button>
        ))}
        <button className="mt-1 flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] text-sidebar-heading hover:bg-sidebar-accent">
          <Plus className="size-3.5" />
          Add channel
        </button>
      </SidebarSection>
      <SidebarSection title="Direct messages">
        {visibleMembers.map((member) => {
          const channelId = dmChannelId(member.id);
          return (
            <button
              key={member.id}
              type="button"
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-sidebar-accent",
                activeChannelId === channelId && "bg-sidebar-active font-medium text-sidebar-active-foreground",
              )}
              onClick={() => onSelectMemberDm(member.id)}
            >
              <MemberAvatar member={member} size="sm" />
              <span className="min-w-0 flex-1 truncate">{member.name}</span>
              {member.unreadCount ? <span className="text-[11px] text-sidebar-heading">{member.unreadCount}</span> : null}
            </button>
          );
        })}
      </SidebarSection>
      <div className="no-drag mt-auto border-t border-border p-3">
        <div className="flex items-center gap-2 rounded-lg bg-sidebar-accent px-3 py-2 text-xs text-sidebar-heading">
          <Circle className="size-2.5 fill-emerald-500 text-emerald-500" />
          Scheduler queue
          <span className="ml-auto">{members.filter((member) => member.presence === "active").length} active</span>
        </div>
      </div>
    </aside>
  );
}

function SidebarSection({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="no-drag px-3 py-2">
      <button className="mb-1 flex h-6 w-full items-center gap-1 rounded px-1 text-left text-xs font-medium text-sidebar-heading hover:bg-sidebar-accent">
        <ChevronDown className="size-3" />
        {title}
      </button>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

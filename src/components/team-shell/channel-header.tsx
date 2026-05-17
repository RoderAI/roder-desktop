import { Bell, Hash, Info, Search, Star, UserCircle, UserRoundPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { memberIdFromDmChannelId } from "@/lib/team-conversations";
import type { TeamChannel } from "@/lib/team-view-model";
import type { TeamDrawer } from "./types";

type ChannelHeaderProps = {
  channel: TeamChannel;
  memberCount: number;
  activeDrawer: TeamDrawer;
  onOpenDetails: () => void;
  onOpenMembers: () => void;
};

export function ChannelHeader({
  channel,
  memberCount,
  activeDrawer,
  onOpenDetails,
  onOpenMembers,
}: ChannelHeaderProps): React.JSX.Element {
  const isDirectMessage = Boolean(memberIdFromDmChannelId(channel.id));
  const LeadingIcon = isDirectMessage ? UserCircle : Hash;

  return (
    <header className="drag-region flex h-[56px] shrink-0 items-center gap-3 border-b border-border bg-background px-4">
      <div className="flex min-w-0 items-center gap-2">
        <LeadingIcon className="size-4 text-muted-foreground" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[15px] font-semibold">{channel.name}</h1>
            <Star className="no-drag size-4 text-muted-foreground" />
          </div>
          <div className="truncate text-xs text-muted-foreground">{channel.topic ?? channel.description ?? "Team channel"}</div>
        </div>
      </div>
      <div className="no-drag ml-auto flex items-center gap-2">
        <button className="flex h-8 w-[260px] items-center gap-2 rounded-md border border-border bg-card px-3 text-left text-xs text-muted-foreground">
          <Search className="size-3.5" />
          Search {channel.name}
        </button>
        <Button variant="ghost" size="compact" className="gap-1 text-muted-foreground" onClick={onOpenMembers}>
          <UserRoundPlus className="size-4" />
          {memberCount}
        </Button>
        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="Notifications">
          <Bell className="size-4" />
        </Button>
        <Button
          variant={activeDrawer?.type === "details" ? "secondary" : "ghost"}
          size="icon"
          className="size-8"
          aria-label="Channel details"
          onClick={onOpenDetails}
        >
          <Info className="size-4" />
        </Button>
      </div>
    </header>
  );
}

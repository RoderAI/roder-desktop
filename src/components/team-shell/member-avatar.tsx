import { cn } from "@/lib/utils";
import { memberInitials } from "@/lib/team-view-model";
import type { TeamMember, TeamMemberPresence } from "./types";

type MemberAvatarProps = {
  member: TeamMember;
  size?: "sm" | "md" | "lg";
  showPresence?: boolean;
};

const presenceColor: Record<TeamMemberPresence, string> = {
  active: "bg-emerald-500",
  away: "bg-amber-400",
  busy: "bg-rose-500",
  offline: "bg-muted-foreground",
};

export function MemberAvatar({ member, size = "md", showPresence = true }: MemberAvatarProps): React.JSX.Element {
  const sizeClass = size === "lg" ? "size-10 text-sm" : size === "sm" ? "size-6 text-[11px]" : "size-8 text-xs";
  const dotClass = size === "lg" ? "size-3" : "size-2.5";

  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center rounded-md font-semibold text-white", sizeClass)} style={{ background: member.color ?? "hsl(210 18% 34%)" }}>
      {member.avatarUrl ? (
        <img src={member.avatarUrl} alt="" className="size-full rounded-md object-cover" />
      ) : (
        <span>{member.initials ?? memberInitials(member.name)}</span>
      )}
      {showPresence && (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-card",
            dotClass,
            presenceColor[member.presence ?? "offline"],
          )}
        />
      )}
    </span>
  );
}

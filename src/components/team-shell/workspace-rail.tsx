import { Bell, Grid2X2, Plus, Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TeamShellTeam } from "./types";

type WorkspaceRailProps = {
  team: TeamShellTeam;
  schedulerRunning: boolean;
  onToggleScheduler: () => void;
};

export function WorkspaceRail({ team, schedulerRunning, onToggleScheduler }: WorkspaceRailProps): React.JSX.Element {
  return (
    <aside className="drag-region flex h-full w-[68px] shrink-0 flex-col items-center gap-3 border-r border-border bg-[hsl(210_18%_15%)] px-2 py-4 text-white">
      <div className="no-drag flex size-10 items-center justify-center rounded-xl bg-white text-[15px] font-bold text-[hsl(210_18%_16%)] shadow-sm">
        {team.name.slice(0, 1).toUpperCase()}
      </div>
      <RailButton active icon={<Grid2X2 className="size-5" />} label="Workspace" />
      <RailButton icon={<Search className="size-5" />} label="Search" />
      <RailButton
        active={schedulerRunning}
        icon={<Sparkles className={cn("size-5", schedulerRunning && "text-emerald-300")} />}
        label={schedulerRunning ? "Scheduler on" : "Scheduler off"}
        onClick={onToggleScheduler}
      />
      <RailButton icon={<Bell className="size-5" />} label="Activity" />
      <div className="mt-auto">
        <RailButton icon={<Plus className="size-5" />} label="Add workspace" />
      </div>
    </aside>
  );
}

function RailButton({
  active,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "no-drag flex size-10 items-center justify-center rounded-xl text-white/68 transition-colors hover:bg-white/10 hover:text-white",
        active && "bg-white/16 text-white shadow-sm",
      )}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

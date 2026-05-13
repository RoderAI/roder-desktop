import { Ellipsis, PanelRight, Share, SquareTerminal } from "lucide-react";
import type { GodeStatus, GodeThread } from "@/types/gode";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type TopBarProps = {
  thread?: GodeThread;
  status: GodeStatus;
  onRestart: () => void;
};

export function TopBar({ thread, status, onRestart }: TopBarProps): React.JSX.Element {
  const connected = status.state === "ready";
  return (
    <header className="drag-region flex h-[52px] shrink-0 items-center border-b border-transparent px-5 text-[#585858]">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="truncate text-[16px] font-normal">{thread?.name ?? thread?.preview ?? "New Agent"}</h1>
        <SquareTerminal className="size-4 opacity-70" />
        <Badge variant={connected ? "secondary" : "muted"} className="no-drag hidden text-[11px] lg:inline-flex">
          {connected ? "app-server ready" : status.state}
        </Badge>
      </div>
      <div className="no-drag ml-auto flex items-center gap-2">
        {status.state === "error" && (
          <Button variant="outline" size="sm" onClick={onRestart}>
            Restart
          </Button>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon">
              <Ellipsis className="size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>More actions</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon">
              <Share className="size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Share thread</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon">
              <PanelRight className="size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Toggle panel</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}

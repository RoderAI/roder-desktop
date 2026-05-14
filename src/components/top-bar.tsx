import { Ellipsis, Globe2, PanelRight, Share, SquareTerminal, TerminalSquare } from "lucide-react";
import type { GodeStatus, GodeThread } from "@/types/gode";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type ToolPanel = "terminal" | "browser" | null;

type TopBarProps = {
  thread?: GodeThread;
  status: GodeStatus;
  activeTool: ToolPanel;
  onRestart: () => void;
  onToggleTerminal: () => void;
  onToggleBrowser: () => void;
};

export function TopBar({
  thread,
  status,
  activeTool,
  onRestart,
  onToggleTerminal,
  onToggleBrowser,
}: TopBarProps): React.JSX.Element {
  const connected = status.state === "ready";
  return (
    <header className="drag-region flex h-[52px] shrink-0 items-center border-b border-transparent px-5 text-muted-foreground">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <h1 className="min-w-0 truncate text-[16px] font-normal">{thread?.name ?? thread?.preview ?? "New Agent"}</h1>
        <SquareTerminal className="size-4 opacity-70" />
        <Badge variant={connected ? "secondary" : "muted"} className="no-drag hidden shrink-0 text-[11px] lg:inline-flex">
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
            <Button variant="ghost" size="icon" aria-label="More actions">
              <Ellipsis className="size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>More actions</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Share thread">
              <Share className="size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Share thread</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={activeTool === "terminal" ? "secondary" : "ghost"}
              size="icon"
              aria-label="Toggle terminal"
              onClick={onToggleTerminal}
            >
              <TerminalSquare className="size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Toggle terminal</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={activeTool === "browser" ? "secondary" : "ghost"}
              size="icon"
              aria-label="Toggle browser"
              onClick={onToggleBrowser}
            >
              <Globe2 className="size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Toggle browser</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Toggle side panel">
              <PanelRight className="size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Toggle side panel</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}

import { Globe2, Paintbrush, PanelLeftOpen, SquareTerminal, TerminalSquare } from "lucide-react";
import type { GodeStatus, GodeThread } from "@/types/gode";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ToolPanel = "terminal" | "browser" | "canvas" | null;

type TopBarProps = {
  thread?: GodeThread;
  status: GodeStatus;
  activeTool: ToolPanel;
  sidebarOpen: boolean;
  onRestart: () => void;
  onToggleSidebar: () => void;
  onToggleTerminal: () => void;
  onToggleBrowser: () => void;
  onToggleCanvas: () => void;
};

export function TopBar({
  thread,
  status,
  activeTool,
  sidebarOpen,
  onRestart,
  onToggleSidebar,
  onToggleTerminal,
  onToggleBrowser,
  onToggleCanvas,
}: TopBarProps): React.JSX.Element {
  const connected = status.state === "ready";
  return (
    <header
      className={cn(
        "drag-region flex h-[52px] shrink-0 items-center border-b border-transparent pr-5 text-muted-foreground",
        sidebarOpen ? "pl-5" : "pl-[92px]",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {!sidebarOpen && (
          <Button
            variant="ghost"
            size="icon"
            className="no-drag size-8 shrink-0 rounded-md text-muted-foreground active:scale-95"
            aria-label="Show sidebar"
            title="Show sidebar"
            onClick={onToggleSidebar}
          >
            <PanelLeftOpen className="size-4" />
          </Button>
        )}
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
        <Button
          variant={activeTool === "terminal" ? "secondary" : "ghost"}
          size="icon"
          aria-label="Toggle terminal"
          title="Toggle terminal"
          onClick={onToggleTerminal}
        >
          <TerminalSquare className="size-5" />
        </Button>
        <Button
          variant={activeTool === "browser" ? "secondary" : "ghost"}
          size="icon"
          aria-label="Toggle browser"
          title="Toggle browser"
          onClick={onToggleBrowser}
        >
          <Globe2 className="size-5" />
        </Button>
        <Button
          variant={activeTool === "canvas" ? "secondary" : "ghost"}
          size="icon"
          aria-label="Toggle canvas"
          title="Toggle canvas"
          onClick={onToggleCanvas}
        >
          <Paintbrush className="size-5" />
        </Button>
      </div>
    </header>
  );
}

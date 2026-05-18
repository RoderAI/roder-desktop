import { Check, ChevronDown, Folder, Globe2, MessageSquare, Paintbrush, PanelLeftOpen, SquareTerminal, TerminalSquare } from "lucide-react";
import type { RoderStatus, RoderThread } from "@/types/roder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type ToolPanel = "terminal" | "browser" | "canvas" | null;

type FolderOption = {
  path: string;
  name: string;
  updatedAt: number;
  threadCount: number;
};

type TopBarProps = {
  thread?: RoderThread;
  threads: RoderThread[];
  folders: FolderOption[];
  activeFolderPath: string;
  status: RoderStatus;
  activeTool: ToolPanel;
  sidebarOpen: boolean;
  onRestart: () => void;
  onToggleSidebar: () => void;
  onSelectFolder: (path: string) => void;
  onSelectThread: (threadId: string) => void;
  onToggleTerminal: () => void;
  onToggleBrowser: () => void;
  onToggleCanvas: () => void;
};

export function TopBar({
  thread,
  threads,
  folders,
  activeFolderPath,
  status,
  activeTool,
  sidebarOpen,
  onRestart,
  onToggleSidebar,
  onSelectFolder,
  onSelectThread,
  onToggleTerminal,
  onToggleBrowser,
  onToggleCanvas,
}: TopBarProps): React.JSX.Element {
  const connected = status.state === "ready";
  const activeFolder = folders.find((folder) => normalizePath(folder.path) === normalizePath(activeFolderPath));
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
            className="no-drag size-8 shrink-0 translate-y-[4px] rounded-md text-muted-foreground active:scale-95"
            aria-label="Show sidebar"
            title="Show sidebar"
            onClick={onToggleSidebar}
          >
            <PanelLeftOpen className="size-4" />
          </Button>
        )}
        {sidebarOpen ? (
          <>
            <h1 className="min-w-0 truncate text-[16px] font-normal">{threadTitle(thread)}</h1>
            <SquareTerminal className="size-4 opacity-70" />
          </>
        ) : (
          <CollapsedBreadcrumb
            thread={thread}
            threads={threads}
            folders={folders}
            activeFolder={activeFolder}
            activeFolderPath={activeFolderPath}
            onSelectFolder={onSelectFolder}
            onSelectThread={onSelectThread}
          />
        )}
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

function CollapsedBreadcrumb({
  thread,
  threads,
  folders,
  activeFolder,
  activeFolderPath,
  onSelectFolder,
  onSelectThread,
}: {
  thread?: RoderThread;
  threads: RoderThread[];
  folders: FolderOption[];
  activeFolder?: FolderOption;
  activeFolderPath: string;
  onSelectFolder: (path: string) => void;
  onSelectThread: (threadId: string) => void;
}): React.JSX.Element {
  const activeFolderLabel = activeFolder?.name ?? folderName(activeFolderPath);
  const activeFolderKey = normalizePath(activeFolder?.path ?? activeFolderPath);
  return (
    <div className="no-drag flex min-w-0 items-center gap-1.5 rounded-full bg-card/70 p-1 text-[14px] shadow-sm ring-1 ring-border">
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-7 max-w-[220px] items-center gap-2 rounded-full px-2.5 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground data-[popup-open]:bg-accent"
          aria-label={`Choose folder: ${activeFolderLabel}`}
          title={activeFolder?.path ?? activeFolderPath}
        >
          <Folder className="size-3.5 shrink-0" />
          <span className="truncate text-foreground">{activeFolderLabel}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" sideOffset={8} className="w-[340px] rounded-xl p-1.5">
          <DropdownMenuGroup className="max-h-[300px] overflow-y-auto">
            <div className="px-2 pb-1 pt-1 text-[12px] font-medium text-muted-foreground">Folders</div>
            {folders.length > 0 ? (
              folders.map((folder) => {
                const selected = normalizePath(folder.path) === activeFolderKey;
                return (
                  <DropdownMenuItem
                    key={folder.path}
                    className={cn("h-10 rounded-lg px-2 text-[14px]", selected && "bg-accent/80")}
                    onSelect={() => onSelectFolder(folder.path)}
                  >
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-foreground">{folder.name}</span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">{folder.threadCount} threads</span>
                    {selected && <Check className="size-3.5 shrink-0" />}
                  </DropdownMenuItem>
                );
              })
            ) : (
              <div className="px-2 py-4 text-[13px] text-muted-foreground">No folders yet</div>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="select-none text-muted-foreground/60">/</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-7 max-w-[280px] items-center gap-2 rounded-full px-2.5 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground data-[popup-open]:bg-accent"
          aria-label={`Choose thread: ${threadTitle(thread)}`}
          title={threadTitle(thread)}
        >
          <MessageSquare className="size-3.5 shrink-0" />
          <span className="truncate text-foreground">{threadTitle(thread)}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" sideOffset={8} className="w-[380px] rounded-xl p-1.5">
          <DropdownMenuGroup className="max-h-[320px] overflow-y-auto">
            <div className="px-2 pb-1 pt-1 text-[12px] font-medium text-muted-foreground">Threads in {activeFolderLabel}</div>
            {threads.length > 0 ? (
              threads.map((item) => {
                const selected = item.id === thread?.id;
                return (
                  <DropdownMenuItem
                    key={item.id}
                    className={cn("h-10 rounded-lg px-2 text-[14px]", selected && "bg-accent/80")}
                    onSelect={() => onSelectThread(item.id)}
                  >
                    <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-foreground">{threadTitle(item)}</span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">{relativeAge(item.updatedAt)}</span>
                    {selected && <Check className="size-3.5 shrink-0" />}
                  </DropdownMenuItem>
                );
              })
            ) : (
              <div className="px-2 py-4 text-[13px] text-muted-foreground">No threads in this folder yet</div>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function threadTitle(thread: RoderThread | undefined): string {
  if (!thread) {
    return "New Agent";
  }
  return thread.name ?? (thread.preview || "Untitled agent");
}

function folderName(path: string): string {
  return path?.split("/").filter(Boolean).pop() || "workspace";
}

function normalizePath(path: string | undefined): string {
  return (path || "").replace(/\/+$/, "") || path || "";
}

function relativeAge(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "";
  }
  const normalized = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
  const diffMs = Math.max(0, Date.now() - normalized);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < hour) {
    return `${Math.max(1, Math.floor(diffMs / minute))}m`;
  }
  if (diffMs < day) {
    return `${Math.floor(diffMs / hour)}h`;
  }
  return `${Math.floor(diffMs / day)}d`;
}

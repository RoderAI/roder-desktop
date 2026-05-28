import { LayoutAlignLeftIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Check, ChevronDown, Folder, Globe2, MessageSquare, Paintbrush, Puzzle, TerminalSquare } from "lucide-react";
import type { RoderStatus, RoderThread } from "@/types/roder";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type ToolPanel = "terminal" | "browser" | "canvas" | "extensions" | null;

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
  onToggleExtensions: () => void;
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
  onToggleExtensions,
}: TopBarProps): React.JSX.Element {
  const activeFolder = folders.find((folder) => normalizePath(folder.path) === normalizePath(activeFolderPath));
  const activeFolderLabel = activeFolder?.name ?? folderName(activeFolderPath);
  return (
    <header
      className={cn(
        "drag-region flex h-[60px] shrink-0 items-center border-b border-transparent pr-5 text-muted-foreground",
        sidebarOpen ? "pl-5" : "pl-[148px]",
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className="squircle-corners no-drag fixed left-[104px] top-3.5 z-40 size-8 rounded-xl text-muted-foreground/85 hover:bg-accent/60 hover:text-foreground active:scale-95"
        aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        onClick={onToggleSidebar}
      >
        <HugeiconsIcon icon={LayoutAlignLeftIcon} className="size-5" strokeWidth={1.7} />
      </Button>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {sidebarOpen ? (
          <h1 className="flex min-w-0 items-baseline gap-1.5 text-base">
            <span className="max-w-48 truncate font-normal text-muted-foreground">{activeFolderLabel}</span>
            <span className="shrink-0 text-muted-foreground/60" aria-hidden="true">
              /
            </span>
            <span className="min-w-0 truncate font-semibold text-foreground">{threadTitle(thread)}</span>
          </h1>
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
        <Button
          variant={activeTool === "extensions" ? "secondary" : "ghost"}
          size="icon"
          aria-label="Toggle extensions"
          title="Toggle extensions"
          onClick={onToggleExtensions}
        >
          <Puzzle className="size-5" />
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
    <div className="no-drag flex min-w-0 items-center gap-1.5 rounded-full bg-card/70 p-1 text-base shadow-sm ring-1 ring-border">
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
            <div className="px-2 pb-1 pt-1 text-base font-medium text-muted-foreground">Folders</div>
            {folders.length > 0 ? (
              folders.map((folder) => {
                const selected = normalizePath(folder.path) === activeFolderKey;
                return (
                  <DropdownMenuItem
                    key={folder.path}
                    selected={selected}
                    className="h-10 rounded-lg px-2 text-base"
                    onSelect={() => onSelectFolder(folder.path)}
                  >
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-foreground">{folder.name}</span>
                    <span className="shrink-0 text-base text-muted-foreground">{folder.threadCount} threads</span>
                    {selected && <Check className="size-3.5 shrink-0 text-primary" />}
                  </DropdownMenuItem>
                );
              })
            ) : (
              <div className="px-2 py-4 text-base text-muted-foreground">No folders yet</div>
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
            <div className="px-2 pb-1 pt-1 text-base font-medium text-muted-foreground">
              Threads in {activeFolderLabel}
            </div>
            {threads.length > 0 ? (
              threads.map((item) => {
                const selected = item.id === thread?.id;
                return (
                  <DropdownMenuItem
                    key={item.id}
                    selected={selected}
                    className="h-10 rounded-lg px-2 text-base"
                    onSelect={() => onSelectThread(item.id)}
                  >
                    <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-foreground">{threadTitle(item)}</span>
                    <span className="shrink-0 text-base text-muted-foreground">{relativeAge(item.updatedAt)}</span>
                    {selected && <Check className="size-3.5 shrink-0 text-primary" />}
                  </DropdownMenuItem>
                );
              })
            ) : (
              <div className="px-2 py-4 text-base text-muted-foreground">No threads in this folder yet</div>
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

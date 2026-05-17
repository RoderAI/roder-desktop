import { Check, ChevronDown, Folder, FolderOpen, Home, Laptop, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { GodeThread, WorkspaceFolder } from "@/types/gode";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type WorkspacePickerProps = {
  selectedCwd: string;
  statusCwd?: string;
  recents: WorkspaceFolder[];
  threads: GodeThread[];
  onSelect: (cwd: string) => void;
  onOpenFolder: () => void;
};

type WorkspaceOption = WorkspaceFolder & {
  source: "current" | "recent" | "thread";
};

export function WorkspacePicker({
  selectedCwd,
  statusCwd,
  recents,
  threads,
  onSelect,
  onOpenFolder,
}: WorkspacePickerProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const options = useMemo(() => buildWorkspaceOptions(selectedCwd, statusCwd, recents, threads), [recents, selectedCwd, statusCwd, threads]);
  const normalizedSelected = normalizePath(selectedCwd || statusCwd || "");
  const filteredOptions = options.filter((option) => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return true;
    }
    return `${option.name} ${option.path} ${shortPath(option.path)}`.toLowerCase().includes(needle);
  });
  const selectedLabel = workspaceLabel(selectedCwd || statusCwd || "");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(buttonVariants({ variant: "ghost", size: "compact" }), "h-8 rounded-full px-2.5 text-[15px] text-muted-foreground")}
        aria-label={`Choose workspace folder: ${selectedLabel}`}
      >
        <span className="max-w-[180px] truncate text-foreground">{selectedLabel}</span>
        <ChevronDown className="size-4" />
        <Laptop className="ml-1 size-4" />
        <span>Local</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" side="top" sideOffset={8} className="w-[368px] rounded-xl p-0">
        <div className="flex h-11 items-center gap-2.5 border-b border-border px-3.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
            placeholder="Run Roder anywhere..."
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </div>
        <DropdownMenuGroup className="max-h-[282px] overflow-y-auto p-1.5">
          <div className="px-2 pb-1 pt-1.5 text-[13px] text-muted-foreground">Recents</div>
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => (
              <DropdownMenuItem
                key={`${option.source}:${option.path}`}
                className={cn("h-9 rounded-lg px-2 text-[14px] focus:bg-accent", option.path === normalizedSelected && "bg-accent/80")}
                onSelect={() => onSelect(option.path)}
              >
                <WorkspaceIcon path={option.path} source={option.source} />
                <span className="min-w-0 flex-1 truncate text-foreground">{option.name}</span>
                <span className="max-w-[160px] truncate text-[13px] text-muted-foreground">{shortPath(option.path)}</span>
                {option.path === normalizedSelected && <Check className="ml-0.5 size-3.5 text-fuchsia-300" />}
              </DropdownMenuItem>
            ))
          ) : (
            <div className="px-2 py-4 text-[13px] text-muted-foreground">No matching folders</div>
          )}
        </DropdownMenuGroup>
        <div className="border-t border-border p-1.5">
          <DropdownMenuItem className="h-9 rounded-lg px-2 text-[14px] focus:bg-accent" onSelect={() => void onOpenFolder()}>
            <FolderOpen className="size-4 text-muted-foreground" />
            <span>Open Folder</span>
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function buildWorkspaceOptions(
  selectedCwd: string,
  statusCwd: string | undefined,
  recents: WorkspaceFolder[],
  threads: GodeThread[],
): WorkspaceOption[] {
  const byPath = new Map<string, WorkspaceOption>();

  for (const path of [selectedCwd, statusCwd].filter(Boolean)) {
    const normalized = normalizePath(path);
    byPath.set(normalized, { path: normalized, name: workspaceLabel(normalized), lastUsedAt: Date.now(), source: "current" });
  }

  for (const recent of recents) {
    const normalized = normalizePath(recent.path);
    byPath.set(normalized, {
      path: normalized,
      name: recent.name || workspaceLabel(normalized),
      lastUsedAt: recent.lastUsedAt,
      source: "recent",
    });
  }

  for (const thread of threads) {
    const normalized = normalizePath(thread.cwd);
    const existing = byPath.get(normalized);
    byPath.set(normalized, {
      path: normalized,
      name: existing?.name || workspaceLabel(normalized),
      lastUsedAt: Math.max(existing?.lastUsedAt ?? 0, normalizedTimestamp(thread.updatedAt)),
      source: existing?.source ?? "thread",
    });
  }

  return [...byPath.values()].sort((left, right) => {
    if (left.path === normalizePath(selectedCwd)) {
      return -1;
    }
    if (right.path === normalizePath(selectedCwd)) {
      return 1;
    }
    return right.lastUsedAt - left.lastUsedAt || left.name.localeCompare(right.name);
  });
}

function WorkspaceIcon({ path, source }: { path: string; source: WorkspaceOption["source"] }): React.JSX.Element {
  if (isHomePath(path)) {
    return <Home className="size-4 shrink-0 text-muted-foreground" />;
  }
  if (source === "current") {
    return <Laptop className="size-4 shrink-0 text-muted-foreground" />;
  }
  return <Folder className="size-4 shrink-0 text-muted-foreground" />;
}

function normalizePath(path: string | undefined): string {
  return (path || "").replace(/\/+$/, "") || path || "";
}

function workspaceLabel(path: string): string {
  if (isHomePath(path)) {
    return "Home";
  }
  return path.split("/").filter(Boolean).pop() || "workspace";
}

function shortPath(path: string): string {
  if (isHomePath(path)) {
    return "Home";
  }
  return path.replace(/^\/Users\/[^/]+/, "~");
}

function isHomePath(path: string): boolean {
  return /^\/Users\/[^/]+\/?$/.test(path);
}

function normalizedTimestamp(timestamp: number): number {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 0;
  }
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

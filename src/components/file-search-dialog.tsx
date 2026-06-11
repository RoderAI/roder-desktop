import { FileIcon, FolderIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { fileSearchResultLimit } from "@/components/file-panel/constants";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  filePanelSearchLauncherResults,
  type FilePanelIndexedPath,
  type FilePanelSearchLauncherResult,
} from "@/lib/file-panel";
import { roderIpc } from "@/lib/roder-ipc";
import type { WorkspaceRoot } from "@/types/roder";

type FileSearchDialogProps = {
  open: boolean;
  workspaceId: string;
  roots: WorkspaceRoot[];
  filesystemAvailable: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (indexedPath: FilePanelIndexedPath) => void;
};

type FileSearchStatus =
  | { state: "idle" }
  | { state: "loading"; results: FilePanelSearchLauncherResult[] }
  | { state: "ready"; results: FilePanelSearchLauncherResult[] }
  | { state: "error"; message: string };

type FileSearchDisplayStatus = FileSearchStatus | { state: "unavailable" } | { state: "empty-workspace" };

export function FileSearchDialog({
  open,
  workspaceId,
  roots,
  filesystemAvailable,
  onOpenChange,
  onSelect,
}: FileSearchDialogProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<FileSearchStatus>({ state: "idle" });
  const requestSeq = useRef(0);

  function selectResult(result: FilePanelSearchLauncherResult): void {
    onSelect(result.indexedPath);
    changeOpen(false);
  }

  function changeOpen(nextOpen: boolean): void {
    if (!nextOpen) {
      requestSeq.current += 1;
    }
    onOpenChange(nextOpen);
  }

  function resetSearch(): void {
    setQuery("");
    setStatus({ state: "idle" });
  }

  function handleOpenChangeComplete(nextOpen: boolean): void {
    if (!nextOpen) {
      resetSearch();
    }
  }

  function searchWorkspace(nextQuery: string): void {
    setQuery(nextQuery);
    const trimmedQuery = nextQuery.trim();
    const requestId = (requestSeq.current += 1);
    if (!filesystemAvailable || !workspaceId || roots.length === 0) {
      return;
    }
    if (!trimmedQuery) {
      setStatus({ state: "idle" });
      return;
    }

    setStatus((current) => ({
      state: "loading",
      results: "results" in current ? current.results : [],
    }));
    void roderIpc
      .queryWorkspaceFiles({ workspaceId, query: trimmedQuery, limit: fileSearchResultLimit })
      .then((result) => {
        if (requestSeq.current !== requestId) {
          return;
        }
        setStatus({ state: "ready", results: filePanelSearchLauncherResults(roots, result.matches) });
      })
      .catch((error: unknown) => {
        if (requestSeq.current !== requestId) {
          return;
        }
        setStatus({ state: "error", message: errorMessage(error) });
      });
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen} onOpenChangeComplete={handleOpenChangeComplete}>
      <DialogContent
        showCloseButton={false}
        className="w-[min(calc(100vw-theme(spacing.8)),40rem)] max-w-none gap-0 overflow-hidden rounded-3xl p-0"
      >
        <DialogTitle className="sr-only">Find file</DialogTitle>
        <FileSearchCommandContent
          query={query}
          status={fileSearchDisplayStatus({ filesystemAvailable, workspaceId, roots, status })}
          onQueryChange={searchWorkspace}
          onSelect={selectResult}
        />
      </DialogContent>
    </Dialog>
  );
}

export function FileSearchCommandContent({
  query,
  status,
  onQueryChange,
  onSelect,
}: {
  query: string;
  status: FileSearchDisplayStatus;
  onQueryChange: (query: string) => void;
  onSelect: (result: FilePanelSearchLauncherResult) => void;
}): React.JSX.Element {
  const results = "results" in status ? status.results : [];
  const showResults = results.length > 0;

  return (
    <Command shouldFilter={false} loop className="rounded-none bg-popover p-0">
      <div className="border-b border-border">
        <CommandInput
          ref={focusFileSearchInput}
          value={query}
          placeholder="Search files and folders"
          inputGroupClassName="h-12! rounded-none! bg-transparent shadow-none! ring-0! focus-within:ring-0!"
          className="h-11 px-2.5 text-base font-medium placeholder:text-muted-foreground"
          onValueChange={onQueryChange}
        />
      </div>
      <CommandList className="max-h-96 p-1.5">
        {showResults ? (
          <CommandGroup heading="Files and folders" className="p-0">
            {results.map((result) => (
              <FileSearchResultItem key={result.key} result={result} onSelect={onSelect} />
            ))}
          </CommandGroup>
        ) : (
          <FileSearchMessage status={status} />
        )}
      </CommandList>
    </Command>
  );
}

function focusFileSearchInput(element: HTMLInputElement | null): void {
  element?.focus();
}

function FileSearchResultItem({
  result,
  onSelect,
}: {
  result: FilePanelSearchLauncherResult;
  onSelect: (result: FilePanelSearchLauncherResult) => void;
}): React.JSX.Element {
  const directory = result.indexedPath.kind === "directory";
  return (
    <CommandItem
      value={result.key}
      keywords={[directory ? "folder" : "file", result.title, result.subtitle, result.rootLabel]}
      aria-label={`${directory ? "Folder" : "File"}: ${result.title}`}
      className="h-11 rounded-xl px-2.5 text-left"
      onSelect={() => onSelect(result)}
    >
      {directory ? (
        <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
      ) : (
        <FileIcon className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-medium text-foreground">{result.title}</span>
        <span className="block truncate text-sm font-medium text-muted-foreground">{result.subtitle}</span>
      </span>
    </CommandItem>
  );
}

function FileSearchMessage({ status }: { status: FileSearchDisplayStatus }): React.JSX.Element {
  if (status.state === "loading") {
    return <CommandEmptyMessage>Searching files.</CommandEmptyMessage>;
  }
  if (status.state === "ready") {
    return <CommandEmptyMessage>No files or folders found.</CommandEmptyMessage>;
  }
  if (status.state === "unavailable") {
    return <CommandEmptyMessage>Workspace files are unavailable.</CommandEmptyMessage>;
  }
  if (status.state === "empty-workspace") {
    return <CommandEmptyMessage>Select a workspace to search files.</CommandEmptyMessage>;
  }
  if (status.state === "error") {
    return <CommandEmptyMessage>{status.message}</CommandEmptyMessage>;
  }
  return <CommandEmptyMessage>Type to search files and folders.</CommandEmptyMessage>;
}

function CommandEmptyMessage({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <CommandEmpty className="px-3 py-8 text-center text-base font-medium text-muted-foreground">
      {children}
    </CommandEmpty>
  );
}

export function fileSearchDisplayStatus({
  filesystemAvailable,
  workspaceId,
  roots,
  status,
}: {
  filesystemAvailable: boolean;
  workspaceId: string;
  roots: readonly WorkspaceRoot[];
  status: FileSearchStatus;
}): FileSearchDisplayStatus {
  if (!filesystemAvailable) {
    return { state: "unavailable" };
  }
  if (!workspaceId || roots.length === 0) {
    return { state: "empty-workspace" };
  }
  return status;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to search files.";
}

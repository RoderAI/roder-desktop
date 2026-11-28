import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  CornerDownLeftIcon,
  FolderIcon,
  GitBranchIcon,
  HouseIcon,
  LaptopIcon,
  SearchIcon,
} from "lucide-react";
import { Fragment, useId, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  buildProjectPickerRows,
  deviceDisplayName,
  folderName,
  highlightSegments,
  moveSelectionIndex,
  parentPath,
  projectPickerBreadcrumbs,
  projectPickerDeepSearchDebounceMs,
  projectPickerDeepSearchMinQuery,
  projectPickerKeyAction,
  resolveSelectedIndex,
  trimTrailingSeparators,
  type ProjectPickerBreadcrumb,
  type ProjectPickerRow,
} from "@/lib/project-picker";
import { roderIpc } from "@/lib/roder-ipc";
import { cn } from "@/lib/utils";
import type { ProjectPickerEntry } from "@/types/project-picker";

type ProjectPickerDialogProps = {
  open: boolean;
  initialPath: string;
  title?: string;
  onOpenChange: (open: boolean) => void;
  onPick: (path: string) => void;
};

export function ProjectPickerDialog({
  open,
  initialPath,
  title = "New project",
  onOpenChange,
  onPick,
}: ProjectPickerDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="w-[min(calc(100vw-theme(spacing.8)),36rem)] max-w-none gap-0 overflow-hidden rounded-2xl p-0"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <ProjectPickerPanel
          initialPath={initialPath}
          title={title}
          homeDir={window.roderDesktop.homeDir}
          deviceName={deviceDisplayName(window.roderDesktop.hostName)}
          platform={window.roderDesktop.platform}
          onPick={onPick}
        />
      </DialogContent>
    </Dialog>
  );
}

type ListingState = {
  path: string;
  entries: ProjectPickerEntry[];
  error: string | null;
};

type DeepSearchState = {
  matches: ProjectPickerEntry[];
  searching: boolean;
};

/** Mounted only while the dialog is open, so every open starts from fresh state. */
function ProjectPickerPanel({
  initialPath,
  title,
  homeDir,
  deviceName,
  platform,
  onPick,
}: {
  initialPath: string;
  title: string;
  homeDir: string;
  deviceName: string;
  platform: string;
  onPick: (path: string) => void;
}): React.JSX.Element {
  const [path, setPath] = useState(() => trimTrailingSeparators(initialPath));
  const [listing, setListing] = useState<ListingState | null>(null);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [deep, setDeep] = useState<DeepSearchState>({ matches: [], searching: false });
  const deepRequestSeq = useRef(0);
  const deepTimer = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const listingRequestSeq = useRef(0);

  useMountEffect(() => {
    loadListing(path);
    return () => {
      listingRequestSeq.current += 1;
      deepRequestSeq.current += 1;
      if (deepTimer.current !== null) {
        window.clearTimeout(deepTimer.current);
      }
      void roderIpc.projectPickerCancelSearch();
    };
  });

  const listingReady = listing?.path === path;
  const rows = buildProjectPickerRows({
    entries: listingReady ? listing.entries : [],
    deepMatches: deep.matches,
    query,
    currentPath: path,
    homeDir,
  });
  const selectedIndex = resolveSelectedIndex(rows.all, selectedKey, query);
  const selectedRow = selectedIndex === -1 ? null : rows.all[selectedIndex];
  const breadcrumbs = projectPickerBreadcrumbs(path, homeDir, deviceName);
  const canGoUp = parentPath(path) !== null;
  const showDeepSection = query.trim().length >= projectPickerDeepSearchMinQuery;
  const addTarget = selectedRow?.entry.path ?? path;

  function loadListing(nextPath: string): void {
    const requestId = (listingRequestSeq.current += 1);
    roderIpc
      .projectPickerList(nextPath)
      .then((result) => {
        if (listingRequestSeq.current === requestId) {
          setListing({ path: nextPath, entries: result.entries, error: null });
          // After going up, the folder we came from is selected; reveal it once rendered.
          window.requestAnimationFrame(() => revealRow('[aria-selected="true"]'));
        }
      })
      .catch((error: unknown) => {
        if (listingRequestSeq.current === requestId) {
          setListing({ path: nextPath, entries: [], error: listingErrorMessage(error) });
        }
      });
  }

  function revealRow(selector: string): void {
    listRef.current?.querySelector(selector)?.scrollIntoView({ block: "nearest" });
  }

  function scheduleDeepSearch(nextQuery: string): void {
    if (deepTimer.current !== null) {
      window.clearTimeout(deepTimer.current);
      deepTimer.current = null;
    }
    const requestId = (deepRequestSeq.current += 1);
    const trimmed = nextQuery.trim();
    if (trimmed.length < projectPickerDeepSearchMinQuery || !homeDir) {
      void roderIpc.projectPickerCancelSearch();
      setDeep((current) => (current.searching ? { ...current, searching: false } : current));
      return;
    }
    setDeep((current) => (current.searching ? current : { ...current, searching: true }));
    deepTimer.current = window.setTimeout(() => {
      deepTimer.current = null;
      roderIpc
        .projectPickerSearch({ root: homeDir, query: trimmed })
        .then((result) => {
          if (deepRequestSeq.current !== requestId || result.canceled) {
            return;
          }
          setDeep({ matches: result.matches, searching: false });
        })
        .catch(() => {
          if (deepRequestSeq.current === requestId) {
            setDeep((current) => ({ ...current, searching: false }));
          }
        });
    }, projectPickerDeepSearchDebounceMs);
  }

  function changeQuery(nextQuery: string): void {
    listRef.current?.scrollTo({ top: 0 });
    setQuery(nextQuery);
    setSelectedKey(null);
    scheduleDeepSearch(nextQuery);
  }

  function navigateTo(nextPath: string, selectKey: string | null = null): void {
    const normalized = trimTrailingSeparators(nextPath);
    listRef.current?.scrollTo({ top: 0 });
    setPath(normalized);
    loadListing(normalized);
    setQuery("");
    setSelectedKey(selectKey);
    scheduleDeepSearch("");
  }

  function goUp(): void {
    const parent = parentPath(path);
    if (parent) {
      navigateTo(parent, `local:${path}`);
    }
  }

  function openRow(row: ProjectPickerRow): void {
    navigateTo(row.entry.path);
  }

  function addProject(): void {
    onPick(addTarget);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    const input = event.currentTarget;
    const action = projectPickerKeyAction({
      key: event.key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      isComposing: event.nativeEvent.isComposing,
      caretAtStart: input.selectionStart === 0 && input.selectionEnd === 0,
      queryEmpty: input.value === "",
      platform,
    });
    // Escape is handled by the dialog itself.
    if (!action || action === "close") {
      return;
    }
    event.preventDefault();
    if (action === "up" || action === "down") {
      const nextIndex = moveSelectionIndex(selectedIndex, action === "down" ? 1 : -1, rows.all.length, !query.trim());
      setSelectedKey(nextIndex === -1 ? null : (rows.all[nextIndex]?.key ?? null));
      if (nextIndex === -1) {
        listRef.current?.scrollTo({ top: 0 });
      } else {
        revealRow(`[data-index="${nextIndex}"]`);
      }
      return;
    }
    if (action === "open") {
      if (selectedRow) {
        openRow(selectedRow);
      }
      return;
    }
    if (action === "back") {
      goUp();
      return;
    }
    addProject();
  }

  const activeDescendant = selectedRow ? rowElementId(listId, selectedIndex) : undefined;

  return (
    <div className="flex flex-col bg-popover text-popover-foreground">
      <div className="flex h-12 items-center gap-2.5 bg-muted/40 px-4">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          ref={focusInput}
          type="text"
          role="combobox"
          aria-label="Search folders"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeDescendant}
          aria-autocomplete="list"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          placeholder="Search folders"
          className="h-full min-w-0 flex-1 bg-transparent text-base font-medium text-foreground outline-none placeholder:text-muted-foreground"
          onChange={(event) => changeQuery(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <span className="shrink-0 text-sm font-medium text-muted-foreground">{shortcutLabel(platform, "O")}</span>
      </div>

      <nav
        aria-label="Current folder"
        className="flex h-10 min-w-0 items-center gap-1 border-y border-border px-2.5 text-base font-medium"
      >
        <button
          type="button"
          aria-label="Go to parent folder"
          disabled={!canGoUp}
          tabIndex={-1}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          onClick={goUp}
        >
          <ArrowLeftIcon className="size-4" />
        </button>
        <span className="shrink-0 px-1.5 text-muted-foreground">{title}</span>
        {breadcrumbs.map((crumb, index) => (
          <Fragment key={crumb.key}>
            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
            <BreadcrumbButton
              crumb={crumb}
              current={index === breadcrumbs.length - 1}
              onNavigate={() => navigateTo(crumb.path)}
            />
          </Fragment>
        ))}
      </nav>

      <div ref={listRef} id={listId} role="listbox" aria-label="Folders" className="h-80 overflow-y-auto p-1.5">
        {rows.local.map((row, index) => (
          <ProjectPickerRowItem
            key={row.key}
            id={rowElementId(listId, index)}
            index={index}
            row={row}
            selected={index === selectedIndex}
            onHover={() => setSelectedKey(row.key)}
            onOpen={() => openRow(row)}
          />
        ))}
        {rows.localHidden > 0 ? (
          <p className="px-2.5 py-1.5 text-sm font-medium text-muted-foreground">
            {rows.localHidden} more folders. Keep typing to narrow the list.
          </p>
        ) : null}
        {listingReady && rows.local.length === 0 && !(showDeepSection && rows.deep.length > 0) ? (
          <p className="px-2.5 py-1.5 text-base font-medium text-muted-foreground">
            {listing.error ?? (query.trim() ? `No folders here match “${query.trim()}”.` : "No folders here.")}
          </p>
        ) : null}
        {showDeepSection && (rows.deep.length > 0 || deep.searching) ? (
          <div role="group" aria-label={`In ${deepRootLabel(homeDir)}`}>
            <div
              aria-hidden="true"
              className="flex items-center justify-between px-2.5 pt-3 pb-1 text-sm font-medium text-muted-foreground"
            >
              <span>In {deepRootLabel(homeDir)}</span>
              {deep.searching ? <span>Searching…</span> : null}
            </div>
            {rows.deep.map((row, deepIndex) => {
              const index = rows.local.length + deepIndex;
              return (
                <ProjectPickerRowItem
                  key={row.key}
                  id={rowElementId(listId, index)}
                  index={index}
                  row={row}
                  selected={index === selectedIndex}
                  onHover={() => setSelectedKey(row.key)}
                  onOpen={() => openRow(row)}
                />
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="flex h-12 items-center gap-4 border-t border-border px-4 text-sm font-medium text-muted-foreground">
        <KeyHint
          keys={[
            <ArrowUpIcon key="up" className="size-3" aria-label="Up" />,
            <ArrowDownIcon key="down" className="size-3" aria-label="Down" />,
          ]}
          label="Navigate"
        />
        <KeyHint keys={[<CornerDownLeftIcon key="enter" className="size-3" aria-label="Enter" />]} label="Open" />
        <KeyHint keys={[<ArrowLeftIcon key="left" className="size-3" aria-label="Left" />]} label="Back" />
        <KeyHint keys={["Esc"]} label="Close" />
        <button
          type="button"
          tabIndex={-1}
          title={`Add ${folderName(addTarget)} as a project`}
          className="ml-auto inline-flex h-8 items-center gap-2 rounded-lg px-2 outline-none hover:bg-accent/60"
          onClick={addProject}
        >
          <span className="text-muted-foreground">{shortcutLabel(platform, "Enter")}</span>
          <span className="font-semibold text-foreground">Add project</span>
        </button>
      </div>
    </div>
  );
}

export function ProjectPickerRowItem({
  id,
  index,
  row,
  selected,
  onHover,
  onOpen,
}: {
  id: string;
  index: number;
  row: ProjectPickerRow;
  selected: boolean;
  onHover: () => void;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    // Keyboard interaction lives on the combobox input (aria-activedescendant); options are focusable only programmatically.
    <div
      id={id}
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      data-index={index}
      data-section={row.section}
      title={row.entry.path}
      className={cn(
        "flex h-8 cursor-default items-center gap-2.5 rounded-lg px-2.5 text-base",
        selected ? "bg-muted/70" : "hover:bg-muted/40",
      )}
      onMouseMove={selected ? undefined : onHover}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 shrink truncate font-medium text-foreground">
        {highlightSegments(row.entry.name, row.match).map((segment, segmentIndex) =>
          segment.match ? (
            <mark
              key={segmentIndex}
              data-slot="project-picker-match"
              className="rounded-sm bg-foreground/10 text-foreground"
            >
              {segment.text}
            </mark>
          ) : (
            <Fragment key={segmentIndex}>{segment.text}</Fragment>
          ),
        )}
      </span>
      {row.parentLabel ? (
        <span className="min-w-0 flex-1 truncate font-normal text-muted-foreground">{row.parentLabel}</span>
      ) : (
        <span className="flex-1" />
      )}
      {row.entry.isGitRepo ? (
        <GitBranchIcon
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-label="Git repository"
          data-slot="project-picker-git"
        />
      ) : null}
    </div>
  );
}

function BreadcrumbButton({
  crumb,
  current,
  onNavigate,
}: {
  crumb: ProjectPickerBreadcrumb;
  current: boolean;
  onNavigate: () => void;
}): React.JSX.Element {
  const Icon = crumb.kind === "device" ? LaptopIcon : crumb.kind === "home" ? HouseIcon : null;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-current={current ? "location" : undefined}
      title={crumb.path}
      className={cn(
        "inline-flex h-7 min-w-0 shrink items-center gap-1.5 rounded-md px-1.5 outline-none hover:bg-accent/60",
        current ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onNavigate}
    >
      {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden="true" /> : null}
      <span className="truncate">{crumb.label}</span>
    </button>
  );
}

function KeyHint({ keys, label }: { keys: React.ReactNode[]; label: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center gap-1">
        {keys.map((key, index) => (
          <Kbd key={index} className="h-5 text-sm">
            {key}
          </Kbd>
        ))}
      </span>
      <span>{label}</span>
    </span>
  );
}

function focusInput(element: HTMLInputElement | null): void {
  element?.focus();
}

function rowElementId(listId: string, index: number): string {
  return `${listId}-option-${index}`;
}

function shortcutLabel(platform: string, key: string): string {
  return platform === "darwin" ? `⌘${key}` : `Ctrl ${key}`;
}

function deepRootLabel(homeDir: string): string {
  return homeDir ? "Home" : "this computer";
}

function listingErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/EACCES|EPERM/.test(message)) {
    return "You don't have permission to read this folder.";
  }
  if (/ENOENT/.test(message)) {
    return "This folder no longer exists.";
  }
  return "Unable to read this folder.";
}

import { useState } from "react";
import { Check, ChevronDown, GitBranch, Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LocalWorktree, LocalWorktreeContext, LocalWorktreeList } from "@/lib/local-worktrees";
import { useCloudMachinesStore } from "@/stores/cloud-machines-store";
import { useRoderStore } from "@/stores/roder-store";

function checkoutLabel(entry: LocalWorktree): string {
  return entry.branch ?? (entry.head ? `Detached ${entry.head.slice(0, 7)}` : "Checkout");
}

export function WorktreePicker({ disabled }: { disabled: boolean }): React.JSX.Element | null {
  const machine = useCloudMachinesStore((state) => state.selectedMachineId);
  const workspaceId = useRoderStore((state) => state.selectedWorkspaceId);
  const rootId = useRoderStore((state) => state.selectedRootId);
  if (machine || !workspaceId || !rootId || typeof window === "undefined" || !window.roderDesktop?.listWorktrees) {
    return null;
  }
  return (
    <LocalCheckoutPicker
      key={JSON.stringify([workspaceId, rootId])}
      context={{ workspaceId, rootId }}
      disabled={disabled}
    />
  );
}

function LocalCheckoutPicker({ context, disabled }: { context: LocalWorktreeContext; disabled: boolean }) {
  const draft = useRoderStore((state) => state.draftWorktree);
  const setDraft = useRoderStore((state) => state.setDraftWorktree);
  const syncWorkspaces = useRoderStore((state) => state.syncWorktreeWorkspaces);
  const [list, setList] = useState<LocalWorktreeList>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [managing, setManaging] = useState(false);
  const [branch, setBranch] = useState("");
  const [removing, setRemoving] = useState<LocalWorktree>();
  const [updating, setUpdating] = useState(false);
  const selectedPath = draft?.workspaceId === context.workspaceId && draft.rootId === context.rootId ? draft.path : "";
  const selection = list?.worktrees.find((entry) => entry.path === selectedPath);
  const triggerLabel = selectedPath ? (selection ? checkoutLabel(selection) : "Selected checkout") : "Checkout";

  function choose(path: string) {
    setDraft(path ? { ...context, path } : null);
  }

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setList(await window.roderDesktop.listWorktrees(context));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function create() {
    setUpdating(true);
    setError("");
    try {
      const entry = await window.roderDesktop.createWorktree(context, branch.trim());
      choose(entry.path);
      setBranch("");
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setUpdating(false);
    }
  }

  async function remove(entry: LocalWorktree) {
    setUpdating(true);
    setError("");
    try {
      const workspaces = await window.roderDesktop.removeWorktree(context, entry.path);
      if (selectedPath === entry.path) choose("");
      syncWorkspaces(workspaces);
      setRemoving(undefined);
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setUpdating(false);
    }
  }

  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) void refresh();
        }}
      >
        <DropdownMenuTrigger
          disabled={disabled}
          aria-label={`Git checkout: ${selectedPath ? triggerLabel : "Current folder"}`}
          title={selectedPath || "Choose the Git checkout for this new thread"}
          className="flex h-7 min-w-0 max-w-32 items-center gap-1 rounded-md px-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring @[520px]:h-8 @[520px]:max-w-44"
        >
          <GitBranch className="size-3.5 shrink-0" />
          <span className="hidden truncate @[520px]:inline">{triggerLabel}</span>
          <ChevronDown className="size-3.5 shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="max-h-72 w-64 overflow-y-auto">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => choose("")}>
              <Check className={`size-3.5 ${selectedPath ? "invisible" : ""}`} />
              Current folder
            </DropdownMenuItem>
            {!loading &&
              list?.worktrees
                .filter((entry) => !entry.missing && entry.path !== list.currentPath)
                .map((entry) => (
                  <DropdownMenuItem key={entry.path} title={entry.path} onSelect={() => choose(entry.path)}>
                    <Check className={`size-3.5 ${selectedPath === entry.path ? "" : "invisible"}`} />
                    <span className="truncate">{checkoutLabel(entry)}</span>
                    {entry.primary && <span className="ml-auto text-xs text-muted-foreground">Primary</span>}
                  </DropdownMenuItem>
                ))}
            {loading && (
              <div role="status" className="px-2 py-1 text-sm text-muted-foreground">
                Loading checkouts...
              </div>
            )}
            {!loading && error && (
              <div role="alert" className="px-2 py-1 text-sm break-words text-destructive">
                {error}
              </div>
            )}
            {!loading && !error && list && !list.currentPath && (
              <div className="px-2 py-1 text-sm text-muted-foreground">This folder is not a Git checkout.</div>
            )}
            {!loading && list?.currentPath && (
              <DropdownMenuItem
                onSelect={() => {
                  setError("");
                  setManaging(true);
                }}
              >
                <Settings2 className="size-3.5" />
                Manage worktrees
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={managing}
        onOpenChange={(open) => {
          if (updating) return;
          setManaging(open);
          if (!open) {
            setRemoving(undefined);
            setError("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{removing ? "Remove worktree?" : "Git worktrees"}</DialogTitle>
            <DialogDescription>
              {removing
                ? `Remove the checkout for ${checkoutLabel(removing)} from disk? The branch and archived thread history are kept.`
                : "Work in a separate checkout without switching branches in your current folder."}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="break-words text-sm text-destructive">
              {error}
            </p>
          )}
          {removing ? (
            <DialogFooter>
              <Button
                variant="outline"
                disabled={updating}
                onClick={() => {
                  setError("");
                  setRemoving(undefined);
                }}
              >
                Cancel
              </Button>
              <Button variant="warning" disabled={updating} onClick={() => void remove(removing)}>
                {updating ? "Removing..." : "Remove worktree"}
              </Button>
            </DialogFooter>
          ) : (
            <>
              <ul className="max-h-60 space-y-1 overflow-y-auto" aria-label="Repository checkouts">
                {list?.worktrees.map((entry) => (
                  <li key={entry.path} className="flex min-w-0 items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{checkoutLabel(entry)}</p>
                      <p title={entry.path} className="truncate text-xs text-muted-foreground">
                        {entry.path}
                      </p>
                    </div>
                    {entry.managed && !entry.locked ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={updating}
                        onClick={() => {
                          setError("");
                          setRemoving(entry);
                        }}
                      >
                        Remove
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {entry.primary ? "Primary" : entry.locked ? "Locked" : "External"}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!updating && branch.trim()) void create();
                }}
              >
                <input
                  aria-label="New branch name"
                  placeholder="New branch name"
                  value={branch}
                  disabled={updating}
                  className="h-8 min-w-0 flex-1 rounded-lg bg-background px-2.5 text-base ring-1 ring-border outline-none focus-visible:ring-ring"
                  onChange={(event) => setBranch(event.currentTarget.value)}
                />
                <Button type="submit" variant="outline" disabled={updating || !branch.trim()}>
                  <Plus className="size-4" />
                  {updating ? "Creating..." : "Create worktree"}
                </Button>
              </form>
              <p className="text-xs text-muted-foreground">
                A new worktree starts from the current folder's HEAD and is selected for this draft. To remove a Roder
                worktree, archive its threads, clear local files and changes, and merge its commits into the primary
                checkout.
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

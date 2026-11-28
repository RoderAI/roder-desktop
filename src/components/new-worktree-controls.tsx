import { useState } from "react";
import { Check, Circle, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DotMatrixSpinner } from "@/components/ui/dot-matrix-spinner";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  worktreeMatchesFolder,
  type LocalWorktree,
  type LocalWorktreeContext,
  type LocalWorktreeList,
  type WorktreeSetupStep,
} from "@/lib/local-worktrees";
import { useCloudMachinesStore } from "@/stores/cloud-machines-store";
import { useRoderStore } from "@/stores/roder-store";

export function NewWorktreeCheckbox({ disabled }: { disabled: boolean }): React.JSX.Element | null {
  const machine = useCloudMachinesStore((state) => state.selectedMachineId);
  const workspaceId = useRoderStore((state) => state.selectedWorkspaceId);
  const rootId = useRoderStore((state) => state.selectedRootId);
  if (
    machine ||
    !workspaceId ||
    !rootId ||
    typeof window === "undefined" ||
    !window.roderDesktop?.createThreadWorktree
  ) {
    return null;
  }
  return (
    <LocalWorktreeControls
      key={JSON.stringify([workspaceId, rootId])}
      context={{ workspaceId, rootId }}
      disabled={disabled}
    />
  );
}

function LocalWorktreeControls({ context, disabled }: { context: LocalWorktreeContext; disabled: boolean }) {
  const draft = useRoderStore((state) => state.draftWorktree);
  const setDraft = useRoderStore((state) => state.setDraftWorktree);
  const syncWorkspaces = useRoderStore((state) => state.syncWorktreeWorkspaces);
  const [list, setList] = useState<LocalWorktreeList>();
  const [error, setError] = useState("");
  const [managing, setManaging] = useState(false);
  const [removing, setRemoving] = useState<LocalWorktree>();
  const [updating, setUpdating] = useState(false);
  const checked = worktreeMatchesFolder(draft, context);

  useMountEffect(() => {
    let mounted = true;
    void window.roderDesktop.listWorktrees(context).then(
      (result) => {
        if (mounted) setList(result);
      },
      () => undefined,
    );
    return () => {
      mounted = false;
    };
  });

  async function refresh() {
    try {
      setList(await window.roderDesktop.listWorktrees(context));
    } catch (error) {
      setError((error as Error).message);
    }
  }

  async function remove(entry: LocalWorktree) {
    setUpdating(true);
    setError("");
    try {
      const workspaces = await window.roderDesktop.removeWorktree(context, entry.path);
      if (checked && draft.path === entry.path) setDraft(context);
      syncWorkspaces(workspaces);
      setRemoving(undefined);
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setUpdating(false);
    }
  }

  if (!list?.currentPath) return null;

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <label
        className="composer-toolbar-control flex h-7 items-center gap-1.5 rounded-lg px-2 text-base has-disabled:opacity-50"
        title="On first send, check out the current commit into a separate Git worktree."
      >
        <input
          type="checkbox"
          className="size-3.5 accent-foreground focus-visible:outline-ring"
          checked={checked}
          disabled={disabled}
          onChange={(event) => setDraft(event.currentTarget.checked ? context : null)}
        />
        New worktree
      </label>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label="Manage worktrees"
        title="Manage worktrees"
        disabled={disabled}
        onClick={() => {
          setError("");
          setManaging(true);
          void refresh();
        }}
      >
        <Settings2 className="size-3.5" />
      </Button>
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
                : "To remove a Roder worktree, archive its threads, clear local changes, and merge its commits."}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="break-words text-sm text-destructive">
              {error}
            </p>
          )}
          {removing ? (
            <DialogFooter>
              <Button variant="outline" disabled={updating} onClick={() => setRemoving(undefined)}>
                Cancel
              </Button>
              <Button variant="warning" disabled={updating} onClick={() => void remove(removing)}>
                {updating ? "Removing..." : "Remove worktree"}
              </Button>
            </DialogFooter>
          ) : (
            <ul className="max-h-60 space-y-1 overflow-y-auto" aria-label="Repository checkouts">
              {list.worktrees.map((entry) => (
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
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function checkoutLabel(entry: LocalWorktree): string {
  return entry.branch ?? (entry.head ? `Detached ${entry.head.slice(0, 7)}` : "Checkout");
}

const setupSteps: [WorktreeSetupStep, string][] = [
  ["preparing", "Prepare worktree"],
  ["checking-out", "Check out files"],
  ["starting-thread", "Start thread"],
];

export function WorktreeSetupProgress(): React.JSX.Element | null {
  const step = useRoderStore((state) => state.worktreeSetupStep);
  if (!step) return null;
  const activeIndex = setupSteps.findIndex(([id]) => id === step);

  return (
    <div className="rounded-t-xl border-b border-border bg-muted/30 px-3 py-2">
      <p className="sr-only" role="status">
        Setting up worktree: {setupSteps[activeIndex]?.[1]}
      </p>
      <ol className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" aria-label="Worktree setup progress">
        {setupSteps.map(([id, label], index) => (
          <li
            key={id}
            className={`flex items-center gap-1.5 ${index === activeIndex ? "text-foreground" : "text-muted-foreground"}`}
            aria-current={index === activeIndex ? "step" : undefined}
          >
            <span className="flex size-3.5 items-center justify-center" aria-hidden="true">
              {index < activeIndex ? (
                <Check className="size-3.5" />
              ) : index === activeIndex ? (
                <DotMatrixSpinner />
              ) : (
                <Circle className="size-2.5" />
              )}
            </span>
            {label}
          </li>
        ))}
      </ol>
    </div>
  );
}

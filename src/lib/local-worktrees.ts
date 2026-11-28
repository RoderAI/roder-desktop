export type LocalWorktree = {
  path: string;
  branch: string | null;
  head: string;
  primary: boolean;
  managed: boolean;
  locked: boolean;
  missing: boolean;
};

export type LocalWorktreeList = {
  worktrees: LocalWorktree[];
  currentPath?: string;
};

export type LocalWorktreeContext = {
  workspaceId: string;
  rootId: string;
};

export type DraftWorktree = LocalWorktreeContext & { path?: string };
export type WorktreeCheckoutStep = "checking-out";
export type WorktreeSetupStep = "preparing" | WorktreeCheckoutStep | "starting-thread";

export function worktreeMatchesFolder(
  worktree: DraftWorktree | null,
  context: LocalWorktreeContext,
): worktree is DraftWorktree {
  return worktree?.workspaceId === context.workspaceId && worktree.rootId === context.rootId;
}

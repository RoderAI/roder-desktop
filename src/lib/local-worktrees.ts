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

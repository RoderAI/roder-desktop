import { realpath } from "node:fs/promises";
import { isRemoteRunner } from "../../src/lib/cloud-machines";
import type { LocalWorktreeContext } from "../../src/lib/local-worktrees";
import type { RoderThread, Workspace, WorkspaceRoot } from "../../src/types/roder";
import { GitWorktrees, pathIsWithin } from "./git-worktrees";

type Request = (method: string, params: unknown) => Promise<unknown>;

export class DesktopWorktrees {
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly git: GitWorktrees,
    private readonly request: Request,
  ) {}

  async list(context: LocalWorktreeContext) {
    const { root } = await this.selection(context);
    return this.git.list(root.path);
  }

  create(context: LocalWorktreeContext, branch: string) {
    return this.serial(async () => {
      const { root } = await this.selection(context);
      return this.git.create(root.path, branch);
    });
  }

  remove(context: LocalWorktreeContext, path: string) {
    return this.serial(async () => {
      const { root, workspaces } = await this.selection(context);
      let registered: Workspace[] = [];
      await this.git.remove(root.path, path, async () => {
        const checkout = await canonicalPath(path);
        registered = workspaces.filter((workspace) =>
          workspace.roots.some((candidate) => pathIsWithin(checkout, candidate.path)),
        );
        if (
          registered.some((workspace) =>
            workspace.roots.some(
              (candidate) => candidate.id === workspace.defaultRootId && pathIsWithin(checkout, candidate.path),
            ),
          )
        ) {
          throw new Error("This worktree is a default workspace folder. Change that folder before removing it.");
        }
        let cursor: string | undefined;
        do {
          const page = (await this.request("thread/list", cursor ? { cursor } : {})) as {
            data: Pick<RoderThread, "cwd" | "runner">[];
            nextCursor?: string | null;
          };
          for (const thread of page.data) {
            if (
              thread.cwd &&
              !isRemoteRunner(thread.runner) &&
              pathIsWithin(checkout, await canonicalPath(thread.cwd))
            ) {
              throw new Error("Archive the threads using this worktree before removing it.");
            }
          }
          if (page.nextCursor && page.nextCursor === cursor) {
            throw new Error("Could not verify which threads use this worktree.");
          }
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
      });
      const updatedWorkspaces: Workspace[] = [];
      for (const workspace of registered) {
        updatedWorkspaces.push(
          await this.updateRoots(
            workspace,
            workspace.roots.filter((root) => !pathIsWithin(path, root.path)),
          ),
        );
      }
      return updatedWorkspaces;
    });
  }

  startThread(
    context: LocalWorktreeContext,
    path: string,
    start: (root: WorkspaceRoot) => Promise<unknown>,
  ): Promise<unknown> {
    return this.serial(async () => {
      let { workspace, root } = await this.selection(context);
      const checkout = await this.git.resolve(root.path, path);
      const matchesCheckout = (entry: WorkspaceRoot) =>
        pathIsWithin(entry.path, checkout.path) && pathIsWithin(checkout.path, entry.path);
      const existing = workspace.roots.find(matchesCheckout);
      if (existing) {
        root = existing;
      } else {
        const checkoutName = checkout.branch ?? `Detached ${checkout.head.slice(0, 7)}`;
        workspace = await this.updateRoots(workspace, [
          ...workspace.roots,
          { path: checkout.path, name: checkoutName },
        ]);
        const added = workspace.roots.find(matchesCheckout);
        if (!added) throw new Error("The app server did not register the worktree folder.");
        root = added;
      }
      const result = await start(root);
      return { ...(result as Record<string, unknown>), desktopWorktreeWorkspace: workspace };
    });
  }

  startInCurrentFolder(start: () => Promise<unknown>): Promise<unknown> {
    // A thread can also start in a registered worktree via the normal folder picker.
    return this.serial(start);
  }

  private async selection(context: LocalWorktreeContext) {
    const { workspaces } = (await this.request("workspace/list", {})) as { workspaces: Workspace[] };
    const workspace = workspaces.find((entry) => entry.id === context?.workspaceId);
    const root = workspace?.roots.find((entry) => entry.id === context?.rootId);
    if (!workspace || !root) throw new Error("Select a local workspace folder first.");
    return { workspace, root, workspaces };
  }

  private async updateRoots(workspace: Workspace, roots: { path: string; name: string }[]) {
    const result = (await this.request("workspace/update", {
      workspaceId: workspace.id,
      defaultRootId: workspace.defaultRootId,
      roots: roots.map(({ path, name }) => ({ path, name })),
    })) as { workspace: Workspace };
    return result.workspace;
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.then(operation);
    this.pending = next.catch(() => {});
    return next;
  }
}

function canonicalPath(path: string): Promise<string> {
  return realpath(path).catch(() => path);
}

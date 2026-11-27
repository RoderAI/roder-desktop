import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DesktopWorktrees } from "../electron/worktrees/desktop-worktrees";
import { GitWorktrees } from "../electron/worktrees/git-worktrees";
import type { Workspace } from "../src/types/roder";

let temp: string;
let repo: string;
let worktrees: GitWorktrees;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgSign=false", "-C", cwd, ...args], { encoding: "utf8" }).trim();
}

beforeEach(async () => {
  temp = await realpath(await mkdtemp(join(tmpdir(), "roder-worktrees-")));
  repo = join(temp, "repo with spaces");
  await mkdir(repo);
  git(repo, "init", "-b", "main");
  git(repo, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "Initial");
  worktrees = new GitWorktrees(join(temp, "managed"));
});

afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});

describe("local Git worktrees", () => {
  it("lists existing linked worktrees from any checkout and allows selecting them without managing them", async () => {
    const external = join(temp, "external checkout");
    git(repo, "worktree", "add", "-b", "external", external);
    expect(await worktrees.list(external)).toMatchObject({
      worktrees: [
        { path: repo, branch: "main", primary: true, managed: false },
        { path: external, branch: "external", primary: false, managed: false },
      ],
    });
    expect(await worktrees.resolve(repo, external)).toMatchObject({ path: external });
    await expect(worktrees.remove(repo, external, async () => {})).rejects.toThrow(/Roder-created/);
    await expect(worktrees.resolve(repo, temp)).rejects.toThrow(/no longer available/);
  });

  it("creates an isolated checkout, removes it, and retains the branch", async () => {
    const { path } = await worktrees.create(repo, "feature/test");
    expect(path).not.toBe(repo);
    expect(git(path, "branch", "--show-current")).toBe("feature/test");
    expect(git(repo, "branch", "--show-current")).toBe("main");
    expect((await worktrees.list(repo)).worktrees).toContainEqual(
      expect.objectContaining({ path, branch: "feature/test", managed: true }),
    );
    await worktrees.remove(repo, path, async () => {});
    expect((await worktrees.list(repo)).worktrees).toHaveLength(1);
    expect(git(repo, "branch", "--list", "feature/test")).toBe("feature/test");
  });

  it("refuses dirty and ignored files, unmerged commits, locked worktrees and a checkout in use", async () => {
    const { path } = await worktrees.create(repo, "feature");
    const remove = () => worktrees.remove(repo, path, async () => {});
    await writeFile(join(path, "local.txt"), "do not lose");
    await expect(remove()).rejects.toThrow(/local files or changes/);
    await writeFile(join(path, ".gitignore"), "local.txt\n");
    git(path, "add", ".gitignore");
    git(path, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "Ignore local file");
    await expect(remove()).rejects.toThrow(/local files or changes/);
    await rm(join(path, "local.txt"));
    await expect(remove()).rejects.toThrow(/not merged/);
    git(repo, "merge", "--ff-only", "feature");
    git(repo, "worktree", "lock", path);
    await expect(remove()).rejects.toThrow(/locked/);
    git(repo, "worktree", "unlock", path);
    await expect(
      worktrees.remove(repo, path, async () => {
        throw new Error("Archive the thread first");
      }),
    ).rejects.toThrow(/Archive the thread/);
    expect(await worktrees.resolve(repo, path)).toMatchObject({ path });
  });

  it("rejects invalid branches and gracefully reports a non-repository", async () => {
    expect(await worktrees.list(temp)).toEqual({ worktrees: [] });
    await expect(worktrees.create(repo, "--force")).rejects.toThrow(/branch name/);
    await expect(worktrees.create(repo, "two words")).rejects.toThrow(/branch name/);
  });

  it("cleans only the requested stale managed registration when its checkout is already missing", async () => {
    const { path } = await worktrees.create(repo, "stale");
    const unrelated = join(temp, "external stale");
    git(repo, "worktree", "add", "-b", "external", unrelated);
    await rm(path, { recursive: true });
    await rm(unrelated, { recursive: true });
    expect((await worktrees.list(repo)).worktrees).toContainEqual(expect.objectContaining({ path, missing: true }));
    await worktrees.remove(repo, path, async () => {});
    expect((await worktrees.list(repo)).worktrees.map((entry) => entry.path)).toEqual([repo, unrelated]);
  });

  it("binds a new thread to an isolated root, then drops that root only after the thread is archived", async () => {
    const original = { id: "original", path: repo, name: "Main folder" };
    let workspace: Workspace = {
      id: "project",
      name: "Project",
      roots: [original],
      defaultRootId: original.id,
      updatedAt: 1,
    };
    let threadCwd = "";
    const desktop = new DesktopWorktrees(worktrees, async (method, params) => {
      if (method === "workspace/list") return { workspaces: [workspace] };
      if (method === "workspace/update") {
        const input = params as { defaultRootId: string; roots: { path: string; name: string }[] };
        workspace = {
          ...workspace,
          defaultRootId: input.defaultRootId,
          roots: input.roots.map((root) => ({ ...root, id: root.path === repo ? original.id : "isolated" })),
        };
        return { workspace };
      }
      if (method === "thread/list") return { data: threadCwd ? [{ cwd: threadCwd }] : [] };
      throw new Error(`Unexpected method ${method}`);
    });
    const context = { workspaceId: workspace.id, rootId: original.id };
    const { path } = await desktop.create(context, "desktop");
    const result = await desktop.startThread(context, path, async (root) => {
      expect(root).toEqual({ id: "isolated", path, name: "desktop" });
      threadCwd = join(root.path, "subfolder");
      return { thread: { cwd: root.path, rootId: root.id } };
    });
    expect(result).toMatchObject({
      thread: { cwd: path, rootId: "isolated" },
      desktopWorktreeWorkspace: { id: workspace.id, defaultRootId: original.id },
    });
    await expect(desktop.remove(context, path)).rejects.toThrow(/Archive/);
    expect(workspace.roots).toHaveLength(2);
    threadCwd = "";
    await expect(desktop.remove(context, path)).resolves.toMatchObject([{ roots: [original] }]);
    await expect(
      desktop.startThread(context, path, async () => {
        throw new Error("Should not start a thread in a deleted checkout");
      }),
    ).rejects.toThrow(/no longer available/);
  });
});

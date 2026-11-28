import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { promisify } from "node:util";
import type { LocalWorktree, LocalWorktreeList, WorktreeCheckoutStep } from "../../src/lib/local-worktrees";

const exec = promisify(execFile);

export function pathIsWithin(root: string, candidate: string): boolean {
  if (!isAbsolute(candidate)) return false;
  const child = relative(gitPath(root), gitPath(candidate));
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

// The Windows app server returns canonical paths with an extended-length prefix;
// Git for Windows reports the equivalent checkout without that prefix.
function gitPath(path: string): string {
  if (process.platform !== "win32") return path;
  return path.replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\(?=[a-z]:\\)/i, "");
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  // An inherited Git environment must not redirect a command to another checkout.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")));
  const { stdout } = await exec("git", ["-c", "core.fsmonitor=false", "-C", gitPath(cwd), ...args], {
    env: { ...env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

export class GitWorktrees {
  constructor(private readonly managedRoot: string) {}

  async list(cwd: string): Promise<LocalWorktreeList> {
    let currentPath: string;
    try {
      currentPath = normalize((await git(cwd, "rev-parse", "--show-toplevel")).replace(/\r?\n$/, ""));
    } catch (error) {
      if (
        error instanceof Error &&
        /not a git repository|must be run in a work tree|cannot change to/.test(error.message)
      ) {
        return { worktrees: [] };
      }
      throw error;
    }
    const output = await git(cwd, "worktree", "list", "--porcelain", "-z");
    const records = output
      .split("\0\0")
      .filter(Boolean)
      .map((record) => record.split("\0"));
    const primaryEntry = records[0]?.[0];
    if (!primaryEntry?.startsWith("worktree ")) throw new Error("Git did not return a worktree list.");
    const managedDirectory = this.managedDirectory(normalize(primaryEntry.slice("worktree ".length)));
    return {
      currentPath,
      worktrees: records.flatMap(([entry, ...fields], index) => {
        if (fields.includes("bare")) return [];
        const path = normalize(entry.slice("worktree ".length));
        return [
          {
            path,
            branch:
              fields.find((field) => field.startsWith("branch refs/heads/"))?.slice("branch refs/heads/".length) ??
              null,
            head: fields.find((field) => field.startsWith("HEAD "))?.slice(5) ?? "",
            primary: index === 0,
            managed:
              index !== 0 &&
              relative(managedDirectory, dirname(path)) === "" &&
              /^worktree-[a-f0-9-]{36}$/.test(basename(path)),
            locked: fields.some((field) => field === "locked" || field.startsWith("locked ")),
            missing: fields.some((field) => field === "prunable" || field.startsWith("prunable ")),
          },
        ];
      }),
    };
  }

  createForThread(cwd: string, onProgress: (step: WorktreeCheckoutStep) => void): Promise<LocalWorktree> {
    return this.create(cwd, `roder-thread-${randomUUID()}`, onProgress);
  }

  async create(cwd: string, branch: string, onProgress?: (step: WorktreeCheckoutStep) => void): Promise<LocalWorktree> {
    if (typeof branch !== "string" || !branch || branch.startsWith("-") || branch.length > 200) {
      throw new Error("Enter a valid new Git branch name.");
    }
    try {
      await git(cwd, "check-ref-format", `refs/heads/${branch}`);
    } catch {
      throw new Error("Enter a valid new Git branch name.");
    }
    const { currentPath, worktrees } = await this.list(cwd);
    const primary = worktrees.find((entry) => entry.primary);
    if (!currentPath || !primary) throw new Error("Open a local Git repository with a primary checkout first.");
    const directory = this.managedDirectory(primary.path);
    await mkdir(directory, { recursive: true });
    const path = join(directory, `worktree-${randomUUID()}`);
    onProgress?.("checking-out");
    await git(currentPath, "worktree", "add", "-b", branch, "--", path, "HEAD");
    return this.resolve(cwd, path);
  }

  async resolve(cwd: string, path: string): Promise<LocalWorktree> {
    const entry = (await this.list(cwd)).worktrees.find((worktree) => worktree.path === path && !worktree.missing);
    if (!entry || !(await realpath(entry.path).catch(() => null))) {
      throw new Error("That Git checkout is no longer available. Select another checkout.");
    }
    return entry;
  }

  async remove(cwd: string, path: string, beforeRemove: () => Promise<void>): Promise<void> {
    const { worktrees } = await this.list(cwd);
    const primary = worktrees.find((entry) => entry.primary);
    const entry = worktrees.find((entry) => entry.path === path);
    if (!primary || !entry?.managed) throw new Error("Only Roder-created worktrees can be removed here.");
    if (entry.locked) throw new Error("This worktree is locked in Git.");
    await beforeRemove();
    if (!entry.missing || (await realpath(entry.path).catch(() => null))) {
      if (
        await git(
          entry.path,
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
          "--ignored",
          "--ignore-submodules=none",
        )
      ) {
        throw new Error("This worktree has local files or changes (including ignored files). Save or move them first.");
      }
    }
    try {
      await git(primary.path, "merge-base", "--is-ancestor", entry.head, "HEAD");
    } catch {
      throw new Error("This worktree has commits not merged into the primary checkout.");
    }
    // Never force removal: Git rechecks the lock and tracked/untracked changes.
    await git(primary.path, "worktree", "remove", "--", entry.path);
  }

  private managedDirectory(primaryPath: string): string {
    return join(this.managedRoot, createHash("sha256").update(gitPath(primaryPath)).digest("hex"));
  }
}

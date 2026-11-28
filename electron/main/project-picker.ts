import { access, opendir, stat } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { isAbsolute, join, resolve } from "node:path";

export type ProjectPickerEntry = {
  name: string;
  path: string;
  isGitRepo: boolean;
};

export type ProjectPickerListing = {
  path: string;
  entries: ProjectPickerEntry[];
  truncated: boolean;
};

/** What the renderer may ask for. The main process owns the search root and bounds. */
export type ProjectPickerSearchRequest = {
  query: string;
};

export type ProjectPickerSearchParams = {
  root: string;
  query: string;
  maxDepth?: number;
  limit?: number;
};

export type ProjectPickerSearchResult = {
  root: string;
  query: string;
  matches: ProjectPickerEntry[];
  truncated: boolean;
  canceled: boolean;
};

export const projectPickerListLimit = 10_000;
export const projectPickerSearchDefaults = {
  maxDepth: 5,
  limit: 60,
  maxVisitedDirectories: 40_000,
  timeBudgetMs: 1_500,
} as const;

// Directories that are expensive to walk and never hold a project worth adding.
const skippedDirectoryNames = new Set([
  "node_modules",
  "bower_components",
  "Library",
  "Applications",
  "Movies",
  "Music",
  "Pictures",
  "Photos",
  "Public",
  "target",
  "dist",
  "build",
  "out",
  "vendor",
  "Pods",
  "DerivedData",
  "coverage",
  "__pycache__",
  "venv",
  "site-packages",
]);

// macOS bundles and package-like directories that look like folders on disk.
const skippedDirectorySuffixes = [".app", ".photoslibrary", ".bundle", ".framework", ".xcassets", ".lproj"];

export function shouldSkipDirectoryInSearch(name: string): boolean {
  if (name.startsWith(".")) {
    return true;
  }
  if (skippedDirectoryNames.has(name)) {
    return true;
  }
  return skippedDirectorySuffixes.some((suffix) => name.endsWith(suffix));
}

export async function listProjectPickerDirectory(
  path: string,
  limit: number = projectPickerListLimit,
): Promise<ProjectPickerListing> {
  const directory = absoluteDirectory(path);
  const names: string[] = [];
  let truncated = false;
  // Read in batches so a huge folder is not loaded in full once the limit is reached.
  for await (const dirent of await opendir(directory, { bufferSize: 1_024 })) {
    if (names.length >= limit) {
      truncated = true;
      break;
    }
    if (dirent.isDirectory()) {
      names.push(dirent.name);
    } else if (dirent.isSymbolicLink() && (await isDirectory(join(directory, dirent.name)))) {
      names.push(dirent.name);
    }
  }
  const entries = await mapWithConcurrency(names, 64, async (name) => {
    const entryPath = join(directory, name);
    return { name, path: entryPath, isGitRepo: await isGitRepository(entryPath) };
  });
  entries.sort((left, right) => compareNames(left.name, right.name));
  return { path: directory, entries, truncated };
}

type SearchWorkerMessage =
  | { type: "match"; entry: ProjectPickerEntry }
  | { type: "done"; truncated: boolean }
  | { type: "error"; message: string };

/**
 * Breadth-first folder-name search under `root`, run in a worker thread with
 * synchronous reads so a slow or huge tree never occupies the main process's
 * libuv threadpool (shared with IPC file reads, the PTY, etc.). Bounded by depth,
 * result count, visited directory count and a wall-clock budget that the main
 * thread enforces even if a filesystem call hangs. Cancel via `signal`; the
 * worker is terminated. Hidden and heavy directories (node_modules, Library,
 * build output, app bundles, ...) are never matched or entered, and symlinks are
 * not followed.
 */
export function searchProjectPickerFolders(
  params: ProjectPickerSearchParams,
  signal?: AbortSignal,
  options: Partial<typeof projectPickerSearchDefaults> = {},
): Promise<ProjectPickerSearchResult> {
  const root = absoluteDirectory(params.root);
  const limits = { ...projectPickerSearchDefaults, ...options };
  const result: ProjectPickerSearchResult = {
    root,
    query: params.query,
    matches: [],
    truncated: false,
    canceled: false,
  };
  const query = params.query.trim().toLowerCase();
  if (!query) {
    return Promise.resolve(result);
  }
  if (signal?.aborted) {
    result.canceled = true;
    return Promise.resolve(result);
  }

  return new Promise((resolvePromise) => {
    const worker = new Worker(projectPickerSearchWorkerSource, {
      eval: true,
      workerData: {
        root,
        query,
        maxDepth: params.maxDepth ?? limits.maxDepth,
        limit: params.limit ?? limits.limit,
        maxVisitedDirectories: limits.maxVisitedDirectories,
        timeBudgetMs: limits.timeBudgetMs,
        skippedNames: [...skippedDirectoryNames],
        skippedSuffixes: skippedDirectorySuffixes,
      },
    });
    let settled = false;
    const finish = (update: Partial<ProjectPickerSearchResult>): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(hardDeadline);
      signal?.removeEventListener("abort", abort);
      void worker.terminate();
      Object.assign(result, update);
      if (result.canceled) {
        result.matches = [];
      }
      resolvePromise(result);
    };
    const abort = (): void => finish({ canceled: true });
    // The worker checks its own budget between directories; this covers a single blocking call.
    const hardDeadline = setTimeout(() => finish({ truncated: true }), limits.timeBudgetMs + 500);
    signal?.addEventListener("abort", abort, { once: true });
    worker.on("message", (message: SearchWorkerMessage) => {
      // Messages already queued by the worker can arrive after a cancel or timeout.
      if (settled) {
        return;
      }
      if (message.type === "match") {
        result.matches.push(message.entry);
      } else if (message.type === "done") {
        finish({ truncated: message.truncated });
      } else {
        finish({ truncated: true });
      }
    });
    worker.on("error", () => finish({ truncated: true }));
    worker.on("exit", () => finish({}));
  });
}

// Runs inside a worker_threads Worker (eval: true, CommonJS). Kept as source text,
// like the extension host runner, so it needs no separate bundler entry.
const projectPickerSearchWorkerSource = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const { existsSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

const { root, query, maxDepth, limit, maxVisitedDirectories, timeBudgetMs, skippedNames, skippedSuffixes } = workerData;
const skipped = new Set(skippedNames);
const deadline = Date.now() + timeBudgetMs;
let found = 0;
let visited = 0;
let queued = 1;
let truncated = false;
let dropped = false;

function shouldSkip(name) {
  return name.startsWith(".") || skipped.has(name) || skippedSuffixes.some((suffix) => name.endsWith(suffix));
}

try {
  let level = [root];
  for (let depth = 1; depth <= maxDepth && level.length > 0 && !truncated; depth += 1) {
    const nextLevel = [];
    for (const directory of level) {
      if (found >= limit || visited >= maxVisitedDirectories || Date.now() >= deadline) {
        truncated = true;
        break;
      }
      visited += 1;
      let dirents;
      try {
        dirents = readdirSync(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const dirent of dirents) {
        if (!dirent.isDirectory() || shouldSkip(dirent.name)) {
          continue;
        }
        const childPath = join(directory, dirent.name);
        if (found < limit && dirent.name.toLowerCase().includes(query)) {
          found += 1;
          parentPort.postMessage({
            type: "match",
            entry: { name: dirent.name, path: childPath, isGitRepo: existsSync(join(childPath, ".git")) },
          });
        }
        if (depth < maxDepth) {
          // Never queue more folders than the visit limit allows to be read.
          if (queued < maxVisitedDirectories) {
            queued += 1;
            nextLevel.push(childPath);
          } else {
            dropped = true;
          }
        }
      }
    }
    level = nextLevel;
  }
  parentPort.postMessage({ type: "done", truncated: truncated || dropped });
} catch (error) {
  parentPort.postMessage({ type: "error", message: String(error && error.message ? error.message : error) });
}
`;

/** One in-flight deep search per renderer; starting a new one cancels the previous. */
export class ProjectPickerSearchRegistry {
  private readonly controllers = new Map<number, AbortController>();
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async search(ownerId: number, request: ProjectPickerSearchRequest): Promise<ProjectPickerSearchResult> {
    this.cancel(ownerId);
    const controller = new AbortController();
    this.controllers.set(ownerId, controller);
    try {
      // Only the query is taken from the request, so it cannot move the root or raise the limits.
      return await searchProjectPickerFolders({ root: this.root, query: request.query }, controller.signal);
    } finally {
      if (this.controllers.get(ownerId) === controller) {
        this.controllers.delete(ownerId);
      }
    }
  }

  cancel(ownerId: number): void {
    this.controllers.get(ownerId)?.abort();
    this.controllers.delete(ownerId);
  }
}

function absoluteDirectory(path: string): string {
  if (typeof path !== "string" || !path || !isAbsolute(path)) {
    throw new Error("path must be absolute");
  }
  return resolve(path);
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isGitRepository(path: string): Promise<boolean> {
  try {
    await access(join(path, ".git"));
    return true;
  } catch {
    return false;
  }
}

function compareNames(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

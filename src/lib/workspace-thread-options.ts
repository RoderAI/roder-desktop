import type { RoderThread } from "@/types/roder";

export type FolderOption = {
  path: string;
  name: string;
  updatedAt: number;
  threadCount: number;
};

export function buildFolderOptions(threads: RoderThread[], activePath: string): FolderOption[] {
  const folders = new Map<string, FolderOption>();
  const activeFolderPath = normalizeWorkspacePath(activePath);

  if (activeFolderPath) {
    folders.set(activeFolderPath, {
      path: activeFolderPath,
      name: workspaceName(activeFolderPath),
      updatedAt: Date.now(),
      threadCount: 0,
    });
  }

  for (const thread of threads) {
    if (isDemoThread(thread)) {
      continue;
    }
    const path = normalizeWorkspacePath(thread.cwd);
    const existing = folders.get(path);
    folders.set(path, {
      path,
      name: existing?.name ?? workspaceName(path),
      updatedAt: Math.max(existing?.updatedAt ?? 0, normalizedTimestamp(thread.updatedAt)),
      threadCount: (existing?.threadCount ?? 0) + 1,
    });
  }

  return Array.from(folders.values()).toSorted((left, right) => {
    if (left.path === activeFolderPath) {
      return -1;
    }
    if (right.path === activeFolderPath) {
      return 1;
    }
    return right.updatedAt - left.updatedAt || left.name.localeCompare(right.name);
  });
}

export function buildThreadOptions(threads: RoderThread[], activePath: string): RoderThread[] {
  const selectedFolder = normalizeWorkspacePath(activePath);
  return threads
    .filter((thread) => !isDemoThread(thread) && normalizeWorkspacePath(thread.cwd) === selectedFolder)
    .sort((left, right) => normalizedTimestamp(right.updatedAt) - normalizedTimestamp(left.updatedAt));
}

export function latestThreadInFolder(threads: RoderThread[], path: string): RoderThread | undefined {
  return buildThreadOptions(threads, path)[0];
}

export function normalizeWorkspacePath(path: string | undefined): string {
  return (path || "").replace(/\/+$/, "") || path || "";
}

export function workspaceName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || "workspace";
}

export function normalizedTimestamp(timestamp: number): number {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 0;
  }
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

function isDemoThread(thread: RoderThread): boolean {
  return thread.id.startsWith("demo-");
}

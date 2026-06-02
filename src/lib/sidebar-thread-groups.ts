import type { RoderThread } from "@/types/roder";

export type SidebarThreadGroup = {
  key: string;
  title: string;
  path: string;
  threads: RoderThread[];
};

export function sidebarProjectOrder(threads: RoderThread[], currentOrder: string[]): string[] {
  const seenKeys: string[] = [];
  const seen = new Set<string>();

  for (const thread of threads) {
    if (thread.id.startsWith("demo-")) {
      continue;
    }
    const key = normalizeFolderKey(thread.cwd);
    if (!seen.has(key)) {
      seen.add(key);
      seenKeys.push(key);
    }
  }

  const existingOrder = currentOrder.filter((key) => seen.has(key));
  const knownKeys = new Set(existingOrder);
  const newKeys = seenKeys.filter((key) => !knownKeys.has(key));
  return [...newKeys, ...existingOrder];
}

export function groupThreadsByFolder(threads: RoderThread[], projectOrder: string[]): SidebarThreadGroup[] {
  const groups = new Map<string, SidebarThreadGroup>();

  for (const thread of threads) {
    if (thread.id.startsWith("demo-")) {
      continue;
    }
    const key = normalizeFolderKey(thread.cwd);
    const existing = groups.get(key);
    const group = existing ?? {
      key,
      title: folderName(thread.cwd),
      path: thread.cwd || "",
      threads: [],
    };
    group.threads.push(thread);
    groups.set(key, group);
  }

  const orderByKey = new Map(projectOrder.map((key, index) => [key, index]));
  return Array.from(groups.values()).toSorted((left, right) => {
    const leftIndex = orderByKey.get(left.key) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = orderByKey.get(right.key) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex || left.title.localeCompare(right.title);
  });
}

function normalizeFolderKey(path: string): string {
  return path || "workspace";
}

function folderName(path: string): string {
  return path?.split(/[\\/]/).filter(Boolean).pop() || "workspace";
}

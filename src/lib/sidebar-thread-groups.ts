import type { RoderThread } from "@/types/roder";

export type SidebarThreadGroup = {
  key: string;
  title: string;
  path: string;
  threads: RoderThread[];
};

export function sidebarProjectOrder(threads: RoderThread[], currentOrder: string[]): string[] {
  const latestByKey = new Map<string, number>();

  for (const thread of threads) {
    if (thread.id.startsWith("demo-")) {
      continue;
    }
    const key = normalizeFolderKey(thread.cwd);
    latestByKey.set(key, Math.max(latestByKey.get(key) ?? -Infinity, thread.updatedAt));
  }

  const existingOrder = currentOrder.filter((key) => latestByKey.has(key));
  const knownKeys = new Set(existingOrder);
  const newKeys = [...latestByKey.keys()]
    .filter((key) => !knownKeys.has(key))
    .toSorted((left, right) => (latestByKey.get(right) ?? 0) - (latestByKey.get(left) ?? 0) || left.localeCompare(right));
  return [...newKeys, ...existingOrder];
}

export function moveSidebarProject(order: string[], source: string, target: string): string[] {
  if (source === target || !order.includes(source) || !order.includes(target)) {
    return order;
  }
  const next = order.filter((key) => key !== source);
  next.splice(next.indexOf(target), 0, source);
  return next;
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
  for (const group of groups.values()) {
    group.threads.sort((left, right) => right.updatedAt - left.updatedAt);
  }
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

import type { RoderThread, WorkspaceFolder } from "@/types/roder";

export function normalizeThreadCwd(thread: RoderThread, baseCwd?: string): RoderThread {
  const cwd = normalizeCwd(thread.cwd, baseCwd);
  return cwd === thread.cwd ? thread : { ...thread, cwd };
}

export function normalizeThreadsCwd(threads: RoderThread[], baseCwd?: string): RoderThread[] {
  return threads.map((thread) => normalizeThreadCwd(thread, baseCwd));
}

export function normalizeCwd(cwd: string, baseCwd?: string): string {
  if (!cwd || cwd === ".") {
    return baseCwd || cwd || "";
  }
  if (cwd.startsWith("/") || !baseCwd) {
    return cwd;
  }
  return `${baseCwd.replace(/\/+$/, "")}/${cwd.replace(/^\/+/, "")}`;
}

export function requireAbsoluteCwd(cwd: string | undefined, baseCwd?: string): string {
  const normalized = normalizeCwd(cwd?.trim() ?? "", baseCwd).trim();
  if (!normalized || normalized === "." || !isAbsoluteCwd(normalized)) {
    throw new Error("Select a workspace before starting a thread");
  }
  return normalized;
}

function isAbsoluteCwd(cwd: string): boolean {
  return cwd.startsWith("/") || /^[A-Za-z]:[\\/]/.test(cwd) || cwd.startsWith("\\\\");
}

export function upsertWorkspaceRecent(recents: WorkspaceFolder[], path: string): WorkspaceFolder[] {
  if (!path) {
    return recents;
  }
  const normalized = path.replace(/\/+$/, "") || path;
  const next: WorkspaceFolder = {
    path: normalized,
    name: workspaceName(normalized),
    lastUsedAt: Date.now(),
  };
  return [next, ...recents.filter((recent) => recent.path !== normalized)]
    .sort((left, right) => right.lastUsedAt - left.lastUsedAt)
    .slice(0, 10);
}

function workspaceName(path: string): string {
  if (!path || path === ".") {
    return "workspace";
  }
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.split("/").filter(Boolean).pop() || "Home";
}

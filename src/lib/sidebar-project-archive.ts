const STORAGE_KEY = "sidebar-archived-projects";

export function readArchivedSidebarProjects(): string[] {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(saved) && saved.every((key) => typeof key === "string") ? saved : [];
  } catch {
    return [];
  }
}

export function setSidebarProjectArchived(keys: string[], key: string, archived: boolean): string[] {
  const next = archived ? [...new Set([...keys, key])] : keys.filter((item) => item !== key);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Archiving still works for this session when storage is unavailable.
  }
  return next;
}

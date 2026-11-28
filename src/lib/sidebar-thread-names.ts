const STORAGE_KEY = "sidebar-thread-names";

export function readSidebarThreadNames(): Map<string, string> {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      return new Map(
        Object.entries(saved).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string" && !!entry[1].trim(),
        ),
      );
    }
  } catch {
    // Storage may be unavailable or contain invalid JSON.
  }
  return new Map();
}

export function renameSidebarThread(
  names: ReadonlyMap<string, string>,
  threadId: string,
  name: string,
): Map<string, string> {
  const normalized = name.trim();
  const next = new Map(names);
  if (!normalized) return next;
  next.set(threadId, normalized);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(next)));
  } catch {
    // Keep the name for this session when storage is unavailable.
  }
  return next;
}

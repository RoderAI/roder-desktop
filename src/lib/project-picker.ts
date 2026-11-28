import type { ProjectPickerEntry } from "@/types/project-picker";

export const projectPickerLocalRowLimit = 200;
export const projectPickerDeepRowLimit = 50;
export const projectPickerDeepSearchMinQuery = 2;
export const projectPickerDeepSearchDebounceMs = 150;

export type ProjectPickerMatch = {
  start: number;
  end: number;
  rank: number;
};

export type ProjectPickerRow = {
  key: string;
  section: "local" | "deep";
  entry: ProjectPickerEntry;
  match: ProjectPickerMatch | null;
  /** Muted parent path shown for deep matches, e.g. `~/w/vex-intsearch`. */
  parentLabel: string | null;
};

export type ProjectPickerRows = {
  local: ProjectPickerRow[];
  deep: ProjectPickerRow[];
  all: ProjectPickerRow[];
  localHidden: number;
};

export type ProjectPickerBreadcrumb = {
  key: string;
  label: string;
  path: string;
  kind: "device" | "home" | "directory";
};

export type ProjectPickerKeyAction = "up" | "down" | "open" | "back" | "close" | "add";

export type ProjectPickerKeyInput = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  /** True when the search input caret is collapsed at position 0. */
  caretAtStart: boolean;
  queryEmpty: boolean;
  platform: string;
};

export type HighlightSegment = { text: string; match: boolean };

const wordBoundary = /[\s._\-/]/;

/**
 * Case-insensitive substring match. Lower rank is better:
 * 0 exact, 1 prefix, 2 word-boundary, 3 anywhere.
 */
export function matchFolderName(name: string, query: string): ProjectPickerMatch | null {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return null;
  }
  const haystack = name.toLowerCase();
  if (haystack === needle) {
    return { start: 0, end: name.length, rank: 0 };
  }
  if (haystack.startsWith(needle)) {
    return { start: 0, end: needle.length, rank: 1 };
  }
  let firstIndex = -1;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    if (firstIndex === -1) {
      firstIndex = index;
    }
    if (wordBoundary.test(haystack[index - 1] ?? "")) {
      return { start: index, end: index + needle.length, rank: 2 };
    }
    index = haystack.indexOf(needle, index + 1);
  }
  return firstIndex === -1 ? null : { start: firstIndex, end: firstIndex + needle.length, rank: 3 };
}

export function isHiddenFolderName(name: string): boolean {
  return name.startsWith(".");
}

/** Filter the current directory's folders for the query; hidden folders appear only when the query starts with ".". */
export function filterLocalFolders(
  entries: ProjectPickerEntry[],
  query: string,
): { rows: ProjectPickerRow[]; total: number } {
  const trimmed = query.trim();
  const includeHidden = trimmed.startsWith(".");
  const matched: ProjectPickerRow[] = [];
  for (const entry of entries) {
    if (!includeHidden && isHiddenFolderName(entry.name)) {
      continue;
    }
    if (!trimmed) {
      matched.push(localRow(entry, null));
      continue;
    }
    const match = matchFolderName(entry.name, trimmed);
    if (match) {
      matched.push(localRow(entry, match));
    }
  }
  if (trimmed) {
    matched.sort(compareRows);
  }
  return { rows: matched.slice(0, projectPickerLocalRowLimit), total: matched.length };
}

/**
 * Deeper matches elsewhere under the search root. Direct children of the current
 * directory are excluded because the local section already lists them. Results
 * from a previous, shorter query are re-filtered so the list narrows instantly
 * while the next search is still in flight.
 */
export function filterDeepFolders(
  matches: ProjectPickerEntry[],
  query: string,
  currentPath: string,
  homeDir: string,
): ProjectPickerRow[] {
  const trimmed = query.trim();
  if (trimmed.length < projectPickerDeepSearchMinQuery) {
    return [];
  }
  const current = trimTrailingSeparators(currentPath);
  const rows: ProjectPickerRow[] = [];
  const seen = new Set<string>();
  for (const entry of matches) {
    const parent = parentPath(entry.path);
    if (parent === current || seen.has(entry.path) || isHiddenFolderName(entry.name)) {
      continue;
    }
    const match = matchFolderName(entry.name, trimmed);
    if (!match) {
      continue;
    }
    seen.add(entry.path);
    rows.push({
      key: `deep:${entry.path}`,
      section: "deep",
      entry,
      match,
      parentLabel: parent ? displayPath(parent, homeDir) : null,
    });
  }
  rows.sort(
    (left, right) =>
      (left.match?.rank ?? 0) - (right.match?.rank ?? 0) ||
      depthOf(left.entry.path) - depthOf(right.entry.path) ||
      compareRows(left, right),
  );
  return rows.slice(0, projectPickerDeepRowLimit);
}

export function buildProjectPickerRows(args: {
  entries: ProjectPickerEntry[];
  deepMatches: ProjectPickerEntry[];
  query: string;
  currentPath: string;
  homeDir: string;
}): ProjectPickerRows {
  const local = filterLocalFolders(args.entries, args.query);
  const deep = filterDeepFolders(args.deepMatches, args.query, args.currentPath, args.homeDir);
  return {
    local: local.rows,
    deep,
    all: [...local.rows, ...deep],
    localHidden: local.total - local.rows.length,
  };
}

/**
 * Resolve the highlighted row index. Selection is tracked by path so it survives
 * async list updates. With no explicit selection, the first row is selected while
 * searching; with an empty query nothing is selected, meaning "the current folder".
 */
export function resolveSelectedIndex(rows: ProjectPickerRow[], selectedKey: string | null, query: string): number {
  if (selectedKey) {
    const index = rows.findIndex((row) => row.key === selectedKey);
    if (index !== -1) {
      return index;
    }
  }
  return query.trim() && rows.length > 0 ? 0 : -1;
}

/**
 * Move the highlighted row. `allowNone` (empty query) lets Up from the first row
 * return to "no selection", which targets the current folder.
 */
export function moveSelectionIndex(current: number, delta: 1 | -1, count: number, allowNone = false): number {
  if (count === 0) {
    return -1;
  }
  if (current === -1) {
    if (delta === 1) {
      return 0;
    }
    return allowNone ? -1 : count - 1;
  }
  if (allowNone && current === 0 && delta === -1) {
    return -1;
  }
  return Math.min(count - 1, Math.max(0, current + delta));
}

export function projectPickerKeyAction(input: ProjectPickerKeyInput): ProjectPickerKeyAction | null {
  if (input.isComposing) {
    return null;
  }
  const primary = input.platform === "darwin" ? input.metaKey : input.ctrlKey;
  const otherModifier = input.platform === "darwin" ? input.ctrlKey : input.metaKey;
  if (input.key === "Enter") {
    if (input.altKey || input.shiftKey || otherModifier) {
      return null;
    }
    return primary ? "add" : "open";
  }
  if (input.metaKey || input.ctrlKey || input.altKey) {
    return null;
  }
  switch (input.key) {
    case "ArrowDown":
      return input.shiftKey ? null : "down";
    case "ArrowUp":
      return input.shiftKey ? null : "up";
    case "ArrowLeft":
      return input.caretAtStart && !input.shiftKey ? "back" : null;
    case "Backspace":
      return input.queryEmpty && !input.shiftKey ? "back" : null;
    case "Escape":
      return "close";
    default:
      return null;
  }
}

export function highlightSegments(
  text: string,
  match: Pick<ProjectPickerMatch, "start" | "end"> | null,
): HighlightSegment[] {
  if (!match || match.end <= match.start) {
    return [{ text, match: false }];
  }
  const segments: HighlightSegment[] = [];
  if (match.start > 0) {
    segments.push({ text: text.slice(0, match.start), match: false });
  }
  segments.push({ text: text.slice(match.start, match.end), match: true });
  if (match.end < text.length) {
    segments.push({ text: text.slice(match.end), match: false });
  }
  return segments;
}

export function pathSeparator(path: string): "/" | "\\" {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

export function trimTrailingSeparators(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  if (!trimmed) {
    return path.startsWith("/") || path.startsWith("\\") ? path.slice(0, 1) : path;
  }
  // Keep Windows drive roots like "C:\".
  return /^[A-Za-z]:$/.test(trimmed) ? `${trimmed}${pathSeparator(path)}` : trimmed;
}

/** Parent directory, or null at a filesystem root. */
export function parentPath(path: string): string | null {
  const normalized = trimTrailingSeparators(path);
  const separator = pathSeparator(normalized);
  const root = windowsRoot(normalized);
  // Windows accepts both slashes, so a path under a Windows root may mix them.
  const index = root
    ? Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"))
    : normalized.lastIndexOf(separator);
  if (index === -1 || normalized === separator || normalized === root) {
    return null;
  }
  if (index === 0) {
    return separator;
  }
  const parent = normalized.slice(0, index);
  return /^[A-Za-z]:$/.test(parent) ? `${parent}${separator}` : parent;
}

export function isSameOrInside(path: string, ancestor: string): boolean {
  const child = trimTrailingSeparators(path);
  const base = trimTrailingSeparators(ancestor);
  if (child === base) {
    return true;
  }
  const separator = pathSeparator(base);
  return child.startsWith(base.endsWith(separator) ? base : `${base}${separator}`);
}

/** `~`-relative display path for paths under home, absolute otherwise. */
export function displayPath(path: string, homeDir: string): string {
  const normalized = trimTrailingSeparators(path);
  const home = homeDir ? trimTrailingSeparators(homeDir) : "";
  if (home && isSameOrInside(normalized, home)) {
    // A root home ("/" or "C:\") ends in a separator, so the remainder has none of its own.
    const rest = normalized.slice(home.length).replaceAll("\\", "/").replace(/^\//, "");
    return rest ? `~/${rest}` : "~";
  }
  return normalized;
}

export function folderName(path: string): string {
  const normalized = trimTrailingSeparators(path);
  const separator = pathSeparator(normalized);
  return normalized.slice(normalized.lastIndexOf(separator) + 1) || normalized;
}

/** Breadcrumb trail: device (filesystem root), Home when inside it, then each folder. */
export function projectPickerBreadcrumbs(path: string, homeDir: string, deviceName: string): ProjectPickerBreadcrumb[] {
  const normalized = trimTrailingSeparators(path);
  const separator = pathSeparator(normalized);
  const home = homeDir ? trimTrailingSeparators(homeDir) : "";
  const fsRoot = windowsRoot(normalized) ?? separator;
  const crumbs: ProjectPickerBreadcrumb[] = [{ key: "device", label: deviceName, path: fsRoot, kind: "device" }];

  let base = fsRoot;
  if (home && isSameOrInside(normalized, home)) {
    crumbs.push({ key: "home", label: "Home", path: home, kind: "home" });
    base = home;
  }
  const relative = normalized
    .slice(base.length)
    .split(/[\\/]+/)
    .filter(Boolean);
  let current = trimTrailingSeparators(base);
  for (const part of relative) {
    current = current.endsWith(separator) ? `${current}${part}` : `${current}${separator}${part}`;
    crumbs.push({ key: current, label: part, path: current, kind: "directory" });
  }
  return crumbs;
}

/**
 * Where the picker opens: the parent of the active project when it lives under
 * home (so sibling projects are one keystroke away), otherwise home.
 */
export function initialProjectPickerPath(activeCwd: string | undefined, homeDir: string): string {
  const home = trimTrailingSeparators(homeDir);
  if (activeCwd && home && isSameOrInside(activeCwd, home) && trimTrailingSeparators(activeCwd) !== home) {
    return parentPath(activeCwd) ?? home;
  }
  return home || "/";
}

export function deviceDisplayName(hostName: string | undefined): string {
  const name = (hostName ?? "").replace(/\.local$/i, "").trim();
  return name || "This computer";
}

/** The Windows root a path sits under: a drive ("C:\") or a UNC share ("\\server\share"). */
function windowsRoot(path: string): string | null {
  return /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/.exec(path)?.[0] ?? null;
}

function localRow(entry: ProjectPickerEntry, match: ProjectPickerMatch | null): ProjectPickerRow {
  return { key: `local:${entry.path}`, section: "local", entry, match, parentLabel: null };
}

function compareRows(left: ProjectPickerRow, right: ProjectPickerRow): number {
  const rankDelta = (left.match?.rank ?? 0) - (right.match?.rank ?? 0);
  if (rankDelta !== 0) {
    return rankDelta;
  }
  const lengthDelta = left.entry.name.length - right.entry.name.length;
  if (lengthDelta !== 0) {
    return lengthDelta;
  }
  return left.entry.name.localeCompare(right.entry.name, undefined, { sensitivity: "base", numeric: true });
}

function depthOf(path: string): number {
  return path.split(/[\\/]+/).filter(Boolean).length;
}

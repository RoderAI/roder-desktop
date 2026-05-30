import type {
  GitChangeStatus,
  HunkDiffLine,
  HunkRecord,
  PagedHunkDiff,
  WorkspaceChangeObservation,
  WorkspaceObservedFile,
} from "@/types/roder";

export type ReviewChangedFile = {
  path: string;
  status: GitChangeStatus;
  additions: number;
  deletions: number;
  hunkIds: string[];
  hunks: HunkRecord[];
};

export type ReviewObservedChangedFile = {
  path: string;
  oldPath?: string | null;
  status: GitChangeStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  observations: WorkspaceChangeObservation[];
  observedFiles: WorkspaceObservedFile[];
};

export type ReviewMergedChangedFile = {
  path: string;
  oldPath?: string | null;
  status: GitChangeStatus;
  additions: number;
  deletions: number;
  binary?: boolean;
  hunks?: HunkRecord[];
  observedFiles?: WorkspaceObservedFile[];
  source: "hunk" | "observed" | "mixed";
};

export type HunkSummary = {
  fileCount: number;
  latestTurnId: string;
  turnChangeCounts: Record<string, number>;
};

export type ReviewPatch = {
  patch: string;
  totalLines: number;
  truncated: boolean;
};

export function hunkToUnifiedPatch(hunk: HunkRecord, lines: HunkDiffLine[] = hunk.diff): string {
  const path = normalizePatchPath(hunk.path);
  const patchLines = [
    `diff --git a/${path} b/${path}`,
    hunk.oldLines === 0 ? "--- /dev/null" : `--- a/${path}`,
    hunk.newLines === 0 ? "+++ /dev/null" : `+++ b/${path}`,
    `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    ...lines.map(unifiedDiffLine),
    "",
  ];

  return patchLines.join("\n");
}

export function pagedHunkToUnifiedPatch(page: PagedHunkDiff): string {
  return hunkToUnifiedPatch(page.hunk, page.lines);
}

export function hunkPagesToReviewPatch(pages: PagedHunkDiff[]): ReviewPatch {
  const hunks = pages.map((page) => ({ ...page.hunk, diff: page.lines }));
  return {
    patch: hunksToUnifiedPatch(hunks),
    totalLines: pages.reduce((total, page) => total + page.totalLines, 0),
    truncated: pages.some((page) => page.nextOffset != null),
  };
}

export function groupHunksByFile(hunks: HunkRecord[]): ReviewChangedFile[] {
  const groups = new Map<string, ReviewChangedFile>();

  for (const hunk of hunks) {
    const additions = countLines(hunk.diff, "added");
    const deletions = countLines(hunk.diff, "removed");
    const existing = groups.get(hunk.path);

    if (existing) {
      existing.additions += additions;
      existing.deletions += deletions;
      existing.hunkIds.push(hunk.id);
      existing.hunks.push(hunk);
      existing.status = mergeStatuses(existing.status, deriveHunkStatus(hunk));
      continue;
    }

    groups.set(hunk.path, {
      path: hunk.path,
      status: deriveHunkStatus(hunk),
      additions,
      deletions,
      hunkIds: [hunk.id],
      hunks: [hunk],
    });
  }

  return Array.from(groups.values()).sort((left, right) => left.path.localeCompare(right.path));
}

export function groupObservedChangesByFile(observations: WorkspaceChangeObservation[]): ReviewObservedChangedFile[] {
  const groups = new Map<string, ReviewObservedChangedFile>();

  for (const observation of observations) {
    for (const file of observation.files) {
      const existing = groups.get(file.path);
      if (existing) {
        existing.oldPath = file.oldPath ?? existing.oldPath;
        existing.additions = file.additions;
        existing.deletions = file.deletions;
        existing.binary = file.binary;
        existing.status = file.status;
        existing.observations.push(observation);
        existing.observedFiles.push(file);
        continue;
      }

      groups.set(file.path, {
        path: file.path,
        oldPath: file.oldPath,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        binary: file.binary,
        observations: [observation],
        observedFiles: [file],
      });
    }
  }

  return Array.from(groups.values()).sort((left, right) => left.path.localeCompare(right.path));
}

export function mergeReviewChangedFiles(
  hunkFiles: ReviewChangedFile[],
  observedFiles: ReviewObservedChangedFile[],
): ReviewMergedChangedFile[] {
  const merged = new Map<string, ReviewMergedChangedFile>();

  for (const file of hunkFiles) {
    merged.set(file.path, {
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      hunks: file.hunks,
      source: "hunk",
    });
  }

  for (const file of observedFiles) {
    const existing = merged.get(file.path);
    if (!existing) {
      merged.set(file.path, {
        path: file.path,
        oldPath: file.oldPath,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        binary: file.binary,
        observedFiles: file.observedFiles,
        source: "observed",
      });
      continue;
    }
    merged.set(file.path, {
      ...existing,
      oldPath: existing.oldPath ?? file.oldPath,
      status: mergeStatuses(existing.status, file.status),
      additions: file.additions,
      deletions: file.deletions,
      binary: existing.binary || file.binary,
      observedFiles: file.observedFiles,
      source: "mixed",
    });
  }

  return Array.from(merged.values()).sort((left, right) => left.path.localeCompare(right.path));
}

export function changeCountsByTurn(
  hunks: HunkRecord[],
  observations: WorkspaceChangeObservation[] = [],
): Record<string, number> {
  const pathsByTurn = new Map<string, Set<string>>();

  for (const hunk of hunks) {
    const paths = pathsByTurn.get(hunk.turnId) ?? new Set<string>();
    paths.add(hunk.path);
    pathsByTurn.set(hunk.turnId, paths);
  }

  for (const observation of observations) {
    const paths = pathsByTurn.get(observation.turnId) ?? new Set<string>();
    for (const file of observation.files) {
      paths.add(file.path);
    }
    pathsByTurn.set(observation.turnId, paths);
  }

  return Object.fromEntries(Array.from(pathsByTurn.entries()).map(([turnId, paths]) => [turnId, paths.size]));
}

export function latestChangedTurnId(hunks: HunkRecord[], observations: WorkspaceChangeObservation[] = []): string {
  let latest = { turnId: "", timestamp: Number.NEGATIVE_INFINITY, order: -1 };
  let order = 0;
  for (const hunk of hunks) {
    if (hunk.turnId) {
      latest = latestCandidate(latest, hunk.turnId, hunk.createdAt, order);
    }
    order += 1;
  }
  for (const observation of observations) {
    if (observation.turnId) {
      latest = latestCandidate(latest, observation.turnId, observation.createdAt, order);
    }
    order += 1;
  }
  return latest.turnId;
}

export function reviewTurnIdCandidate(...turnIds: string[]): string {
  return turnIds.find((turnId) => turnId.length > 0) ?? "";
}

export function summarizeHunks(hunks: HunkRecord[]): HunkSummary {
  return summarizeReviewChanges(hunks, []);
}

export function summarizeReviewChanges(hunks: HunkRecord[], observations: WorkspaceChangeObservation[]): HunkSummary {
  const paths = new Set<string>();
  for (const file of groupHunksByFile(hunks)) {
    paths.add(file.path);
  }
  for (const file of groupObservedChangesByFile(observations)) {
    paths.add(file.path);
  }

  return {
    fileCount: paths.size,
    latestTurnId: latestChangedTurnId(hunks, observations),
    turnChangeCounts: changeCountsByTurn(hunks, observations),
  };
}

export function hunksToUnifiedPatch(hunks: HunkRecord[]): string {
  if (hunks.length === 0) {
    return "";
  }

  const first = hunks[0];
  const path = normalizePatchPath(first.path);
  const status = hunks.reduce<GitChangeStatus>(
    (current, hunk) => mergeStatuses(current, deriveHunkStatus(hunk)),
    deriveHunkStatus(first),
  );
  const patchLines = [
    `diff --git a/${path} b/${path}`,
    status === "added" ? "--- /dev/null" : `--- a/${path}`,
    status === "deleted" ? "+++ /dev/null" : `+++ b/${path}`,
  ];

  for (const hunk of hunks) {
    patchLines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    patchLines.push(...hunk.diff.map(unifiedDiffLine));
  }

  patchLines.push("");
  return patchLines.join("\n");
}

function unifiedDiffLine(line: HunkDiffLine): string {
  if (line.kind === "added") {
    return `+${line.text}`;
  }
  if (line.kind === "removed") {
    return `-${line.text}`;
  }
  return ` ${line.text}`;
}

function countLines(lines: HunkDiffLine[], kind: HunkDiffLine["kind"]): number {
  return lines.filter((line) => line.kind === kind).length;
}

function deriveHunkStatus(hunk: HunkRecord): GitChangeStatus {
  const additions = countLines(hunk.diff, "added");
  const deletions = countLines(hunk.diff, "removed");

  if (hunk.oldLines === 0 && additions > 0 && deletions === 0) {
    return "added";
  }
  if (hunk.newLines === 0 && deletions > 0 && additions === 0) {
    return "deleted";
  }
  return "modified";
}

function mergeStatuses(left: GitChangeStatus, right: GitChangeStatus): GitChangeStatus {
  return left === right ? left : "modified";
}

function latestCandidate(
  current: { turnId: string; timestamp: number; order: number },
  turnId: string,
  createdAt: string,
  order: number,
): { turnId: string; timestamp: number; order: number } {
  const timestamp = Date.parse(createdAt);
  const normalizedTimestamp = Number.isFinite(timestamp) ? timestamp : 0;
  if (normalizedTimestamp > current.timestamp || (normalizedTimestamp === current.timestamp && order > current.order)) {
    return { turnId, timestamp: normalizedTimestamp, order };
  }
  return current;
}

function normalizePatchPath(path: string): string {
  return path.replace(/^\/+/, "");
}

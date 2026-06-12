import { canonicalToolName } from "@/lib/tool-display";

export type ApplyPatchSummary = {
  files: string[];
  additions: number;
  deletions: number;
};

export function summarizeApplyPatch(patch: string | undefined): ApplyPatchSummary | null {
  if (!patch) {
    return null;
  }

  const files: string[] = [];
  let additions = 0;
  let deletions = 0;
  for (const line of patch.replace(/\r\n/g, "\n").split("\n")) {
    const fileHeader = parsePatchFileHeader(line);
    if (fileHeader) {
      files.push(fileHeader.newPath || fileHeader.oldPath);
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions += 1;
    }
  }

  return files.length > 0 || additions > 0 || deletions > 0 ? { files: uniqueStrings(files), additions, deletions } : null;
}

export type ToolPreviewKind = "text" | "patch";

export type ToolPreview = {
  kind: ToolPreviewKind;
  text: string;
};

export function toolPreviewKind(toolName: string | undefined): ToolPreviewKind {
  return canonicalToolName(toolName) === "apply_patch" ? "patch" : "text";
}

export function normalizedToolPreview(toolName: string | undefined, preview: string | undefined): ToolPreview | null {
  if (!preview) {
    return null;
  }
  if (toolPreviewKind(toolName) !== "patch") {
    return { kind: "text", text: preview };
  }
  return { kind: "patch", text: normalizeApplyPatchPreview(preview) ?? preview };
}

export function normalizeApplyPatchPreview(patch: string): string | undefined {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const normalized: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line === "*** Begin Patch" || line === "*** End Patch" || line === "") {
      index += 1;
      continue;
    }

    const fileHeader = parsePatchFileHeader(line);
    if (!fileHeader) {
      index += 1;
      continue;
    }

    const bodyStart = index + 1;
    let bodyEnd = bodyStart;
    while (bodyEnd < lines.length && !parsePatchFileHeader(lines[bodyEnd]) && lines[bodyEnd] !== "*** End Patch") {
      bodyEnd += 1;
    }

    normalized.push(...normalizeApplyPatchFile(fileHeader, lines.slice(bodyStart, bodyEnd)));
    index = bodyEnd;
  }

  return normalized.length > 0 ? `${normalized.join("\n")}\n` : undefined;
}

export function splitUnifiedDiffFiles(patch: string): string[] {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const files: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      pushCurrentUnifiedDiffFile(files, current);
      current = [line];
      continue;
    }
    if (current.length > 0) {
      current.push(line);
    }
  }

  pushCurrentUnifiedDiffFile(files, current);
  return files;
}

type PatchFileHeader = {
  newPath: string;
  oldPath: string;
  type: "add" | "delete" | "update";
};

function parsePatchFileHeader(line: string): PatchFileHeader | null {
  const updateMatch = /^\*\*\* Update File: (.+)$/.exec(line);
  if (updateMatch) {
    const path = updateMatch[1];
    return { newPath: path, oldPath: path, type: "update" };
  }

  const addMatch = /^\*\*\* Add File: (.+)$/.exec(line);
  if (addMatch) {
    const path = addMatch[1];
    return { newPath: path, oldPath: path, type: "add" };
  }

  const deleteMatch = /^\*\*\* Delete File: (.+)$/.exec(line);
  if (deleteMatch) {
    const path = deleteMatch[1];
    return { newPath: path, oldPath: path, type: "delete" };
  }

  return null;
}

function normalizeApplyPatchFile(header: PatchFileHeader, bodyLines: string[]): string[] {
  const oldPath = header.type === "add" ? "/dev/null" : `a/${header.oldPath}`;
  const newPath = header.type === "delete" ? "/dev/null" : `b/${header.newPath}`;
  return [
    `diff --git a/${header.oldPath} b/${header.newPath}`,
    `--- ${oldPath}`,
    `+++ ${newPath}`,
    ...normalizeApplyPatchBody(bodyLines, header.type),
  ];
}

type ApplyPatchHunk = {
  header?: string;
  lines: string[];
};

function normalizeApplyPatchBody(lines: string[], fileType: PatchFileHeader["type"]): string[] {
  const hunks = splitApplyPatchHunks(lines);
  const normalized: string[] = [];
  let oldStart = fileType === "add" ? 0 : 1;
  let newStart = fileType === "delete" ? 0 : 1;

  for (const hunk of hunks) {
    if (hunk.lines.length === 0) {
      continue;
    }

    const counts = applyPatchHunkCounts(hunk.lines);
    normalized.push(normalizeHunkHeader(hunk.header, oldStart, counts.oldCount, newStart, counts.newCount));
    normalized.push(...hunk.lines);

    oldStart += counts.oldCount;
    newStart += counts.newCount;
  }

  return normalized;
}

function splitApplyPatchHunks(lines: string[]): ApplyPatchHunk[] {
  const hunks: ApplyPatchHunk[] = [];
  let current: ApplyPatchHunk = { lines: [] };

  for (const line of lines) {
    if (line.startsWith("***")) {
      continue;
    }
    if (line.startsWith("@@")) {
      if (current.header || current.lines.length > 0) {
        hunks.push(current);
      }
      current = { header: line, lines: [] };
      continue;
    }
    current.lines.push(line);
  }

  if (current.header || current.lines.length > 0) {
    hunks.push(current);
  }

  return hunks;
}

function applyPatchHunkCounts(lines: string[]): { oldCount: number; newCount: number } {
  let oldCount = 0;
  let newCount = 0;

  for (const line of lines) {
    if (line.startsWith("\\")) {
      continue;
    }
    if (line.startsWith("+")) {
      newCount += 1;
      continue;
    }
    if (line.startsWith("-")) {
      oldCount += 1;
      continue;
    }
    oldCount += 1;
    newCount += 1;
  }

  return { oldCount, newCount };
}

function normalizeHunkHeader(
  line: string | undefined,
  oldStart: number,
  oldCount: number,
  newStart: number,
  newCount: number,
): string {
  const trimmed = line?.trim();
  if (trimmed && /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/.test(trimmed)) {
    return line ?? trimmed;
  }

  const suffix = trimmed && trimmed !== "@@" ? ` ${trimmed.replace(/^@@\s*/, "")}` : "";
  return `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${suffix}`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function pushCurrentUnifiedDiffFile(files: string[], current: string[]): void {
  const text = current.join("\n").trimEnd();
  if (text) {
    files.push(`${text}\n`);
  }
}

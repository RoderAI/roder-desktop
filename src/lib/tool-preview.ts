import { canonicalToolName } from "@/lib/tool-display";

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
    ...normalizeApplyPatchBody(bodyLines),
  ];
}

function normalizeApplyPatchBody(lines: string[]): string[] {
  return lines.flatMap((line) => {
    if (line.startsWith("***")) {
      return [];
    }
    if (line.startsWith("@@")) {
      return [normalizeHunkHeader(line)];
    }
    return [line];
  });
}

function normalizeHunkHeader(line: string): string {
  return /^@@(?:\s|$)/.test(line) ? "@@ -1,1 +1,1 @@" : line;
}

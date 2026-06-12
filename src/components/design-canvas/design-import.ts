import { roderIpc } from "@/lib/roder-ipc";
import type { DesignPatchOperation, RoderDesignNode } from "@/types/roder";
import type { DesignLibraryEntry, InsertKind, NodeDraft } from "./design-canvas-types";
import { DESIGN_LIBRARY_FILES } from "./design-canvas-types";
import { decodeBase64Text, GRID_SIZE, isRecord, uniqueStrings } from "./design-canvas-utils";
import { cloneDesignSubtree } from "./design-canvas-helpers";
import { designNodeForInsert } from "./design-templates";

export function importPencilLikeDesign(
  source: string,
  existingNodes: Record<string, RoderDesignNode>,
  fileName: string,
): { operations: DesignPatchOperation[]; selectedId: string | null } {
  const parsed = parseJsonObject(source, fileName);
  const rawNodes = collectImportableNodes(parsed);
  const operations: DesignPatchOperation[] = [];
  const usedIds = new Set(Object.keys(existingNodes));
  let selectedId: string | null = null;

  rawNodes.forEach((raw, index) => {
    const node = importedNodeFromRaw(raw, index, usedIds, fileName);
    if (!node) {
      return;
    }
    usedIds.add(node.id);
    operations.push({ op: "insert_node", parentId: null, node });
    selectedId = node.id;
  });

  return { operations, selectedId };
}

export function parseJsonObject(source: string, fileName: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error(
      `Could not parse ${fileName} as JSON/.pen: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function collectImportableNodes(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (!isRecord(parsed)) {
    return [];
  }
  const candidates = [parsed.nodes, parsed.layers, parsed.children, parsed.objects, parsed.items];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
    if (isRecord(candidate)) {
      return Object.values(candidate);
    }
  }
  if (typeof parsed.type === "string" || typeof parsed.kind === "string") {
    return [parsed];
  }
  return [];
}

export function importedNodeFromRaw(
  raw: unknown,
  index: number,
  usedIds: Set<string>,
  fileName: string,
): RoderDesignNode | null {
  if (!isRecord(raw)) {
    return null;
  }
  const sourceType = String(raw.type ?? raw.kind ?? "rectangle").toLowerCase();
  const kind = importKind(sourceType);
  const id = uniqueImportedNodeId(raw.id, index, usedIds);
  const rect = importedRect(raw, index);
  const name = String(raw.name ?? raw.label ?? `${kind[0]?.toUpperCase() ?? "N"}${kind.slice(1)} ${index + 1}`);
  const node = designNodeForInsert(kind, index + 1, index * GRID_SIZE, null, rect);
  const fill = importedPaint(raw.fill ?? raw.background ?? raw.backgroundColor ?? raw.color);
  const stroke = importedStroke(raw.stroke ?? raw.border ?? raw.borderColor, raw.strokeWidth ?? raw.borderWidth);

  return {
    ...node,
    id,
    name,
    rotation: importedNumber(raw.rotation ?? raw.rotate, null),
    opacity: importedNumber(raw.opacity, null),
    cornerRadius: importedNumber(raw.cornerRadius ?? raw.radius ?? raw.borderRadius, node.cornerRadius),
    fill: fill ?? node.fill,
    stroke: stroke ?? node.stroke,
    content: kind === "text" ? String(raw.content ?? raw.text ?? raw.value ?? node.content ?? "Text") : node.content,
    prompt: kind === "prompt" ? String(raw.prompt ?? raw.content ?? raw.text ?? node.prompt ?? "") : node.prompt,
    src: kind === "image" ? String(raw.src ?? raw.url ?? raw.href ?? node.src ?? "") : node.src,
    pathData: kind === "path" ? String(raw.pathData ?? raw.path ?? raw.d ?? node.pathData ?? "") : node.pathData,
    svg: kind === "icon" ? String(raw.svg ?? raw.pathData ?? raw.path ?? raw.d ?? node.svg ?? "") : node.svg,
    viewBox:
      kind === "path" || kind === "icon" ? String(raw.viewBox ?? raw.viewbox ?? node.viewBox ?? "") : node.viewBox,
    fontSize: kind === "text" ? importedNumber(raw.fontSize ?? raw.size, node.fontSize) : node.fontSize,
    fontWeight: kind === "text" ? importedNumber(raw.fontWeight ?? raw.weight, node.fontWeight) : node.fontWeight,
    textAlign: kind === "text" ? importTextAlign(raw.textAlign ?? raw.align, node.textAlign) : node.textAlign,
    source: { pencil: raw, importedFrom: fileName },
  };
}

export function importKind(sourceType: string): InsertKind {
  if (sourceType.includes("frame") || sourceType === "artboard" || sourceType === "screen") {
    return "frame";
  }
  if (sourceType.includes("text") || sourceType === "label") {
    return "text";
  }
  if (sourceType.includes("ellipse") || sourceType.includes("circle") || sourceType === "oval") {
    return "ellipse";
  }
  if (sourceType.includes("line") || sourceType === "connector") {
    return "line";
  }
  if (sourceType.includes("icon") || sourceType.includes("symbol")) {
    return "icon";
  }
  if (sourceType.includes("path") || sourceType.includes("vector") || sourceType === "bezier") {
    return "path";
  }
  if (sourceType.includes("image") || sourceType === "bitmap" || sourceType === "picture") {
    return "image";
  }
  if (sourceType.includes("prompt") || sourceType.includes("agent")) {
    return "prompt";
  }
  return "rectangle";
}

export function importedRect(raw: Record<string, unknown>, index: number): NodeDraft {
  const width = importedNumber(raw.width ?? raw.w, 180) ?? 180;
  const height = importedNumber(raw.height ?? raw.h, 120) ?? 120;
  return {
    x: importedNumber(raw.x ?? raw.left, 48 + index * GRID_SIZE) ?? 48 + index * GRID_SIZE,
    y: importedNumber(raw.y ?? raw.top, 48 + index * GRID_SIZE) ?? 48 + index * GRID_SIZE,
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

export function uniqueImportedNodeId(value: unknown, index: number, usedIds: Set<string>): string {
  const base =
    typeof value === "string" && value.trim()
      ? `import-${value.trim().replace(/[^a-z0-9_-]+/giu, "-")}`
      : `import-${index + 1}`;
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function importedPaint(value: unknown): unknown | null {
  if (typeof value === "string" && value.trim()) {
    return { kind: "color", value: value.trim() };
  }
  if (isRecord(value) && typeof value.value === "string") {
    return { kind: "color", value: value.value };
  }
  return null;
}

export function importedStroke(value: unknown, width: unknown): unknown | null {
  const paint = importedPaint(value);
  if (!paint || !isRecord(paint)) {
    return null;
  }
  return { ...paint, width: importedNumber(width, 1) ?? 1 };
}

export function importedNumber(value: unknown, fallback: unknown): number | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  return typeof fallback === "number" && Number.isFinite(fallback) ? fallback : null;
}

export function importTextAlign(value: unknown, fallback: unknown): string {
  return value === "center" || value === "right" || value === "left"
    ? value
    : fallback === "center" || fallback === "right"
      ? fallback
      : "left";
}

export async function scanDesignLibrariesFromWorkspace(
  workspaceRootPath: string,
  currentDesignPath: string,
): Promise<DesignLibraryEntry[]> {
  if (!workspaceRootPath) {
    return [];
  }
  const entries: DesignLibraryEntry[] = [];
  const currentPath = normalizePath(currentDesignPath);
  const candidatePaths = uniqueStrings(DESIGN_LIBRARY_FILES.map((file) => joinPath(workspaceRootPath, file)));
  for (const candidatePath of candidatePaths) {
    if (normalizePath(candidatePath) === currentPath) {
      continue;
    }
    try {
      const file = await roderIpc.readFile(candidatePath);
      const text = decodeBase64Text(file.dataBase64);
      const library = designLibraryFromText(text, candidatePath);
      if (library) {
        entries.push(library);
      }
    } catch {
      // Missing candidate paths are expected for most workspaces.
    }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

export function designLibraryFromText(text: string, path: string): DesignLibraryEntry | null {
  const parsed = safeJsonParse(text);
  if (!isRecord(parsed)) {
    return null;
  }
  const rawDocument = isRecord(parsed.document) ? parsed.document : parsed;
  const nodes = nodesRecordFromUnknown(rawDocument.nodes);
  const rootIds = Array.isArray(rawDocument.rootIds)
    ? rawDocument.rootIds.filter((id): id is string => typeof id === "string")
    : Object.values(nodes)
        .filter((node) => !node.parentId)
        .map((node) => node.id);
  const rootNodes = rootIds.map((id) => nodes[id]).filter((node): node is RoderDesignNode => Boolean(node));
  if (rootNodes.length === 0) {
    return null;
  }
  const title =
    typeof rawDocument.title === "string" && rawDocument.title.trim()
      ? rawDocument.title.trim()
      : path.split("/").pop();
  return {
    id: `library:${normalizePath(path)}`,
    name: title || ".roderdesign library",
    path,
    nodeCount: Object.keys(nodes).length,
    nodes,
    rootNodes: rootNodes.map((node) => ({
      ...node,
      source: { ...(isRecord(node.source) ? node.source : {}), libraryPath: path },
    })),
    variables: isRecord(rawDocument.variables) ? rawDocument.variables : {},
  };
}

export function nodesRecordFromUnknown(value: unknown): Record<string, RoderDesignNode> {
  if (!isRecord(value)) {
    return {};
  }
  const nodes: Record<string, RoderDesignNode> = {};
  for (const [id, node] of Object.entries(value)) {
    if (!isRecord(node)) {
      continue;
    }
    nodes[id] = {
      id: typeof node.id === "string" ? node.id : id,
      type: typeof node.type === "string" ? node.type : "rectangle",
      name: typeof node.name === "string" ? node.name : id,
      ...node,
    } as RoderDesignNode;
  }
  return nodes;
}

export function cloneLibraryNode(
  source: RoderDesignNode,
  library: DesignLibraryEntry,
): { rootId: string; operations: DesignPatchOperation[] } {
  return cloneDesignSubtree(library.nodes, source, null, {
    rootPatch: {
      name: `${source.name} Library Copy`,
      x: 72,
      y: 72,
      source: { library: true, libraryName: library.name, libraryPath: library.path, sourceNodeId: source.id },
    },
  });
}

export function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function joinPath(root: string, file: string): string {
  return `${root.replace(/\/+$/u, "")}/${file.replace(/^\/+/, "")}`;
}

export function normalizePath(path: string): string {
  return path.replace(/\\/gu, "/").replace(/\/+/gu, "/");
}



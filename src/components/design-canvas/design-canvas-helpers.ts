import { roderIpc } from "@/lib/roder-ipc";
import { cn } from "@/lib/utils";
import type {
  DesignDocumentResult,
  DesignPatchOperation,
  DesignSpawnAgentsResult,
  RoderDesignNode,
} from "@/types/roder";
import type {
  ChildArrangeMode,
  ChildLayerMode,
  DesignAgentActivity,
  DesignAgentLaunchPlanItem,
  DesignAgentPermissions,
  DesignClipboardPayload,
  DesignLayoutDiagnostics,
  DesignPatchSummary,
  DesignViewport,
  InsertKind,
  LayerOrderMode,
  NodeDraft,
  ThemeScanResult,
} from "./design-canvas-types";
import { THEME_SCAN_FILES } from "./design-canvas-types";
import { decodeBase64Text, GRID_SIZE, isRecord, uniqueStrings } from "./design-canvas-utils";

export function importedSourceLabel(node: RoderDesignNode): string | null {
  if (!isRecord(node.source) || typeof node.source.importedFrom !== "string") {
    return null;
  }
  return node.source.importedFrom;
}

export function templateSourceLabel(node: RoderDesignNode): string | null {
  if (!isRecord(node.source)) {
    return null;
  }
  if (node.source.template === true) {
    return "built-in layout";
  }
  if (typeof node.source.templateElement === "string") {
    return node.source.templateElement;
  }
  return null;
}

export function describePatchOperations(operations: DesignPatchOperation[]): string {
  if (operations.length === 0) {
    return "empty change";
  }
  if (operations.length === 1) {
    const [operation] = operations;
    if (!operation) {
      return "change";
    }
    if (operation.op === "insert_node") {
      return `Insert ${operation.node.name}`;
    }
    if (operation.op === "update_node") {
      return `Edit ${operation.nodeId}`;
    }
    if (operation.op === "delete_node") {
      return `Delete ${operation.nodeId}`;
    }
    if (operation.op === "set_variables") {
      return "Update design tokens";
    }
    if (operation.op === "reorder_node") {
      return `Reorder ${operation.nodeId}`;
    }
  }
  return `${operations.length} design changes`;
}

export function summarizePatchOperations(
  operations: DesignPatchOperation[],
  document: DesignDocumentResult["document"],
): DesignPatchSummary {
  const summary: DesignPatchSummary = {
    inserted: 0,
    updated: 0,
    deleted: 0,
    variablesChanged: false,
    details: [],
  };
  const touchedNodes = new Set<string>();

  for (const operation of operations) {
    if (operation.op === "insert_node") {
      summary.inserted += countInsertedNode(operation.node);
      pushPatchDetail(summary, `Inserted ${operation.node.name || operation.node.id}`);
      continue;
    }
    if (operation.op === "update_node") {
      summary.updated += 1;
      const node = document.nodes[operation.nodeId];
      const name = node?.name || operation.nodeId;
      if (!touchedNodes.has(operation.nodeId)) {
        touchedNodes.add(operation.nodeId);
        pushPatchDetail(summary, `Edited ${name}${patchFieldSummary(operation.patch)}`);
      }
      continue;
    }
    if (operation.op === "delete_node") {
      const node = document.nodes[operation.nodeId];
      summary.deleted += operation.recursive ? countNodeSubtree(document, operation.nodeId) : 1;
      pushPatchDetail(summary, `Deleted ${node?.name || operation.nodeId}`);
      continue;
    }
    if (operation.op === "set_variables") {
      summary.variablesChanged = true;
      const count = Object.keys(operation.variables).length;
      pushPatchDetail(summary, `${operation.replace ? "Replaced" : "Updated"} ${count} token${count === 1 ? "" : "s"}`);
      continue;
    }
    if (operation.op === "reorder_node") {
      summary.updated += 1;
      const node = document.nodes[operation.nodeId];
      pushPatchDetail(summary, `Reordered ${node?.name || operation.nodeId} to layer ${operation.index + 1}`);
    }
  }

  return summary;
}

export function pushPatchDetail(summary: DesignPatchSummary, detail: string): void {
  if (summary.details.length < 5 && !summary.details.includes(detail)) {
    summary.details.push(detail);
  }
}

export function countInsertedNode(node: RoderDesignNode): number {
  return 1 + (node.childIds?.length ?? 0);
}

export function countNodeSubtree(document: DesignDocumentResult["document"], nodeId: string): number {
  const node = document.nodes[nodeId];
  if (!node) {
    return 1;
  }
  return 1 + (node.childIds ?? []).reduce((count, childId) => count + countNodeSubtree(document, childId), 0);
}

export function patchFieldSummary(patch: Partial<RoderDesignNode>): string {
  const fields = Object.keys(patch).filter((field) => !["id", "childIds", "parentId"].includes(field));
  if (fields.length === 0) {
    return "";
  }
  return ` (${fields.slice(0, 3).join(", ")}${fields.length > 3 ? ", ..." : ""})`;
}

export function designRestoreOperations(
  current: DesignDocumentResult["document"],
  snapshot: DesignDocumentResult["document"],
): DesignPatchOperation[] {
  const operations: DesignPatchOperation[] = [];
  for (const node of Object.values(current.nodes)) {
    if (!snapshot.nodes[node.id]) {
      operations.push({ op: "delete_node", nodeId: node.id, recursive: true });
    }
  }
  for (const rootId of snapshot.rootIds) {
    appendRestoreNode(snapshot, current, rootId, null, operations);
  }
  if (!jsonEqual(current.variables, snapshot.variables)) {
    operations.push({ op: "set_variables", variables: snapshot.variables, replace: true });
  }
  return operations;
}

export function appendRestoreNode(
  snapshot: DesignDocumentResult["document"],
  current: DesignDocumentResult["document"],
  nodeId: string,
  parentId: string | null,
  operations: DesignPatchOperation[],
): void {
  const snapshotNode = snapshot.nodes[nodeId];
  if (!snapshotNode) {
    return;
  }
  const currentNode = current.nodes[nodeId];
  if (!currentNode) {
    operations.push({ op: "insert_node", parentId, node: { ...snapshotNode, parentId } });
  } else if (currentNode !== snapshotNode || (snapshotNode.parentId ?? null) !== parentId) {
    // Snapshots share structure with the live document, so untouched nodes hit
    // the identity check above and never pay for a JSON comparison.
    const restoredNode = { ...snapshotNode, parentId };
    if (!jsonEqual(currentNode, restoredNode)) {
      operations.push({ op: "update_node", nodeId, patch: restoredNode });
    }
  }
  for (const childId of snapshotNode.childIds ?? []) {
    appendRestoreNode(snapshot, current, childId, nodeId, operations);
  }
}

export function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

export function cloneDesignSubtree(
  nodes: Record<string, RoderDesignNode>,
  source: RoderDesignNode,
  parentId: string | null,
  options: { rootPatch?: Partial<RoderDesignNode> } = {},
): { rootId: string; operations: Parameters<typeof roderIpc.patchDesign>[2] } {
  const operations: Parameters<typeof roderIpc.patchDesign>[2] = [];

  function cloneNode(node: RoderDesignNode, nextParentId: string | null, isRoot: boolean): string {
    const nextId = crypto.randomUUID();
    const nextNode: RoderDesignNode = {
      ...node,
      ...(isRoot ? options.rootPatch : null),
      id: nextId,
      name: isRoot ? String(options.rootPatch?.name ?? `${node.name} Copy`) : node.name,
      parentId: nextParentId,
      childIds: [],
      x: Number(node.x ?? 0) + (isRoot ? GRID_SIZE : 0),
      y: Number(node.y ?? 0) + (isRoot ? GRID_SIZE : 0),
    };
    operations.push({ op: "insert_node", parentId: nextParentId, node: nextNode });
    (node.childIds ?? [])
      .map((childId) => nodes[childId])
      .filter((child): child is RoderDesignNode => Boolean(child))
      .forEach((child) => cloneNode(child, nextId, false));
    return nextId;
  }

  const rootId = cloneNode(source, parentId, true);
  return { rootId, operations };
}

export function designClipboardPayload(
  nodes: Record<string, RoderDesignNode>,
  source: RoderDesignNode,
): DesignClipboardPayload {
  const payloadNodes: Record<string, RoderDesignNode> = {};
  const visit = (node: RoderDesignNode): void => {
    payloadNodes[node.id] = { ...node, parentId: node.id === source.id ? null : (node.parentId ?? null) };
    for (const childId of node.childIds ?? []) {
      const child = nodes[childId];
      if (child) {
        visit(child);
      }
    }
  };
  visit(source);
  return { kind: "roder-design-node", version: 1, rootId: source.id, nodes: payloadNodes };
}

export function parseDesignClipboardPayload(text: string): DesignClipboardPayload | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed) || parsed.kind !== "roder-design-node" || parsed.version !== 1) {
      return null;
    }
    if (typeof parsed.rootId !== "string" || !isRecord(parsed.nodes)) {
      return null;
    }
    const nodes: Record<string, RoderDesignNode> = {};
    for (const [id, value] of Object.entries(parsed.nodes)) {
      if (!isRecord(value) || typeof value.id !== "string" || typeof value.type !== "string") {
        return null;
      }
      nodes[id] = value as RoderDesignNode;
    }
    return { kind: "roder-design-node", version: 1, rootId: parsed.rootId, nodes };
  } catch {
    return null;
  }
}

export function canMakeComponent(node: RoderDesignNode): boolean {
  return (
    node.type === "frame" ||
    node.type === "group" ||
    node.type === "rectangle" ||
    node.type === "text" ||
    node.type === "image" ||
    node.type === "prompt"
  );
}

export function canGroupNode(document: DesignDocumentResult["document"], node: RoderDesignNode): boolean {
  const parent = node.parentId ? document.nodes[node.parentId] : null;
  return Boolean(
    parent &&
    canContainChildren(parent) &&
    node.type !== "group" &&
    node.type !== "component" &&
    node.type !== "instance",
  );
}

export function canUngroupNode(document: DesignDocumentResult["document"], node: RoderDesignNode): boolean {
  return (
    node.type === "group" && Boolean(node.parentId && document.nodes[node.parentId]) && (node.childIds?.length ?? 0) > 0
  );
}

export function designGroupForNode(node: RoderDesignNode, parentId: string): RoderDesignNode {
  const rect = nodeRect(node);
  return {
    id: crypto.randomUUID(),
    type: "group",
    name: `Group ${node.name}`,
    parentId,
    childIds: [],
    x: rect.x,
    y: rect.y,
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height),
    visible: true,
    locked: false,
    fill: { kind: "color", value: "transparent" },
    stroke: { kind: "color", value: "#94a3b8", width: 1 },
    source: { groupedFrom: node.id },
  };
}

export function replaceChildId(childIds: string[], targetId: string, replacement: string | string[]): string[] {
  const replacements = Array.isArray(replacement) ? replacement : [replacement];
  const next: string[] = [];
  let replaced = false;
  for (const childId of childIds) {
    if (childId === targetId) {
      next.push(...replacements);
      replaced = true;
    } else {
      next.push(childId);
    }
  }
  if (!replaced) {
    next.push(...replacements);
  }
  return uniqueStrings(next);
}

export function normalizeLayerQuery(value: string): string {
  return value.trim().toLowerCase();
}

export function matchingLayerIds(nodes: Record<string, RoderDesignNode>, rootIds: string[], query: string): Set<string> {
  const matches = new Set<string>();
  const visit = (nodeId: string): boolean => {
    const node = nodes[nodeId];
    if (!node) {
      return false;
    }
    const directMatch = layerNodeMatches(node, query);
    const childMatch = (node.childIds ?? []).some((childId) => visit(childId));
    if (directMatch || childMatch) {
      matches.add(node.id);
      return true;
    }
    return false;
  };
  for (const id of rootIds) {
    visit(id);
  }
  return matches;
}

export function firstMatchingLayerId(nodes: Record<string, RoderDesignNode>, rootIds: string[], query: string): string | null {
  const visit = (nodeId: string): string | null => {
    const node = nodes[nodeId];
    if (!node) {
      return null;
    }
    if (layerNodeMatches(node, query)) {
      return node.id;
    }
    for (const childId of node.childIds ?? []) {
      const match = visit(childId);
      if (match) {
        return match;
      }
    }
    return null;
  };
  for (const id of rootIds) {
    const match = visit(id);
    if (match) {
      return match;
    }
  }
  return null;
}

export function layerNodeMatches(node: RoderDesignNode, query: string): boolean {
  if (!query) {
    return true;
  }
  const haystack = [
    node.id,
    node.name,
    node.type,
    typeof node.content === "string" ? node.content : null,
    typeof node.prompt === "string" ? node.prompt : null,
    typeof node.componentId === "string" ? node.componentId : null,
    typeof node.sourceComponentId === "string" ? node.sourceComponentId : null,
    colorValue(node.fill),
    colorValue(node.stroke),
    importedSourceLabel(node),
    templateSourceLabel(node),
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export function componentIdForNode(node: RoderDesignNode): string {
  const existing = typeof node.componentId === "string" && node.componentId ? node.componentId : null;
  return existing ?? `component:${node.id}`;
}

export function componentBadgeLabel(node: RoderDesignNode): string {
  if (node.type === "instance") {
    const overrideCount = instanceOverrideFields(node).length;
    return overrideCount > 0 ? `Instance · ${overrideCount}` : "Instance";
  }
  return "Component";
}

export function instanceOverrideFields(node: RoderDesignNode): string[] {
  if (!Array.isArray(node.overrides)) {
    return [];
  }
  return node.overrides.filter((field): field is string => typeof field === "string" && field.length > 0).sort();
}

export function patchWithInstanceOverrides(node: RoderDesignNode, patch: Partial<RoderDesignNode>): Partial<RoderDesignNode> {
  if (node.type !== "instance") {
    return patch;
  }
  const overrideFields = Object.keys(patch).filter(isInstanceOverrideField);
  if (overrideFields.length === 0) {
    return patch;
  }
  return {
    ...patch,
    overrides: Array.from(new Set([...instanceOverrideFields(node), ...overrideFields])).sort(),
  };
}

export function isInstanceOverrideField(field: string): boolean {
  return ![
    "id",
    "type",
    "name",
    "parentId",
    "childIds",
    "componentId",
    "sourceComponentId",
    "reusable",
    "overrides",
  ].includes(field);
}

export function nodeRect(node: RoderDesignNode): NodeDraft {
  return {
    x: Number(node.x ?? 0),
    y: Number(node.y ?? 0),
    width: Number(node.width ?? 320),
    height: Number(node.height ?? 180),
  };
}

export function nodeAbsoluteBounds(document: DesignDocumentResult["document"], node: RoderDesignNode): NodeDraft {
  const rect = nodeRect(node);
  let x = rect.x;
  let y = rect.y;
  let parentId = node.parentId ?? null;
  const seen = new Set<string>([node.id]);
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = document.nodes[parentId];
    if (!parent) {
      break;
    }
    const parentRect = nodeRect(parent);
    x += parentRect.x;
    y += parentRect.y;
    parentId = parent.parentId ?? null;
  }
  return { ...rect, x, y };
}

export function nodeMeasurements(
  document: DesignDocumentResult["document"],
  node: RoderDesignNode,
  rect: NodeDraft,
): { sizeLabel: string; spacingLabel: string | null } {
  const sizeLabel = `${Math.round(rect.width)} x ${Math.round(rect.height)}`;
  const parent = node.parentId ? document.nodes[node.parentId] : null;
  if (!parent) {
    return { sizeLabel, spacingLabel: null };
  }
  const parentRect = nodeRect(parent);
  const left = Math.round(rect.x);
  const top = Math.round(rect.y);
  const right = Math.round(parentRect.width - rect.x - rect.width);
  const bottom = Math.round(parentRect.height - rect.y - rect.height);
  return {
    sizeLabel,
    spacingLabel: `L${left} T${top} R${right} B${bottom}`,
  };
}

export function documentBounds(document: DesignDocumentResult["document"]): NodeDraft | null {
  const roots = document.rootIds
    .map((id) => document.nodes[id])
    .filter((node): node is RoderDesignNode => Boolean(node));
  const candidates = roots.length > 0 ? roots : Object.values(document.nodes).filter((node) => !node.parentId);
  return unionBounds(candidates.map((node) => nodeAbsoluteBounds(document, node)));
}

export function miniMapModel(
  document: DesignDocumentResult["document"],
  bounds: NodeDraft,
  viewport: DesignViewport,
): { bounds: NodeDraft; height: number; scale: number; viewport: NodeDraft; width: number } {
  const width = 176;
  const height = Math.max(96, Math.min(140, Math.round((width * bounds.height) / Math.max(bounds.width, 1))));
  const scale = Math.min(width / Math.max(bounds.width, 1), height / Math.max(bounds.height, 1));
  return {
    bounds,
    height,
    scale,
    viewport: miniMapViewportRect(document, bounds, scale, viewport, width, height),
    width,
  };
}

export function miniMapNodeRect(
  document: DesignDocumentResult["document"],
  node: RoderDesignNode,
  model: { bounds: NodeDraft; scale: number },
): NodeDraft {
  const rect = nodeAbsoluteBounds(document, node);
  return {
    x: Math.round((rect.x - model.bounds.x) * model.scale),
    y: Math.round((rect.y - model.bounds.y) * model.scale),
    width: Math.max(3, Math.round(rect.width * model.scale)),
    height: Math.max(3, Math.round(rect.height * model.scale)),
  };
}

export function miniMapCanvasPoint(
  model: { bounds: NodeDraft; scale: number },
  x: number,
  y: number,
): { x: number; y: number } {
  const scale = Math.max(model.scale, 0.001);
  return {
    x: model.bounds.x + x / scale,
    y: model.bounds.y + y / scale,
  };
}

export function miniMapViewportRect(
  document: DesignDocumentResult["document"],
  bounds: NodeDraft,
  scale: number,
  viewport: DesignViewport,
  width: number,
  height: number,
): NodeDraft {
  const canvasBounds = documentBounds(document) ?? bounds;
  const visible = {
    x: -viewport.x / Math.max(viewport.zoom, 0.01),
    y: -viewport.y / Math.max(viewport.zoom, 0.01),
    width: 720 / Math.max(viewport.zoom, 0.01),
    height: 520 / Math.max(viewport.zoom, 0.01),
  };
  const rect = {
    x: Math.round((visible.x - canvasBounds.x) * scale),
    y: Math.round((visible.y - canvasBounds.y) * scale),
    width: Math.max(8, Math.round(visible.width * scale)),
    height: Math.max(8, Math.round(visible.height * scale)),
  };
  return {
    x: Math.max(0, Math.min(width - 8, rect.x)),
    y: Math.max(0, Math.min(height - 8, rect.y)),
    width: Math.max(8, Math.min(width, rect.width)),
    height: Math.max(8, Math.min(height, rect.height)),
  };
}

export function unionBounds(bounds: NodeDraft[]): NodeDraft | null {
  if (bounds.length === 0) {
    return null;
  }
  const minX = Math.min(...bounds.map((bound) => bound.x));
  const minY = Math.min(...bounds.map((bound) => bound.y));
  const maxX = Math.max(...bounds.map((bound) => bound.x + bound.width));
  const maxY = Math.max(...bounds.map((bound) => bound.y + bound.height));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

export function canArrangeChildren(
  document: DesignDocumentResult["document"],
  container: RoderDesignNode,
  mode: ChildArrangeMode,
): boolean {
  if (!canContainChildren(container)) {
    return false;
  }
  const children = arrangeableChildren(document, container);
  return mode === "space-x" || mode === "space-y" ? children.length >= 3 : children.length >= 2;
}

export function canReorderLayer(document: DesignDocumentResult["document"], node: RoderDesignNode): boolean {
  if (!node.parentId) {
    return false;
  }
  const siblings = siblingLayerIds(document, node);
  return siblings.length > 1 && siblings.includes(node.id);
}

export function siblingLayerIds(document: DesignDocumentResult["document"], node: RoderDesignNode): string[] {
  if (node.parentId) {
    const parent = document.nodes[node.parentId];
    return parent?.childIds?.filter((id) => Boolean(document.nodes[id])) ?? [];
  }
  return document.rootIds.filter((id) => Boolean(document.nodes[id]));
}

export function layerOrderOperation(
  document: DesignDocumentResult["document"],
  node: RoderDesignNode,
  mode: LayerOrderMode,
): DesignPatchOperation | null {
  const siblings = siblingLayerIds(document, node);
  const index = siblings.indexOf(node.id);
  if (index < 0 || siblings.length < 2) {
    return null;
  }
  const nextIndex =
    mode === "front"
      ? siblings.length - 1
      : mode === "back"
        ? 0
        : mode === "forward"
          ? Math.min(siblings.length - 1, index + 1)
          : Math.max(0, index - 1);
  if (nextIndex === index) {
    return null;
  }
  const next = [...siblings];
  const [id] = next.splice(index, 1);
  next.splice(nextIndex, 0, id);
  return { op: "reorder_node", nodeId: node.id, index: nextIndex };
}

export function layerOrderModeLabel(mode: LayerOrderMode): string {
  switch (mode) {
    case "front":
      return "Bring to front";
    case "forward":
      return "Bring forward";
    case "backward":
      return "Send backward";
    case "back":
      return "Send to back";
  }
}

export function arrangeableChildren(
  document: DesignDocumentResult["document"],
  container: RoderDesignNode,
): RoderDesignNode[] {
  return (container.childIds ?? [])
    .map((id) => document.nodes[id])
    .filter((child): child is RoderDesignNode => Boolean(child) && child.visible !== false && child.locked !== true);
}

export function arrangeChildOperations(
  document: DesignDocumentResult["document"],
  container: RoderDesignNode,
  mode: ChildArrangeMode,
): DesignPatchOperation[] {
  const children = arrangeableChildren(document, container);
  if (children.length < 2) {
    return [];
  }
  const containerRect = nodeRect(container);
  const childRects = children.map((child) => ({ child, rect: nodeRect(child) }));
  const bounds = unionBounds(childRects.map(({ rect }) => rect));
  if (!bounds) {
    return [];
  }
  const sortedByX = mode === "space-x" ? [...childRects].sort((a, b) => a.rect.x - b.rect.x) : [];
  const sortedByY = mode === "space-y" ? [...childRects].sort((a, b) => a.rect.y - b.rect.y) : [];
  const operations: DesignPatchOperation[] = [];
  for (const { child, rect } of childRects) {
    const patch: Partial<RoderDesignNode> = {};
    if (mode === "left") {
      patch.x = 0;
    } else if (mode === "center") {
      patch.x = Math.round((containerRect.width - rect.width) / 2);
    } else if (mode === "right") {
      patch.x = Math.round(containerRect.width - rect.width);
    } else if (mode === "top") {
      patch.y = 0;
    } else if (mode === "middle") {
      patch.y = Math.round((containerRect.height - rect.height) / 2);
    } else if (mode === "bottom") {
      patch.y = Math.round(containerRect.height - rect.height);
    } else if (mode === "space-x") {
      const index = sortedByX.findIndex((entry) => entry.child.id === child.id);
      const totalWidth = sortedByX.reduce((sum, entry) => sum + entry.rect.width, 0);
      const gap = (containerRect.width - totalWidth) / Math.max(1, sortedByX.length - 1);
      patch.x = Math.round(sortedByX.slice(0, index).reduce((sum, entry) => sum + entry.rect.width + gap, 0));
    } else if (mode === "space-y") {
      const index = sortedByY.findIndex((entry) => entry.child.id === child.id);
      const totalHeight = sortedByY.reduce((sum, entry) => sum + entry.rect.height, 0);
      const gap = (containerRect.height - totalHeight) / Math.max(1, sortedByY.length - 1);
      patch.y = Math.round(sortedByY.slice(0, index).reduce((sum, entry) => sum + entry.rect.height + gap, 0));
    }
    const nextX = patch.x ?? rect.x;
    const nextY = patch.y ?? rect.y;
    if (nextX !== rect.x || nextY !== rect.y) {
      operations.push({ op: "update_node", nodeId: child.id, patch });
    }
  }
  return operations;
}

export function arrangeModeLabel(mode: ChildArrangeMode): string {
  switch (mode) {
    case "left":
      return "Align left";
    case "center":
      return "Align center";
    case "right":
      return "Align right";
    case "top":
      return "Align top";
    case "middle":
      return "Align middle";
    case "bottom":
      return "Align bottom";
    case "space-x":
      return "Distribute horizontally";
    case "space-y":
      return "Distribute vertically";
  }
}

export function canUpdateChildLayers(
  document: DesignDocumentResult["document"],
  container: RoderDesignNode,
  mode: ChildLayerMode,
): boolean {
  if (!canContainChildren(container)) {
    return false;
  }
  return childLayerOperations(document, container, mode).length > 0;
}

export function childLayerOperations(
  document: DesignDocumentResult["document"],
  container: RoderDesignNode,
  mode: ChildLayerMode,
): DesignPatchOperation[] {
  return (container.childIds ?? [])
    .map((id) => document.nodes[id])
    .filter((child): child is RoderDesignNode => Boolean(child))
    .flatMap((child): DesignPatchOperation[] => {
      if (mode === "show" && child.visible === false) {
        return [{ op: "update_node", nodeId: child.id, patch: { visible: true } }];
      }
      if (mode === "hide" && child.visible !== false) {
        return [{ op: "update_node", nodeId: child.id, patch: { visible: false } }];
      }
      if (mode === "lock" && child.locked !== true) {
        return [{ op: "update_node", nodeId: child.id, patch: { locked: true } }];
      }
      if (mode === "unlock" && child.locked === true) {
        return [{ op: "update_node", nodeId: child.id, patch: { locked: false } }];
      }
      return [];
    });
}

export function childLayerModeLabel(mode: ChildLayerMode): string {
  switch (mode) {
    case "show":
      return "Show child layers in";
    case "hide":
      return "Hide child layers in";
    case "lock":
      return "Lock child layers in";
    case "unlock":
      return "Unlock child layers in";
  }
}

export function nodeOpacity(node: RoderDesignNode): number {
  return clampOpacity(typeof node.opacity === "number" ? node.opacity : 1);
}

export function clampOpacity(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1));
}

export function nodeRotation(node: RoderDesignNode): number {
  return normalizeRotation(typeof node.rotation === "number" ? node.rotation : 0);
}

export function normalizeRotation(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const normalized = value % 360;
  return Math.round(normalized < 0 ? normalized + 360 : normalized);
}

export function canEditCornerRadius(node: RoderDesignNode): boolean {
  return node.type !== "ellipse" && node.type !== "line" && node.type !== "text";
}

export function nodeCornerRadius(node: RoderDesignNode): number {
  if (!canEditCornerRadius(node)) {
    return 0;
  }
  return clampCornerRadius(typeof node.cornerRadius === "number" ? node.cornerRadius : 8);
}

export function clampCornerRadius(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value));
}

export function promptText(node: RoderDesignNode): string {
  return String(node.prompt ?? node.content ?? "").trim();
}

export function formatPromptNodeRequest(
  document: DesignDocumentResult["document"],
  node: RoderDesignNode,
  prompt: string,
  selectedId: string | null,
  permissions: DesignAgentPermissions,
): string {
  const rect = nodeRect(node);
  const parent = node.parentId ? document.nodes[node.parentId] : null;
  const selected = selectedId ? document.nodes[selectedId] : null;
  const contextLines = [
    parent ? `Container: ${parent.name || parent.id} (${parent.type}, ${parent.id})` : "Container: root canvas",
    selected && selected.id !== node.id
      ? `Current selection: ${selected.name || selected.id} (${selected.type}, ${selected.id})`
      : null,
  ].filter((line): line is string => Boolean(line));
  return [
    "Run this Design Canvas prompt node against the active .roderdesign document.",
    "",
    `Node: ${node.name || node.id} (${node.id})`,
    `Bounds: x=${Math.round(rect.x)}, y=${Math.round(rect.y)}, w=${Math.round(rect.width)}, h=${Math.round(rect.height)}`,
    ...contextLines,
    "",
    formatAgentPermissions(permissions),
    "",
    prompt,
  ].join("\n");
}

export function formatDesignReviewRequest(
  document: DesignDocumentResult["document"],
  node: RoderDesignNode,
  exportedPath: string,
  permissions: DesignAgentPermissions,
): string {
  const rect = nodeAbsoluteBounds(document, node);
  const parent = node.parentId ? document.nodes[node.parentId] : null;
  const childNodes = (node.childIds ?? [])
    .map((id) => document.nodes[id])
    .filter((child): child is RoderDesignNode => Boolean(child));
  const childSummary = childNodes.length
    ? childNodes
        .slice(0, 12)
        .map((child) => `- ${child.name || child.id}: ${child.type} (${child.id})`)
        .join("\n")
    : "- No child nodes";
  return [
    "Review this Design Canvas selection using the attached SVG export and the current .roderdesign context.",
    "Suggest concrete improvements, and if changes are appropriate, use design/patch typed operations rather than editing source files directly.",
    "After any structural edits, run design/snapshot_layout and summarize the visual impact.",
    "",
    `Node: ${node.name || node.id} (${node.type}, ${node.id})`,
    `Exported SVG path: ${exportedPath}`,
    `Bounds: x=${Math.round(rect.x)}, y=${Math.round(rect.y)}, w=${Math.round(rect.width)}, h=${Math.round(rect.height)}`,
    parent ? `Container: ${parent.name || parent.id} (${parent.type}, ${parent.id})` : "Container: root canvas",
    "",
    formatAgentPermissions(permissions),
    "",
    "Child summary:",
    childSummary,
  ].join("\n");
}

export function formatScopedAgentRequest(
  document: DesignDocumentResult["document"],
  node: RoderDesignNode,
  permissions: DesignAgentPermissions,
): string {
  const rect = nodeRect(node);
  const childNodes = (node.childIds ?? [])
    .map((id) => document.nodes[id])
    .filter((child): child is RoderDesignNode => Boolean(child));
  const visibleChildren = childNodes.filter((child) => child.visible !== false);
  const childSummary = visibleChildren.length
    ? visibleChildren
        .slice(0, 12)
        .map((child) => `- ${child.name || child.id} (${child.type}, ${child.id})`)
        .join("\n")
    : "- No visible direct children yet";
  const variables = Object.keys(document.variables ?? {}).slice(0, 16);
  return [
    "Act as a scoped Design Canvas agent for this .roderdesign document.",
    "Only propose or apply changes inside the container node below unless explicitly asked otherwise.",
    "Use design/get_editor_state or design/batch_get to inspect before mutating, then use typed design/patch operations.",
    "After structural edits, run design/snapshot_layout and report any layout issues.",
    "",
    `Container: ${node.name || node.id} (${node.type}, ${node.id})`,
    `Bounds: x=${Math.round(rect.x)}, y=${Math.round(rect.y)}, w=${Math.round(rect.width)}, h=${Math.round(rect.height)}`,
    `Direct visible children (${visibleChildren.length}):`,
    childSummary,
    variables.length ? `Design tokens available: ${variables.join(", ")}` : "Design tokens available: none",
    "",
    formatAgentPermissions(permissions),
    "",
    "Start by describing the best scoped improvement you will make, then perform it if enough context is available.",
  ].join("\n");
}

export function formatScopedAgentPlanRequest(
  document: DesignDocumentResult["document"],
  nodes: RoderDesignNode[],
  permissions: DesignAgentPermissions,
  spawnPlan: DesignSpawnAgentsResult | null,
): string {
  const variables = Object.keys(document.variables ?? {}).slice(0, 16);
  const scopes = nodes.map((node, index) => {
    const rect = nodeRect(node);
    const childNodes = (node.childIds ?? [])
      .map((id) => document.nodes[id])
      .filter((child): child is RoderDesignNode => Boolean(child));
    const visibleChildren = childNodes.filter((child) => child.visible !== false);
    return [
      `${index + 1}. ${node.name || node.id} (${node.type}, ${node.id})`,
      `   Bounds: x=${Math.round(rect.x)}, y=${Math.round(rect.y)}, w=${Math.round(rect.width)}, h=${Math.round(rect.height)}`,
      `   Direct visible children: ${visibleChildren.length}`,
      ...visibleChildren.slice(0, 6).map((child) => `   - ${child.name || child.id} (${child.type}, ${child.id})`),
      visibleChildren.length > 6 ? `   - +${visibleChildren.length - 6} more child node(s)` : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  });
  return [
    "Create a scoped Design Canvas multi-agent plan for the active .roderdesign document.",
    spawnPlan
      ? "Backend design/spawn_agents returned a validated scoped-agent launch plan below. Treat it as the source of truth for scope ids and permissions."
      : "Backend design/spawn_agents is unavailable in this bundled app-server, so this is a desktop-generated scoped-agent plan.",
    "Treat each listed container as an independent lane. Work should stay inside each lane unless explicitly requested otherwise.",
    "Use design/get_editor_state or design/batch_get before mutating, then use typed design/patch operations only.",
    "After structural edits, run design/snapshot_layout and report per-lane issues.",
    "If true parallel subagents are unavailable, execute the lanes sequentially and summarize lane-by-lane progress.",
    "",
    formatAgentPermissions(permissions),
    "",
    `Queued scoped lanes (${nodes.length}):`,
    ...scopes,
    ...(spawnPlan
      ? [
          "",
          `Validated backend launch scopes (${spawnPlan.planned.length}):`,
          ...spawnPlan.planned.map(
            (scope, index) =>
              `${index + 1}. ${scope.scopeName} (${scope.type}, ${scope.scopeNodeId}) · ${scope.childCount} child node(s)`,
          ),
          `Backend permissions: allowPatch=${spawnPlan.allowPatch}, allowExport=${spawnPlan.allowExport}, requireReview=${spawnPlan.requireReview}`,
          `Backend instructions: ${spawnPlan.instructions}`,
        ]
      : []),
    "",
    variables.length ? `Design tokens available: ${variables.join(", ")}` : "Design tokens available: none",
    "",
    "Start by assigning one concrete improvement/check to each lane, then proceed according to the permission mode.",
  ].join("\n");
}

export function formatExternalAgentManifest(
  result: DesignDocumentResult,
  selected: RoderDesignNode | null,
  scope: RoderDesignNode | null,
  launchPlan: DesignAgentLaunchPlanItem[],
  permissions: DesignAgentPermissions,
): string {
  const document = result.document;
  const rootNodes = document.rootIds
    .map((id) => document.nodes[id])
    .filter((node): node is RoderDesignNode => Boolean(node));
  const components = Object.values(document.nodes).filter(
    (node) => node.type === "component" || node.reusable === true,
  );
  const variables = Object.keys(document.variables ?? {}).slice(0, 20);
  const scopeNode = scope ?? selected;
  const scopeChildren = scopeNode
    ? (scopeNode.childIds ?? [])
        .map((id) => document.nodes[id])
        .filter((node): node is RoderDesignNode => Boolean(node))
    : rootNodes;
  const scopeSummary = scopeNode
    ? `${scopeNode.name || scopeNode.id} (${scopeNode.type}, ${scopeNode.id})`
    : "Canvas root";
  const queuedLanes = launchPlan
    .map((item) => document.nodes[item.nodeId])
    .filter((node): node is RoderDesignNode => Boolean(node) && canContainChildren(node));
  const queuedLaneSummary = queuedLanes.length
    ? queuedLanes.flatMap((node, index) => {
        const childCount = (node.childIds ?? []).filter((id) => Boolean(document.nodes[id])).length;
        return [
          `${index + 1}. ${node.name || node.id}: ${node.type} (${node.id}) · ${childCount} direct child node(s)`,
        ];
      })
    : ["No queued scoped lanes. Use the Scoped agent plan panel to queue containers before handoff."];
  return [
    "External Design Canvas agent manifest for Roder Desktop.",
    "Use this as a safe handoff for MCP-style or external-agent work against the current .roderdesign document.",
    "Do not assume direct filesystem edit access to the design document; inspect with design tools and mutate only with typed design/patch operations.",
    "If external MCP wiring is unavailable, continue in the active Roder thread using the same tool sequence.",
    "",
    `Workspace id: ${document.metadata?.workspaceId ?? "unknown"}`,
    `Design path: ${result.path}`,
    `Document: ${document.title || document.documentId} (${document.documentId})`,
    `Scope: ${scopeSummary}`,
    selected
      ? `Current selection: ${selected.name || selected.id} (${selected.type}, ${selected.id})`
      : "Current selection: none",
    "",
    formatAgentPermissions(permissions),
    "",
    "Required tool workflow:",
    "1. Start with design/get_editor_state or design/batch_get for the target scope.",
    "2. Read only the nodes needed for the change; prefer read_depth/search_depth bounds.",
    "3. Mutate only through design/patch typed operations.",
    "4. Run design/snapshot_layout after structural edits.",
    "5. Export with design/export_nodes only when permissions allow or the user explicitly asks.",
    "",
    "Useful methods expected from the app-server/tool surface:",
    "- design/read",
    "- design/batch_get",
    "- design/patch",
    "- design/snapshot_layout",
    "- design/export_nodes",
    "- design/get_variables",
    "",
    `Root nodes (${rootNodes.length}):`,
    ...rootNodes.slice(0, 10).map((node) => `- ${node.name || node.id}: ${node.type} (${node.id})`),
    rootNodes.length > 10 ? `- +${rootNodes.length - 10} more root node(s)` : null,
    "",
    `Scope children (${scopeChildren.length}):`,
    ...scopeChildren.slice(0, 12).map((node) => `- ${node.name || node.id}: ${node.type} (${node.id})`),
    scopeChildren.length > 12 ? `- +${scopeChildren.length - 12} more child node(s)` : null,
    "",
    `Queued scoped lanes (${queuedLanes.length}):`,
    ...queuedLaneSummary,
    queuedLanes.length
      ? "External agents should treat queued lanes as independent scoped workstreams and avoid cross-lane edits unless explicitly requested."
      : null,
    "",
    components.length
      ? `Reusable components: ${components
          .slice(0, 12)
          .map((node) => node.name || node.id)
          .join(", ")}`
      : "Reusable components: none",
    variables.length ? `Design tokens: ${variables.join(", ")}` : "Design tokens: none",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function formatAgentPermissions(permissions: DesignAgentPermissions): string {
  return [
    "Design-agent permissions:",
    `- Mode: ${agentPermissionPresetLabel(permissions.preset)}`,
    `- Typed design/patch mutations: ${permissions.allowPatch ? "allowed" : "not allowed; propose changes only"}`,
    `- SVG export/attachments: ${permissions.allowExport ? "allowed" : "not allowed unless user explicitly asks"}`,
    `- Review gate: ${permissions.requireReview ? "summarize intended changes before mutating" : "direct edits allowed within scope"}`,
  ].join("\n");
}

export function agentPermissionSummary(permissions: DesignAgentPermissions): string {
  const preset = agentPermissionPresetLabel(permissions.preset);
  const patch = permissions.allowPatch ? "patches allowed" : "proposal-only";
  const exportMode = permissions.allowExport ? "exports allowed" : "exports restricted";
  const review = permissions.requireReview ? "review first" : "direct edit";
  return `${preset} · ${patch} · ${exportMode} · ${review}`;
}

export function agentPermissionPresetLabel(preset: DesignAgentPermissions["preset"]): string {
  if (preset === "observe") {
    return "Observe only";
  }
  if (preset === "autonomous") {
    return "Autonomous";
  }
  if (preset === "review") {
    return "Review gated";
  }
  return "Custom";
}

export function stagePoint(
  event: React.PointerEvent<HTMLDivElement>,
  zoom: number,
  snapToGrid: boolean,
): { x: number; y: number } {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: snapValue((event.clientX - bounds.left) / zoom, snapToGrid),
    y: snapValue((event.clientY - bounds.top) / zoom, snapToGrid),
  };
}

export function viewportPoint(event: React.PointerEvent<HTMLDivElement>, viewport: DesignViewport): { x: number; y: number } {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.round((event.clientX - bounds.left - viewport.x) / viewport.zoom),
    y: Math.round((event.clientY - bounds.top - viewport.y) / viewport.zoom),
  };
}

export function rulerTicks(
  offset: number,
  zoom: number,
  minPosition: number,
  maxPosition: number,
  step: number,
): Array<{ position: number; value: number }> {
  const visibleStart = Math.floor((minPosition - offset) / zoom / step) * step;
  const visibleEnd = Math.ceil((maxPosition - offset) / zoom / step) * step;
  const ticks: Array<{ position: number; value: number }> = [];
  for (let value = visibleStart; value <= visibleEnd; value += step) {
    const position = Math.round(offset + value * zoom);
    if (position >= minPosition - 40 && position <= maxPosition + 40) {
      ticks.push({ position, value });
    }
  }
  return ticks;
}

export function snapRect(rect: NodeDraft, snapToGrid: boolean): NodeDraft {
  if (!snapToGrid) {
    return rect;
  }
  return {
    x: snapValue(rect.x, true),
    y: snapValue(rect.y, true),
    width: snapValue(rect.width, true),
    height: snapValue(rect.height, true),
  };
}

export function snapValue(value: number, snapToGrid: boolean): number {
  return snapToGrid ? Math.round(value / GRID_SIZE) * GRID_SIZE : Math.round(value);
}

export function normalizedRect(startX: number, startY: number, currentX: number, currentY: number): NodeDraft {
  return {
    x: Math.min(startX, currentX),
    y: Math.min(startY, currentY),
    width: Math.max(1, Math.abs(currentX - startX)),
    height: Math.max(1, Math.abs(currentY - startY)),
  };
}

export function arrowKeyNudge(key: string, delta: number): { x: number; y: number } | null {
  switch (key) {
    case "ArrowLeft":
      return { x: -delta, y: 0 };
    case "ArrowRight":
      return { x: delta, y: 0 };
    case "ArrowUp":
      return { x: 0, y: -delta };
    case "ArrowDown":
      return { x: 0, y: delta };
    default:
      return null;
  }
}

export function insertKindForShortcut(key: string): InsertKind | null | undefined {
  switch (key) {
    case "r":
      return "rectangle";
    case "o":
      return "ellipse";
    case "l":
      return "line";
    case "t":
      return "text";
    case "f":
      return "frame";
    case "i":
      return "image";
    case "p":
      return "prompt";
    default:
      return undefined;
  }
}

export function isTextEditingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLInputElement);
}

export function canContainChildren(node: RoderDesignNode): boolean {
  return node.type === "frame" || node.type === "group" || node.type === "component" || node.type === "instance";
}

export function nodeAncestry(nodes: Record<string, RoderDesignNode>, node: RoderDesignNode): RoderDesignNode[] {
  const ancestry: RoderDesignNode[] = [node];
  const seen = new Set<string>([node.id]);
  let parentId = node.parentId;
  while (parentId) {
    if (seen.has(parentId)) {
      break;
    }
    const parent = nodes[parentId];
    if (!parent) {
      break;
    }
    ancestry.unshift(parent);
    seen.add(parent.id);
    parentId = parent.parentId;
  }
  return ancestry;
}

export function breadcrumbNodeLabel(node: RoderDesignNode, selected: boolean): string {
  const name = node.name?.trim() || node.type || node.id;
  return selected ? `${name} · ${node.type}` : name;
}

export function agentActivityScope(
  document: DesignDocumentResult["document"],
  node: RoderDesignNode,
): { id: string; name: string } {
  const ancestry = nodeAncestry(document.nodes, node);
  const container = ancestry.findLast((candidate) => canContainChildren(candidate)) ?? node;
  return { id: container.id, name: container.name?.trim() || `${container.type} ${container.id.slice(0, 6)}` };
}

export function agentActivityLanes(activities: DesignAgentActivity[]): Array<{
  scopeId: string;
  scopeName: string;
  running: number;
  activities: DesignAgentActivity[];
}> {
  const lanes = new Map<
    string,
    { scopeId: string; scopeName: string; running: number; activities: DesignAgentActivity[] }
  >();
  for (const activity of activities.slice().reverse()) {
    const lane = lanes.get(activity.scopeId) ?? {
      scopeId: activity.scopeId,
      scopeName: activity.scopeName,
      running: 0,
      activities: [],
    };
    if (activity.status === "running") {
      lane.running += 1;
    }
    lane.activities.push(activity);
    lanes.set(activity.scopeId, lane);
  }
  return Array.from(lanes.values()).slice(0, 4);
}

export function agentActivityKindLabel(kind: DesignAgentActivity["kind"]): string {
  switch (kind) {
    case "review":
      return "Review";
    case "scoped":
      return "Scoped agent";
    case "prompt":
      return "Prompt";
  }
}

export function agentActivityStatusClass(status: DesignAgentActivity["status"]): string {
  return cn(
    "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
    status === "running" && "bg-violet-500/10 text-violet-700",
    status === "sent" && "bg-emerald-500/10 text-emerald-700",
    status === "error" && "bg-destructive/10 text-destructive",
  );
}

export function exportableRootFrames(document: DesignDocumentResult["document"]): RoderDesignNode[] {
  return document.rootIds
    .map((id) => document.nodes[id])
    .filter(
      (node): node is RoderDesignNode =>
        Boolean(node) &&
        node.visible !== false &&
        (node.type === "frame" || node.type === "component" || node.type === "instance"),
    );
}

export function safeAttachmentName(name: string): string {
  const normalized = name
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "design-node";
}

export async function scanDesignTokensFromWorkspace(workspaceRootPath: string): Promise<ThemeScanResult> {
  const variables: Record<string, unknown> = {};
  const sources: string[] = [];

  await Promise.all(
    THEME_SCAN_FILES.map(async (relativePath) => {
      const path = joinWorkspacePath(workspaceRootPath, relativePath);
      try {
        const file = await roderIpc.readFile(path);
        const text = decodeBase64Text(file.dataBase64);
        const nextVariables = extractThemeVariables(text);
        if (Object.keys(nextVariables).length === 0) {
          return;
        }
        Object.assign(variables, nextVariables);
        sources.push(relativePath);
      } catch {
        // Missing theme files are expected; scan only common locations.
      }
    }),
  );

  return { sources, variables };
}

export function joinWorkspacePath(root: string, relativePath: string): string {
  return `${root.replace(/\/+$/u, "")}/${relativePath.replace(/^\/+/, "")}`;
}

export function extractThemeVariables(source: string): Record<string, unknown> {
  const variables: Record<string, unknown> = {};
  extractCssCustomProperties(source, variables);
  extractTailwindObjectSection(source, "colors", (name, value) => {
    if (isColorTokenValue(value)) {
      variables[`theme.color.${name}`] = { kind: "color", value };
    }
  });
  extractTailwindObjectSection(source, "spacing", (name, value) => {
    const spacing = cssLengthToPx(value);
    if (spacing !== null) {
      variables[`theme.spacing.${name}`] = { kind: "spacing", value: spacing };
    }
  });
  extractTailwindObjectSection(source, "fontSize", (name, value) => {
    const fontSize = cssLengthToPx(value);
    if (fontSize !== null) {
      variables[`theme.type.${name}`] = { kind: "typography", fontSize, fontWeight: 500, textAlign: "left" };
    }
  });
  return variables;
}

export function extractCssCustomProperties(source: string, variables: Record<string, unknown>): void {
  const propertyRegex = /--([a-zA-Z0-9-_]+)\s*:\s*([^;}{]+);/gu;
  for (const match of source.matchAll(propertyRegex)) {
    const name = safeVariableName(`theme.${match[1]}`);
    const value = match[2]?.trim() ?? "";
    if (!name || value.includes("var(")) {
      continue;
    }
    if (isColorTokenValue(value)) {
      variables[name] = { kind: "color", value };
      continue;
    }
    const spacing = cssLengthToPx(value);
    if (spacing !== null) {
      variables[name] = { kind: "spacing", value: spacing };
    }
  }
}

export function extractTailwindObjectSection(
  source: string,
  section: string,
  onEntry: (name: string, value: string) => void,
): void {
  const sectionMatch = new RegExp(`${section}\\s*:\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, "u").exec(source);
  if (!sectionMatch) {
    return;
  }
  const entryRegex = /["']?([a-zA-Z0-9-_./]+)["']?\s*:\s*["']([^"']+)["']/gu;
  for (const match of sectionMatch[1].matchAll(entryRegex)) {
    const name = safeVariableName(match[1] ?? "");
    const value = match[2]?.trim() ?? "";
    if (name && value) {
      onEntry(name, value);
    }
  }
}

export function isColorTokenValue(value: string): boolean {
  return (
    /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.test(value) ||
    /^rgba?\(/iu.test(value) ||
    /^hsla?\(/iu.test(value) ||
    /^oklch\(/iu.test(value)
  );
}

export function cssLengthToPx(value: string): number | null {
  const trimmed = value.trim();
  const match = /^(-?\d+(?:\.\d+)?)(px|rem|em)?$/u.exec(trimmed);
  if (!match) {
    return null;
  }
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  const unit = match[2] ?? "px";
  return Math.round((unit === "rem" || unit === "em" ? numeric * 16 : numeric) * 100) / 100;
}

export function clampZoom(value: number): number {
  return Math.min(2.5, Math.max(0.25, value));
}

export async function readLayoutDiagnostics(
  canInspectLayout: boolean,
  workspaceId: string,
  rootId: string,
): Promise<DesignLayoutDiagnostics> {
  if (!canInspectLayout) {
    return { available: false, nodes: [], problemCount: 0 };
  }
  try {
    const layout = await roderIpc.designSnapshotLayout(workspaceId, rootId);
    const nodes = layout.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      problems: node.problems,
    }));
    return {
      available: true,
      nodes,
      problemCount: nodes.reduce((count, node) => count + node.problems.length, 0),
    };
  } catch {
    return { available: false, nodes: [], problemCount: 0 };
  }
}

export function colorValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "value" in value && typeof value.value === "string") {
    return value.value;
  }
  return null;
}

export function variableColor(value: unknown): string | null {
  const color = colorValue(value);
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : null;
}

export function variableSpacing(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampSpacing(value);
  }
  if (value && typeof value === "object" && "value" in value && typeof value.value === "number") {
    return clampSpacing(value.value);
  }
  return null;
}

export function clampSpacing(value: number): number {
  return Math.min(4096, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)));
}

export function safeVariableName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._-]/gi, "")
    .replace(/^\.+|\.+$/g, "");
}

export function strokeWidth(value: unknown): number {
  if (value && typeof value === "object" && "width" in value && typeof value.width === "number") {
    return value.width;
  }
  return 2;
}

export function pathData(node: RoderDesignNode, rect: NodeDraft): string {
  const data = typeof node.pathData === "string" ? node.pathData : typeof node.d === "string" ? node.d : "";
  return (
    data.trim() ||
    `M 0 ${Math.max(1, rect.height)} C ${rect.width / 3} 0, ${(rect.width * 2) / 3} 0, ${rect.width} ${Math.max(1, rect.height)}`
  );
}

export function pathViewBox(node: RoderDesignNode, rect: NodeDraft): string {
  return typeof node.viewBox === "string" && node.viewBox.trim()
    ? node.viewBox
    : `0 0 ${Math.max(1, rect.width)} ${Math.max(1, rect.height)}`;
}

export function iconViewBox(node: RoderDesignNode): string {
  return typeof node.viewBox === "string" && node.viewBox.trim() ? node.viewBox : "0 0 24 24";
}

export type TextAlign = "left" | "center" | "right";

export type TypographyToken = {
  fontSize: number;
  fontWeight: number;
  textAlign: TextAlign;
};

export function textFontSize(node: RoderDesignNode): number {
  return clampFontSize(typeof node.fontSize === "number" ? node.fontSize : 16);
}

export function clampFontSize(value: number): number {
  return Math.min(144, Math.max(8, Math.round(Number.isFinite(value) ? value : 16)));
}

export function textFontWeight(node: RoderDesignNode): number {
  return clampFontWeight(typeof node.fontWeight === "number" ? node.fontWeight : 500);
}

export function clampFontWeight(value: number): number {
  const normalized = Math.round((Number.isFinite(value) ? value : 500) / 100) * 100;
  return Math.min(900, Math.max(100, normalized));
}

export function textAlign(node: RoderDesignNode): TextAlign {
  return textAlignValue(node.textAlign);
}

export function textAlignValue(value: unknown): TextAlign {
  return value === "center" || value === "right" ? value : "left";
}

export function variableTypography(value: unknown): TypographyToken | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const fontSize = "fontSize" in value && typeof value.fontSize === "number" ? value.fontSize : null;
  const fontWeight = "fontWeight" in value && typeof value.fontWeight === "number" ? value.fontWeight : null;
  if (fontSize === null && fontWeight === null && !("textAlign" in value)) {
    return null;
  }
  return {
    fontSize: clampFontSize(fontSize ?? 16),
    fontWeight: clampFontWeight(fontWeight ?? 500),
    textAlign: "textAlign" in value ? textAlignValue(value.textAlign) : "left",
  };
}

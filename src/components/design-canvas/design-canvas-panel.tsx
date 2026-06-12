import { RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { useStableHandlers } from "@/hooks/use-stable-handlers";
import { roderIpc } from "@/lib/roder-ipc";
import { cn } from "@/lib/utils";
import type { DesktopAttachment, DesignPatchOperation, RoderDesignNode, RoderNotification } from "@/types/roder";
import type {
  ChildArrangeMode,
  ChildLayerMode,
  DesignAgentActivity,
  DesignAgentLaunchPlanItem,
  DesignAgentPermissions,
  DesignCanvasState,
  DesignLibraryEntry,
  DesignTemplateId,
  DesignUndoSnapshot,
  DesignViewport,
  InsertKind,
  LayerOrderMode,
  NodeDraft,
} from "./design-canvas-types";
import {
  agentActivityScope,
  arrangeChildOperations,
  arrangeModeLabel,
  canArrangeChildren,
  canContainChildren,
  canMakeComponent,
  canUpdateChildLayers,
  childLayerModeLabel,
  childLayerOperations,
  clampZoom,
  cloneDesignSubtree,
  componentIdForNode,
  describePatchOperations,
  designClipboardPayload,
  designGroupForNode,
  designRestoreOperations,
  documentBounds,
  exportableRootFrames,
  formatDesignReviewRequest,
  formatExternalAgentManifest,
  formatPromptNodeRequest,
  formatScopedAgentPlanRequest,
  formatScopedAgentRequest,
  layerOrderModeLabel,
  layerOrderOperation,
  nodeAbsoluteBounds,
  parseDesignClipboardPayload,
  patchWithInstanceOverrides,
  promptText,
  readLayoutDiagnostics,
  replaceChildId,
  safeAttachmentName,
  scanDesignTokensFromWorkspace,
  summarizePatchOperations,
} from "./design-canvas-helpers";
import { buildDesignTemplate, designNodeForInsert, designTemplateById } from "./design-templates";
import { cloneLibraryNode, importPencilLikeDesign, scanDesignLibrariesFromWorkspace } from "./design-import";
import { DesignCanvasBody } from "./design-canvas-body";
import { DesignInspector } from "./design-inspector";

type DesignCanvasPanelProps = {
  appServerMethods: string[];
  onAttach: (attachment: DesktopAttachment) => void;
  onSendPrompt: (prompt: string, attachments: DesktopAttachment[]) => Promise<void>;
  workspaceId: string;
  rootId: string;
  workspaceRootPath: string;
};

export function DesignCanvasPanel({
  appServerMethods,
  onAttach,
  onSendPrompt,
  workspaceId,
  rootId,
  workspaceRootPath,
}: DesignCanvasPanelProps): React.JSX.Element {
  const available = appServerMethods.includes("design/read") && appServerMethods.includes("design/patch");
  const canInspectLayout = appServerMethods.includes("design/snapshot_layout");
  const canExport = appServerMethods.includes("design/export_nodes");
  const canSpawnDesignAgents = appServerMethods.includes("design/spawn_agents");
  const [state, setState] = useState<DesignCanvasState>(available ? { status: "loading" } : { status: "unavailable" });
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [viewport, setViewport] = useState<DesignViewport>({ x: 80, y: 80, zoom: 1 });
  const [drawKind, setDrawKind] = useState<InsertKind | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [showRulers, setShowRulers] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [undoStack, setUndoStack] = useState<DesignUndoSnapshot[]>([]);
  const [designLibraries, setDesignLibraries] = useState<DesignLibraryEntry[]>([]);
  const [libraryScanStatus, setLibraryScanStatus] = useState<string | null>(null);
  const [agentActivities, setAgentActivities] = useState<DesignAgentActivity[]>([]);
  const [agentLaunchPlan, setAgentLaunchPlan] = useState<DesignAgentLaunchPlanItem[]>([]);
  const [agentPermissions, setAgentPermissions] = useState<DesignAgentPermissions>({
    preset: "review",
    allowPatch: true,
    allowExport: true,
    requireReview: true,
  });
  const importInputRef = useRef<HTMLInputElement | null>(null);

  function zoomBy(delta: number): void {
    setViewport((current) => ({ ...current, zoom: clampZoom(current.zoom + delta) }));
  }

  async function runPromptNode(node: RoderDesignNode): Promise<void> {
    if (state.status !== "ready") {
      return;
    }
    const prompt = promptText(node);
    if (!prompt) {
      setStatusMessage("Prompt node is empty");
      return;
    }
    const activityId = crypto.randomUUID();
    const nodeName = node.name || "Prompt node";
    const scope = agentActivityScope(state.result.document, node);
    const activity: DesignAgentActivity = {
      id: activityId,
      nodeId: node.id,
      nodeName,
      scopeId: scope.id,
      scopeName: scope.name,
      kind: "prompt",
      status: "running",
      message: "Sending prompt to active Roder thread...",
    };
    setAgentActivities((current) => [...current, activity].slice(-6));
    try {
      await onSendPrompt(
        formatPromptNodeRequest(state.result.document, node, prompt, state.selectedId, agentPermissions),
        [],
      );
      setAgentActivities((current) =>
        current.map((activity) =>
          activity.id === activityId
            ? { ...activity, status: "sent", message: "Prompt sent to active Roder thread" }
            : activity,
        ),
      );
      setStatusMessage(`Sent ${nodeName} to active thread`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAgentActivities((current) =>
        current.map((activity) => (activity.id === activityId ? { ...activity, status: "error", message } : activity)),
      );
      setStatusMessage(message);
    }
  }

  function queueScopedAgentForSelected(): void {
    if (state.status !== "ready" || !state.selectedId) {
      return;
    }
    const node = state.result.document.nodes[state.selectedId];
    if (!node || !canContainChildren(node)) {
      setStatusMessage("Select a frame, group, component, or instance to add to the scoped-agent plan");
      return;
    }
    const nodeName = node.name || "Design container";
    setAgentLaunchPlan((current) => {
      if (current.some((item) => item.nodeId === node.id)) {
        return current;
      }
      return [
        ...current,
        {
          id: crypto.randomUUID(),
          nodeId: node.id,
          nodeName,
          scopeId: node.id,
          scopeName: nodeName,
        },
      ].slice(-8);
    });
    setStatusMessage(`Added ${nodeName} to scoped-agent plan`);
  }

  async function sendScopedAgentPlan(): Promise<void> {
    if (state.status !== "ready" || agentLaunchPlan.length === 0) {
      return;
    }
    const launchable = agentLaunchPlan
      .map((item) => state.result.document.nodes[item.nodeId])
      .filter((node): node is RoderDesignNode => Boolean(node) && canContainChildren(node));
    if (launchable.length === 0) {
      setAgentLaunchPlan([]);
      setStatusMessage("Scoped-agent plan no longer has valid containers");
      return;
    }
    const activities: DesignAgentActivity[] = launchable.map((node) => ({
      id: crypto.randomUUID(),
      nodeId: node.id,
      nodeName: node.name || "Design container",
      scopeId: node.id,
      scopeName: node.name || "Design container",
      kind: "scoped",
      status: "running" as const,
      message: "Sending planned scoped design-agent task...",
    }));
    setAgentActivities((current) => [...current, ...activities].slice(-12));
    try {
      const spawnPlan = canSpawnDesignAgents
        ? await roderIpc.designSpawnAgents(
            workspaceId,
            rootId,
            launchable.map((node) => node.id),
            {
              prompt: "Improve this scoped design container while preserving neighboring frames.",
              allowPatch: agentPermissions.allowPatch,
              allowExport: agentPermissions.allowExport,
              requireReview: agentPermissions.requireReview,
            },
          )
        : null;
      await onSendPrompt(
        formatScopedAgentPlanRequest(state.result.document, launchable, agentPermissions, spawnPlan),
        [],
      );
      const activityIds = new Set(activities.map((activity) => activity.id));
      setAgentActivities((current) =>
        current.map((activity) =>
          activityIds.has(activity.id)
            ? {
                ...activity,
                status: "sent",
                message: spawnPlan
                  ? "Backend scoped-agent launch plan sent to active Roder thread"
                  : "Planned scoped-agent task sent to active Roder thread",
              }
            : activity,
        ),
      );
      setAgentLaunchPlan([]);
      setStatusMessage(`Sent ${launchable.length} scoped-agent task${launchable.length === 1 ? "" : "s"}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const activityIds = new Set(activities.map((activity) => activity.id));
      setAgentActivities((current) =>
        current.map((activity) =>
          activityIds.has(activity.id) ? { ...activity, status: "error", message } : activity,
        ),
      );
      setStatusMessage(message);
    }
  }

  async function spawnScopedAgentForSelected(): Promise<void> {
    if (state.status !== "ready" || !state.selectedId) {
      return;
    }
    const node = state.result.document.nodes[state.selectedId];
    if (!node || !canContainChildren(node)) {
      setStatusMessage("Select a frame, group, component, or instance to scope an agent");
      return;
    }
    const activityId = crypto.randomUUID();
    const nodeName = node.name || "Design container";
    const activity: DesignAgentActivity = {
      id: activityId,
      nodeId: node.id,
      nodeName,
      scopeId: node.id,
      scopeName: nodeName,
      kind: "scoped",
      status: "running",
      message: "Sending scoped design-agent task to active Roder thread...",
    };
    setAgentActivities((current) => [...current, activity].slice(-6));
    try {
      await onSendPrompt(formatScopedAgentRequest(state.result.document, node, agentPermissions), []);
      setAgentActivities((current) =>
        current.map((activity) =>
          activity.id === activityId
            ? { ...activity, status: "sent", message: "Scoped design-agent task sent to active Roder thread" }
            : activity,
        ),
      );
      setStatusMessage(`Sent scoped agent task for ${nodeName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAgentActivities((current) =>
        current.map((activity) => (activity.id === activityId ? { ...activity, status: "error", message } : activity)),
      );
      setStatusMessage(message);
    }
  }

  async function sendExternalAgentManifest(): Promise<void> {
    if (state.status !== "ready") {
      return;
    }
    const selected = state.selectedId ? state.result.document.nodes[state.selectedId] : null;
    const scope =
      selected && canContainChildren(selected)
        ? selected
        : selected?.parentId
          ? state.result.document.nodes[selected.parentId]
          : null;
    const activityId = crypto.randomUUID();
    const scopeName = scope?.name || selected?.name || "Canvas";
    const activity: DesignAgentActivity = {
      id: activityId,
      nodeId: scope?.id ?? selected?.id ?? "canvas",
      nodeName: scopeName,
      scopeId: scope?.id ?? "canvas",
      scopeName,
      kind: "scoped",
      status: "running",
      message: "Sending external-agent design manifest to active Roder thread...",
    };
    setAgentActivities((current) => [...current, activity].slice(-6));
    try {
      await onSendPrompt(
        formatExternalAgentManifest(state.result, selected, scope, agentLaunchPlan, agentPermissions),
        [],
      );
      setAgentActivities((current) =>
        current.map((activity) =>
          activity.id === activityId
            ? { ...activity, status: "sent", message: "External-agent manifest sent to active Roder thread" }
            : activity,
        ),
      );
      setStatusMessage("Sent external-agent design manifest to active thread");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAgentActivities((current) =>
        current.map((activity) => (activity.id === activityId ? { ...activity, status: "error", message } : activity)),
      );
      setStatusMessage(message);
    }
  }

  async function scanWorkspaceDesignLibraries(): Promise<void> {
    if (state.status !== "ready") {
      return;
    }
    setLibraryScanStatus("Scanning workspace libraries...");
    try {
      const libraries = await scanDesignLibrariesFromWorkspace(workspaceRootPath, state.result.path);
      setDesignLibraries(libraries);
      setLibraryScanStatus(
        libraries.length === 0
          ? "No project-specific .roderdesign libraries found in common workspace paths"
          : `Found ${libraries.length} design librar${libraries.length === 1 ? "y" : "ies"}`,
      );
    } catch (error) {
      setLibraryScanStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function insertFromDesignLibrary(libraryId: string, nodeId: string): Promise<void> {
    if (state.status !== "ready") {
      return;
    }
    const library = designLibraries.find((entry) => entry.id === libraryId);
    const source = library?.rootNodes.find((node) => node.id === nodeId);
    if (!library || !source) {
      setStatusMessage("Design library item is no longer available");
      return;
    }
    const imported = cloneLibraryNode(source, library);
    await patchDesign(imported.operations, imported.rootId, { label: `Insert ${source.name} from ${library.name}` });
    if (Object.keys(library.variables).length > 0) {
      await setDesignVariables(library.variables, {
        label: `Merge ${library.name} tokens`,
        selectedId: imported.rootId,
      });
    }
    setStatusMessage(`Inserted ${source.name} from ${library.name}`);
  }

  async function importTokensFromDesignLibrary(libraryId: string): Promise<void> {
    if (state.status !== "ready") {
      return;
    }
    const library = designLibraries.find((entry) => entry.id === libraryId);
    if (!library) {
      setStatusMessage("Design library is no longer available");
      return;
    }
    if (Object.keys(library.variables).length === 0) {
      setStatusMessage(`${library.name} does not define design tokens`);
      return;
    }
    await setDesignVariables(library.variables, { label: `Import ${library.name} tokens` });
    setStatusMessage(`Imported ${Object.keys(library.variables).length} token(s) from ${library.name}`);
  }

  async function undoLastDesignPatch(): Promise<void> {
    if (state.status !== "ready" || undoStack.length === 0) {
      return;
    }
    await restoreUndoSnapshot(undoStack.length - 1);
  }

  async function restoreUndoSnapshot(index: number): Promise<void> {
    if (state.status !== "ready") {
      return;
    }
    const snapshot = undoStack[index];
    if (!snapshot) {
      return;
    }
    const operations = designRestoreOperations(state.result.document, snapshot.document);
    if (operations.length === 0) {
      setUndoStack((current) => current.filter((_, entryIndex) => entryIndex !== index));
      setStatusMessage(`Nothing to undo for ${snapshot.label}`);
      return;
    }
    setUndoStack((current) => current.slice(0, index));
    await patchDesign(operations, snapshot.selectedId, { label: `Undo ${snapshot.label}`, skipUndo: true });
    setStatusMessage(`Undid ${snapshot.label}`);
  }

  async function attachSelectedNode(): Promise<void> {
    if (state.status !== "ready" || !state.selectedId || !canExport) {
      return;
    }
    const selected = state.result.document.nodes[state.selectedId];
    try {
      const result = await roderIpc.designExportNodes(workspaceId, rootId, [state.selectedId]);
      const exported = result.exported[0];
      if (!exported) {
        setStatusMessage("No design export was created");
        return;
      }
      onAttach({
        id: crypto.randomUUID(),
        name: `${safeAttachmentName(selected?.name ?? exported.nodeId)}.svg`,
        path: exported.path,
        type: "image/svg+xml",
        size: 0,
        source: "canvas",
      });
      setStatusMessage(`Attached ${selected?.name ?? "selected design node"} to composer`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function setDesignVariables(
    variables: Record<string, unknown>,
    options: { label?: string; replace?: boolean; selectedId?: string | null } = {},
  ): Promise<void> {
    if (state.status !== "ready") {
      return;
    }
    if (!appServerMethods.includes("design/set_variables")) {
      await patchDesign([{ op: "set_variables", variables, replace: options.replace }], options.selectedId, {
        label: options.label,
      });
      return;
    }
    try {
      const previousSnapshot = {
        document: state.result.document,
        summary: summarizePatchOperations(
          [{ op: "set_variables", variables, replace: options.replace }],
          state.result.document,
        ),
        label: options.label ?? "Update design tokens",
        selectedId: state.selectedId,
      };
      const result = await roderIpc.designSetVariables(workspaceId, rootId, variables, options.replace ?? false);
      const layoutDiagnostics = await readLayoutDiagnostics(canInspectLayout, workspaceId, rootId);
      setUndoStack((current) => [...current.slice(-19), previousSnapshot]);
      setState((current) => ({
        status: "ready",
        result,
        selectedId: options.selectedId ?? (current.status === "ready" ? current.selectedId : null),
        layoutDiagnostics,
      }));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function attachRootFrames(): Promise<void> {
    if (state.status !== "ready" || !canExport) {
      return;
    }
    const rootFrames = exportableRootFrames(state.result.document);
    if (rootFrames.length === 0) {
      setStatusMessage("No top-level frames or components are available to attach");
      return;
    }
    try {
      const result = await roderIpc.designExportNodes(
        workspaceId,
        rootId,
        rootFrames.map((node) => node.id),
      );
      const exportedById = new Map(result.exported.map((exported) => [exported.nodeId, exported.path]));
      let attachedCount = 0;
      for (const node of rootFrames) {
        const path = exportedById.get(node.id);
        if (!path) {
          continue;
        }
        onAttach({
          id: crypto.randomUUID(),
          name: `${safeAttachmentName(node.name || node.id)}.svg`,
          path,
          type: "image/svg+xml",
          size: 0,
          source: "canvas",
        });
        attachedCount += 1;
      }
      setStatusMessage(
        attachedCount === 0
          ? "No design exports were created"
          : `Attached ${attachedCount} top-level frame${attachedCount === 1 ? "" : "s"} to composer`,
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function sendSelectedForReview(): Promise<void> {
    if (state.status !== "ready" || !state.selectedId || !canExport) {
      return;
    }
    const selected = state.result.document.nodes[state.selectedId];
    if (!selected) {
      return;
    }
    const activityId = crypto.randomUUID();
    const nodeName = selected.name || "Selected design node";
    const scope = agentActivityScope(state.result.document, selected);
    setAgentActivities((current) =>
      [
        ...current,
        {
          id: activityId,
          nodeId: selected.id,
          nodeName,
          scopeId: scope.id,
          scopeName: scope.name,
          kind: "review" as const,
          status: "running" as const,
          message: "Exporting SVG and sending design review package...",
        },
      ].slice(-6),
    );
    try {
      const result = await roderIpc.designExportNodes(workspaceId, rootId, [selected.id]);
      const exported = result.exported[0];
      if (!exported) {
        setStatusMessage("No design export was created");
        setAgentActivities((current) =>
          current.map((activity) =>
            activity.id === activityId
              ? { ...activity, status: "error", message: "No design export was created" }
              : activity,
          ),
        );
        return;
      }
      const attachment: DesktopAttachment = {
        id: crypto.randomUUID(),
        name: `${safeAttachmentName(selected.name || exported.nodeId)}.svg`,
        path: exported.path,
        type: "image/svg+xml",
        size: 0,
        source: "canvas",
      };
      onAttach(attachment);
      await onSendPrompt(formatDesignReviewRequest(state.result.document, selected, exported.path, agentPermissions), [
        attachment,
      ]);
      setAgentActivities((current) =>
        current.map((activity) =>
          activity.id === activityId
            ? { ...activity, status: "sent", message: "Design review package sent with SVG attachment" }
            : activity,
        ),
      );
      setStatusMessage(`Sent ${nodeName} to active thread with SVG context`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAgentActivities((current) =>
        current.map((activity) => (activity.id === activityId ? { ...activity, status: "error", message } : activity)),
      );
      setStatusMessage(message);
    }
  }

  function fitViewport(): void {
    if (state.status !== "ready") {
      setViewport({ x: 80, y: 80, zoom: 1 });
      return;
    }
    fitViewportToBounds(documentBounds(state.result.document));
  }

  function fitSelectedNode(): void {
    if (state.status !== "ready" || !state.selectedId) {
      fitViewport();
      return;
    }
    const node = state.result.document.nodes[state.selectedId];
    if (!node) {
      fitViewport();
      return;
    }
    fitViewportToBounds(nodeAbsoluteBounds(state.result.document, node));
  }

  function fitViewportToBounds(bounds: NodeDraft | null): void {
    if (!bounds) {
      setViewport({ x: 80, y: 80, zoom: 1 });
      return;
    }
    const margin = 96;
    const zoom = clampZoom(
      Math.min(1.6, Math.max(0.35, 720 / Math.max(bounds.width, 1), 520 / Math.max(bounds.height, 1))),
    );
    setViewport({
      x: Math.round(margin - bounds.x * zoom),
      y: Math.round(margin - bounds.y * zoom),
      zoom,
    });
  }

  async function loadDesign(options: { preserveSelection?: boolean } = {}): Promise<void> {
    if (!available) {
      setState({ status: "unavailable" });
      return;
    }
    const previousSelectedId = options.preserveSelection && state.status === "ready" ? state.selectedId : null;
    setState((current) => (current.status === "ready" && options.preserveSelection ? current : { status: "loading" }));
    try {
      // Independent IPC reads; fetch them in parallel.
      const [result, layoutDiagnostics] = await Promise.all([
        roderIpc.readDesign(workspaceId, rootId),
        readLayoutDiagnostics(canInspectLayout, workspaceId, rootId),
      ]);
      const metadataSelectedId =
        result.document.metadata.selectedNodeIds?.find((id) => result.document.nodes[id]) ?? null;
      const selectedId =
        previousSelectedId && result.document.nodes[previousSelectedId] ? previousSelectedId : metadataSelectedId;
      setState({ status: "ready", result, selectedId, layoutDiagnostics });
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  function selectNode(nextSelectedId: string | null): void {
    let canSelect = false;
    setState((current) => {
      if (current.status !== "ready") {
        return current;
      }
      canSelect = true;
      return { ...current, selectedId: nextSelectedId };
    });
    if (!canSelect) {
      return;
    }
    if (appServerMethods.includes("design/set_selection")) {
      void roderIpc.designSetSelection(workspaceId, rootId, nextSelectedId ? [nextSelectedId] : []).catch((error) => {
        setStatusMessage(error instanceof Error ? error.message : String(error));
      });
    }
  }

  async function patchDesign(
    operations: Parameters<typeof roderIpc.patchDesign>[2],
    selectedId?: string | null,
    options: { label?: string; skipUndo?: boolean } = {},
  ): Promise<void> {
    try {
      const previousSnapshot =
        !options.skipUndo && state.status === "ready"
          ? {
              // The document is treated immutably everywhere, so the snapshot
              // can share structure instead of deep-cloning via JSON.
              document: state.result.document,
              summary: summarizePatchOperations(operations, state.result.document),
              label: options.label ?? describePatchOperations(operations),
              selectedId: state.selectedId,
            }
          : null;
      const result = await roderIpc.patchDesign(workspaceId, rootId, operations);
      const layoutDiagnostics = await readLayoutDiagnostics(canInspectLayout, workspaceId, rootId);
      if (previousSnapshot) {
        setUndoStack((current) => [...current.slice(-19), previousSnapshot]);
      }
      // Functional update: another patch or a design/documentChanged refresh may
      // have landed while we awaited, so don't trust the closure snapshot.
      setState((current) => ({
        status: "ready",
        result,
        selectedId: selectedId === undefined ? (current.status === "ready" ? current.selectedId : null) : selectedId,
        layoutDiagnostics,
      }));
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function insertNode(kind: InsertKind): Promise<void> {
    if (state.status !== "ready") {
      return;
    }
    const siblings = Object.values(state.result.document.nodes).filter((node) => node.type === kind);
    const parentId = selectedNode && canContainChildren(selectedNode) && kind !== "frame" ? selectedNode.id : null;
    const offset = Object.keys(state.result.document.nodes).length * 18;
    const node = designNodeForInsert(kind, siblings.length + 1, offset, parentId);
    await patchDesign([{ op: "insert_node", parentId, node }], node.id, { label: `Insert ${node.name}` });
  }

  async function insertNodeAt(kind: InsertKind, rect: NodeDraft): Promise<void> {
    if (state.status !== "ready") {
      return;
    }
    const siblings = Object.values(state.result.document.nodes).filter((node) => node.type === kind);
    const node = designNodeForInsert(kind, siblings.length + 1, 0, null, rect);
    await patchDesign([{ op: "insert_node", parentId: null, node }], node.id, { label: `Draw ${node.name}` });
  }

  async function importDesignFile(file: File): Promise<void> {
    if (state.status !== "ready") {
      return;
    }
    try {
      const text = await file.text();
      const imported = importPencilLikeDesign(text, state.result.document.nodes, file.name);
      if (imported.operations.length === 0) {
        setStatusMessage(`No importable nodes found in ${file.name}`);
        return;
      }
      await patchDesign(imported.operations, imported.selectedId, { label: `Import ${file.name}` });
      setStatusMessage(
        `Imported ${imported.operations.length} node${imported.operations.length === 1 ? "" : "s"} from ${file.name}`,
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function updateSelectedNode(patch: Partial<RoderDesignNode>): Promise<void> {
    if (state.status !== "ready" || !state.selectedId) {
      return;
    }
    await updateNode(state.selectedId, patch);
  }

  async function updateNode(nodeId: string, patch: Partial<RoderDesignNode>): Promise<void> {
    if (state.status !== "ready") {
      return;
    }
    const node = state.result.document.nodes[nodeId];
    if (!node) {
      return;
    }
    await patchDesign([{ op: "update_node", nodeId, patch: patchWithInstanceOverrides(node, patch) }], undefined, {
      label: `Edit ${node.name}`,
    });
  }

  async function deleteSelectedNode(): Promise<void> {
    if (state.status !== "ready" || !state.selectedId) {
      return;
    }
    await patchDesign([{ op: "delete_node", nodeId: state.selectedId, recursive: true }], null, {
      label: `Delete ${state.result.document.nodes[state.selectedId]?.name ?? "node"}`,
    });
  }

  async function duplicateSelectedNode(): Promise<void> {
    if (state.status !== "ready" || !state.selectedId) {
      return;
    }
    const source = state.result.document.nodes[state.selectedId];
    if (!source) {
      return;
    }
    const clone = cloneDesignSubtree(state.result.document.nodes, source, source.parentId ?? null);
    await patchDesign(clone.operations, clone.rootId, { label: `Duplicate ${source.name}` });
  }

  async function copySelectedNode(): Promise<void> {
    if (state.status !== "ready" || !state.selectedId) {
      return;
    }
    const source = state.result.document.nodes[state.selectedId];
    if (!source) {
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(designClipboardPayload(state.result.document.nodes, source)));
      setStatusMessage(`Copied ${source.name || source.id} to clipboard`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function pasteDesignClipboard(): Promise<void> {
    if (state.status !== "ready") {
      return;
    }
    try {
      const payload = parseDesignClipboardPayload(await navigator.clipboard.readText());
      if (!payload) {
        setStatusMessage("Clipboard does not contain a Roder design node");
        return;
      }
      const source = payload.nodes[payload.rootId];
      if (!source) {
        setStatusMessage("Clipboard design node is missing its root");
        return;
      }
      const parentId = selectedNode && canContainChildren(selectedNode) ? selectedNode.id : null;
      const pasted = cloneDesignSubtree(payload.nodes, source, parentId, {
        rootPatch: { name: `${source.name || source.type || "Node"} Paste` },
      });
      await patchDesign(pasted.operations, pasted.rootId, { label: `Paste ${source.name || source.id}` });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function groupSelectedNode(): Promise<void> {
    if (state.status !== "ready" || !state.selectedId) {
      return;
    }
    const source = state.result.document.nodes[state.selectedId];
    const parent = source?.parentId ? state.result.document.nodes[source.parentId] : null;
    if (!source || !parent || !canContainChildren(parent)) {
      setStatusMessage("Select a child node inside a frame or group to wrap it in a group");
      return;
    }
    const group = designGroupForNode(source, parent.id);
    const parentChildIds = replaceChildId(parent.childIds ?? [], source.id, group.id);
    await patchDesign(
      [
        { op: "insert_node", parentId: parent.id, node: group },
        { op: "update_node", nodeId: parent.id, patch: { childIds: parentChildIds } },
        { op: "update_node", nodeId: group.id, patch: { childIds: [source.id] } },
        { op: "update_node", nodeId: source.id, patch: { parentId: group.id, x: 0, y: 0 } },
      ],
      group.id,
      { label: `Group ${source.name}` },
    );
  }

  async function ungroupSelectedNode(): Promise<void> {
    if (state.status !== "ready" || !state.selectedId) {
      return;
    }
    const group = state.result.document.nodes[state.selectedId];
    const parent = group?.parentId ? state.result.document.nodes[group.parentId] : null;
    if (!group || group.type !== "group" || !parent) {
      setStatusMessage("Select a non-root group to ungroup it");
      return;
    }
    const childIds = (group.childIds ?? []).filter((childId) => Boolean(state.result.document.nodes[childId]));
    if (childIds.length === 0) {
      await patchDesign([{ op: "delete_node", nodeId: group.id, recursive: false }], parent.id, {
        label: `Delete empty ${group.name}`,
      });
      return;
    }
    const operations: DesignPatchOperation[] = childIds.map((childId) => {
      const child = state.result.document.nodes[childId];
      return {
        op: "update_node",
        nodeId: childId,
        patch: {
          parentId: parent.id,
          x: Number(group.x ?? 0) + Number(child?.x ?? 0),
          y: Number(group.y ?? 0) + Number(child?.y ?? 0),
        },
      };
    });
    operations.push(
      {
        op: "update_node",
        nodeId: parent.id,
        patch: { childIds: replaceChildId(parent.childIds ?? [], group.id, childIds) },
      },
      { op: "update_node", nodeId: group.id, patch: { childIds: [] } },
      { op: "delete_node", nodeId: group.id, recursive: false },
    );
    await patchDesign(operations, childIds[0] ?? parent.id, { label: `Ungroup ${group.name}` });
  }

  async function arrangeSelectedChildren(mode: ChildArrangeMode): Promise<void> {
    if (state.status !== "ready" || !state.selectedId) {
      return;
    }
    const container = state.result.document.nodes[state.selectedId];
    if (!container || !canArrangeChildren(state.result.document, container, mode)) {
      setStatusMessage("Select a frame, group, or component with enough children to arrange");
      return;
    }
    const operations = arrangeChildOperations(state.result.document, container, mode);
    if (operations.length === 0) {
      setStatusMessage("No child arrangement changes needed");
      return;
    }
    await patchDesign(operations, container.id, { label: `${arrangeModeLabel(mode)} ${container.name}` });
  }

  async function reorderSelectedLayer(mode: LayerOrderMode): Promise<void> {
    if (state.status !== "ready" || !state.selectedId) {
      return;
    }
    const node = state.result.document.nodes[state.selectedId];
    const operation = node ? layerOrderOperation(state.result.document, node, mode) : null;
    if (!node || !operation) {
      setStatusMessage("Select a child layer with siblings to reorder");
      return;
    }
    await patchDesign([operation], node.id, { label: `${layerOrderModeLabel(mode)} ${node.name}` });
  }

  async function updateSelectedChildLayers(mode: ChildLayerMode): Promise<void> {
    if (state.status !== "ready" || !state.selectedId) {
      return;
    }
    const container = state.result.document.nodes[state.selectedId];
    if (!container || !canUpdateChildLayers(state.result.document, container, mode)) {
      setStatusMessage("Select a container with child layers to update");
      return;
    }
    const operations = childLayerOperations(state.result.document, container, mode);
    if (operations.length === 0) {
      setStatusMessage("No child layer changes needed");
      return;
    }
    await patchDesign(operations, container.id, { label: `${childLayerModeLabel(mode)} ${container.name}` });
  }

  async function makeSelectedComponent(): Promise<void> {
    if (state.status !== "ready" || !state.selectedId) {
      return;
    }
    const source = state.result.document.nodes[state.selectedId];
    if (!source || !canMakeComponent(source)) {
      return;
    }
    await patchDesign(
      [
        {
          op: "update_node",
          nodeId: source.id,
          patch: {
            type: "component",
            componentId: componentIdForNode(source),
            reusable: true,
            name: source.name.startsWith("Component") ? source.name : `Component ${source.name}`,
          },
        },
      ],
      undefined,
      { label: `Make ${source.name} component` },
    );
  }

  async function insertInstanceFromSelected(): Promise<void> {
    if (state.status !== "ready" || !state.selectedId) {
      return;
    }
    await insertInstanceFromComponent(state.selectedId);
  }

  async function insertInstanceFromComponent(componentNodeId: string): Promise<void> {
    if (state.status !== "ready") {
      return;
    }
    const source = state.result.document.nodes[componentNodeId];
    if (!source || source.type !== "component") {
      return;
    }
    const parentId =
      selectedNode && canContainChildren(selectedNode) && selectedNode.id !== source.id ? selectedNode.id : null;
    const instance = cloneDesignSubtree(state.result.document.nodes, source, parentId, {
      rootPatch: {
        type: "instance",
        name: `Instance of ${source.name}`,
        componentId: componentIdForNode(source),
        sourceComponentId: source.id,
        reusable: false,
        overrides: [],
      },
    });
    await patchDesign(instance.operations, instance.rootId, { label: `Insert instance of ${source.name}` });
  }

  async function insertTemplate(templateId: DesignTemplateId): Promise<void> {
    if (state.status !== "ready") {
      return;
    }
    const parentId = selectedNode && canContainChildren(selectedNode) ? selectedNode.id : null;
    const offset = Object.keys(state.result.document.nodes).length * 18;
    const template = designTemplateById(templateId);
    const built = buildDesignTemplate(template, parentId, offset);
    await patchDesign(built.operations, built.rootId, { label: `Insert ${template.name} template` });
  }

  async function detachSelectedInstance(): Promise<void> {
    if (state.status !== "ready" || !state.selectedId) {
      return;
    }
    const source = state.result.document.nodes[state.selectedId];
    if (!source || source.type !== "instance") {
      return;
    }
    await patchDesign(
      [
        {
          op: "update_node",
          nodeId: source.id,
          patch: {
            type: "frame",
            name: source.name.replace(/^Instance of\s+/u, "Detached "),
            componentId: null,
            sourceComponentId: null,
            reusable: false,
          },
        },
      ],
      undefined,
      { label: `Detach ${source.name}` },
    );
  }

  async function exportSelectedNode(): Promise<void> {
    if (state.status !== "ready" || !state.selectedId || !canExport) {
      return;
    }
    try {
      const result = await roderIpc.designExportNodes(workspaceId, rootId, [state.selectedId]);
      setStatusMessage(`Exported ${result.exported[0]?.path ?? "design node"}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function refreshLayoutDiagnostics(): Promise<void> {
    if (state.status !== "ready") {
      return;
    }
    const layoutDiagnostics = await readLayoutDiagnostics(canInspectLayout, workspaceId, rootId);
    setState((current) => (current.status === "ready" ? { ...current, layoutDiagnostics } : current));
  }

  async function scanWorkspaceThemeTokens(): Promise<void> {
    if (state.status !== "ready") {
      return;
    }
    try {
      const result = await scanDesignTokensFromWorkspace(workspaceRootPath);
      if (Object.keys(result.variables).length === 0) {
        setStatusMessage("No Tailwind/CSS design tokens found in common workspace files");
        return;
      }
      await setDesignVariables(result.variables, { label: "Scan workspace theme tokens" });
      const sourceNames = result.sources.map((source) => source.split("/").pop()).join(", ");
      setStatusMessage(`Imported ${Object.keys(result.variables).length} token(s) from ${sourceNames}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  }

  useMountEffect(() => {
    void loadDesign();
    return roderIpc.onNotification((notification: RoderNotification) => {
      if (notification.method === "design/documentChanged") {
        void loadDesign({ preserveSelection: true });
      }
    });
  });

  const selectedNode =
    state.status === "ready" && state.selectedId ? state.result.document.nodes[state.selectedId] : null;

  // Handlers are defined inline above, so their identity changes every render.
  // Route them through one stable dispatch object so the memoized canvas body
  // and inspector can bail out when only unrelated panel state changed.
  const on = useStableHandlers({
    onAgentPermissionsChange: setAgentPermissions,
    onArrangeChildren: arrangeSelectedChildren,
    onAttachRootFrames: attachRootFrames,
    onAttachSelected: attachSelectedNode,
    onChildLayerMode: updateSelectedChildLayers,
    onClearAgentActivities: () => setAgentActivities([]),
    onClearScopedAgentPlan: () => setAgentLaunchPlan([]),
    onClearUndoHistory: () => {
      setUndoStack([]);
      setStatusMessage("Cleared design history");
    },
    onCopySelected: copySelectedNode,
    onCreateNode: insertNodeAt,
    onDeleteSelected: deleteSelectedNode,
    onDetachInstance: detachSelectedInstance,
    onDrawKindChange: setDrawKind,
    onDuplicateSelected: duplicateSelectedNode,
    onExportSelected: exportSelectedNode,
    onFitSelected: fitSelectedNode,
    onFitViewport: fitViewport,
    onGroupSelected: groupSelectedNode,
    onImportFile: () => importInputRef.current?.click(),
    onImportLibraryTokens: importTokensFromDesignLibrary,
    onInsert: insertNode,
    onInsertInstance: insertInstanceFromSelected,
    onInsertInstanceFromComponent: insertInstanceFromComponent,
    onInsertLibraryNode: insertFromDesignLibrary,
    onInsertTemplate: insertTemplate,
    onLayerOrder: reorderSelectedLayer,
    onMakeComponent: makeSelectedComponent,
    onPasteClipboard: pasteDesignClipboard,
    onQueueScopedAgent: queueScopedAgentForSelected,
    onRefreshLayoutDiagnostics: refreshLayoutDiagnostics,
    onRemoveQueuedScopedAgent: (itemId: string) =>
      setAgentLaunchPlan((current) => current.filter((item) => item.id !== itemId)),
    onRestoreUndoSnapshot: restoreUndoSnapshot,
    onReviewSelected: sendSelectedForReview,
    onRunPromptNode: runPromptNode,
    onScanDesignLibraries: scanWorkspaceDesignLibraries,
    onScanWorkspaceTheme: scanWorkspaceThemeTokens,
    onSelectNode: selectNode,
    onSendExternalAgentManifest: sendExternalAgentManifest,
    onSendScopedAgentPlan: sendScopedAgentPlan,
    onShowGridChange: setShowGrid,
    onShowRulersChange: setShowRulers,
    onSnapToGridChange: setSnapToGrid,
    onSpawnScopedAgent: spawnScopedAgentForSelected,
    onUndo: undoLastDesignPatch,
    onUngroupSelected: ungroupSelectedNode,
    onUpdateNode: updateNode,
    onUpdateNodeLocal: (nodeId: string, patch: Partial<RoderDesignNode>) => {
      setState((current) => {
        if (current.status !== "ready") {
          return current;
        }
        const node = current.result.document.nodes[nodeId];
        if (!node) {
          return current;
        }
        return {
          ...current,
          result: {
            ...current.result,
            document: {
              ...current.result.document,
              nodes: {
                ...current.result.document.nodes,
                [nodeId]: { ...node, ...patch },
              },
            },
          },
        };
      });
    },
    onUpdateSelectedNode: updateSelectedNode,
    onUpdateVariables: (variables: Record<string, unknown>) => setDesignVariables(variables),
    onViewportChange: setViewport,
    onZoomBy: zoomBy,
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="truncate text-base font-semibold">Design Canvas</div>
          <div className="truncate text-sm font-normal text-muted-foreground">
            {state.status === "ready" ? state.result.path : "~/.roder/design/<project-slug>-<project-id>.roderdesign"}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          className="rounded-md"
          aria-label="Refresh design"
          title="Refresh design"
          disabled={state.status === "loading" || !available}
          onClick={() => void loadDesign({ preserveSelection: true })}
        >
          <RefreshCw className={cn("size-3.5", state.status === "loading" && "animate-spin")} />
        </Button>
      </header>
      {statusMessage && (
        <div className="shrink-0 border-b border-border bg-muted/30 px-3 py-1 text-sm font-normal text-muted-foreground">
          {statusMessage}
        </div>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_220px]">
        <DesignCanvasBody
          state={state}
          viewport={viewport}
          agentActivities={agentActivities}
          drawKind={drawKind}
          canExport={canExport}
          showGrid={showGrid}
          showRulers={showRulers}
          snapToGrid={snapToGrid}
          selectedNode={selectedNode}
          undoLabel={undoStack.at(-1)?.label ?? null}
          onAttachRootFrames={on.onAttachRootFrames}
          onCreateNode={on.onCreateNode}
          onAttachSelected={on.onAttachSelected}
          onCopySelected={on.onCopySelected}
          onDeleteSelected={on.onDeleteSelected}
          onDuplicateSelected={on.onDuplicateSelected}
          onDrawKindChange={on.onDrawKindChange}
          onExportSelected={on.onExportSelected}
          onFitViewport={on.onFitViewport}
          onFitSelected={on.onFitSelected}
          onImportFile={on.onImportFile}
          onInsert={on.onInsert}
          onPasteClipboard={on.onPasteClipboard}
          onUndo={on.onUndo}
          onShowGridChange={on.onShowGridChange}
          onShowRulersChange={on.onShowRulersChange}
          onRunPromptNode={on.onRunPromptNode}
          onSnapToGridChange={on.onSnapToGridChange}
          onZoomBy={on.onZoomBy}
          onViewportChange={on.onViewportChange}
          onUpdateNode={on.onUpdateNode}
          onUpdateNodeLocal={on.onUpdateNodeLocal}
          onSelectNode={on.onSelectNode}
        />
        <input
          ref={importInputRef}
          type="file"
          aria-label="Import design file"
          className="hidden"
          accept=".pen,.json,.roderdesign,application/json"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) {
              void importDesignFile(file);
            }
          }}
        />
        <DesignInspector
          state={state}
          selectedNode={selectedNode}
          agentPermissions={agentPermissions}
          agentActivities={agentActivities}
          agentLaunchPlan={agentLaunchPlan}
          onSelectNode={on.onSelectNode}
          onUpdateNode={on.onUpdateNode}
          onAttachRootFrames={on.onAttachRootFrames}
          onAttachSelected={on.onAttachSelected}
          onReviewSelected={on.onReviewSelected}
          onArrangeChildren={on.onArrangeChildren}
          onChildLayerMode={on.onChildLayerMode}
          onLayerOrder={on.onLayerOrder}
          onFitSelected={on.onFitSelected}
          onFitViewport={on.onFitViewport}
          onClearAgentActivities={on.onClearAgentActivities}
          undoStack={undoStack}
          onClearUndoHistory={on.onClearUndoHistory}
          onAgentPermissionsChange={on.onAgentPermissionsChange}
          onRefreshLayoutDiagnostics={on.onRefreshLayoutDiagnostics}
          onRestoreUndoSnapshot={on.onRestoreUndoSnapshot}
          onScanWorkspaceTheme={on.onScanWorkspaceTheme}
          onRunPromptNode={on.onRunPromptNode}
          onSendExternalAgentManifest={on.onSendExternalAgentManifest}
          onSpawnScopedAgent={on.onSpawnScopedAgent}
          onQueueScopedAgent={on.onQueueScopedAgent}
          onRemoveQueuedScopedAgent={on.onRemoveQueuedScopedAgent}
          onClearScopedAgentPlan={on.onClearScopedAgentPlan}
          onSendScopedAgentPlan={on.onSendScopedAgentPlan}
          onGroupSelected={on.onGroupSelected}
          onScanDesignLibraries={on.onScanDesignLibraries}
          onMakeComponent={on.onMakeComponent}
          onInsertInstance={on.onInsertInstance}
          onInsertInstanceFromComponent={on.onInsertInstanceFromComponent}
          onInsertLibraryNode={on.onInsertLibraryNode}
          onImportLibraryTokens={on.onImportLibraryTokens}
          onInsertTemplate={on.onInsertTemplate}
          onDetachInstance={on.onDetachInstance}
          onUngroupSelected={on.onUngroupSelected}
          designLibraries={designLibraries}
          libraryScanStatus={libraryScanStatus}
          onUpdateVariables={on.onUpdateVariables}
          onUpdateSelectedNode={on.onUpdateSelectedNode}
        />
      </div>
    </div>
  );
}

import {
  AlertCircle,
  Circle,
  Copy,
  Download,
  Eye,
  EyeOff,
  Frame,
  ImageIcon,
  Lock,
  MessageSquare,
  MousePointer2,
  PenTool,
  Unlock,
  Slash,
  Minus,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Square,
  Trash2,
  Type,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { roderIpc } from "@/lib/roder-ipc";
import { cn } from "@/lib/utils";
import type {
  DesktopAttachment,
  DesignDocumentResult,
  DesignPatchOperation,
  DesignSpawnAgentsResult,
  RoderDesignNode,
  RoderNotification,
} from "@/types/roder";

type DesignCanvasPanelProps = {
  appServerMethods: string[];
  onAttach: (attachment: DesktopAttachment) => void;
  onSendPrompt: (prompt: string, attachments: DesktopAttachment[]) => Promise<void>;
  workspaceId: string;
  rootId: string;
  workspaceRootPath: string;
};

type DesignViewport = {
  x: number;
  y: number;
  zoom: number;
};

type DesignCanvasState =
  | { status: "loading" }
  | { status: "unavailable" }
  | {
      status: "ready";
      result: DesignDocumentResult;
      selectedId: string | null;
      layoutDiagnostics: DesignLayoutDiagnostics;
    }
  | { status: "error"; message: string };

type DesignLayoutDiagnostics = {
  available: boolean;
  nodes: Array<{
    id: string;
    name: string;
    type: string;
    problems: string[];
  }>;
  problemCount: number;
};

type InsertKind = "frame" | "text" | "rectangle" | "ellipse" | "line" | "path" | "icon" | "image" | "prompt";

type NodeDraft = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DesignTemplateId = "hero" | "card" | "form";

type DesignTemplate = {
  id: DesignTemplateId;
  name: string;
  description: string;
};

type ChildArrangeMode = "left" | "center" | "right" | "top" | "middle" | "bottom" | "space-x" | "space-y";

type ChildLayerMode = "show" | "hide" | "lock" | "unlock";

type LayerOrderMode = "front" | "forward" | "backward" | "back";

type DesignClipboardPayload = {
  kind: "roder-design-node";
  version: 1;
  rootId: string;
  nodes: Record<string, RoderDesignNode>;
};

type ThemeScanResult = {
  sources: string[];
  variables: Record<string, unknown>;
};

type DesignLibraryEntry = {
  id: string;
  name: string;
  path: string;
  nodeCount: number;
  nodes: Record<string, RoderDesignNode>;
  rootNodes: RoderDesignNode[];
  variables: Record<string, unknown>;
};

const DESIGN_TEMPLATES: DesignTemplate[] = [
  { id: "hero", name: "Hero section", description: "Frame with headline, body, and CTA" },
  { id: "card", name: "Feature card", description: "Reusable card with icon, title, and copy" },
  { id: "form", name: "Sign-in form", description: "Email/password fields and action button" },
];

const THEME_SCAN_FILES = [
  "tailwind.config.ts",
  "tailwind.config.js",
  "tailwind.config.cjs",
  "tailwind.config.mjs",
  "src/index.css",
  "src/app.css",
  "src/globals.css",
  "app/globals.css",
  "styles/globals.css",
  "styles/tailwind.css",
];

const DESIGN_LIBRARY_FILES = [
  "project.roderdesign",
  ".roderdesign",
  "design.roderdesign",
  "design/system.roderdesign",
  "design/library.roderdesign",
];

type NodeInteraction = {
  kind: "move" | "resize";
  startClientX: number;
  startClientY: number;
  original: NodeDraft;
  draft: NodeDraft;
};

type CreationInteraction = {
  kind: InsertKind;
  pointerId: number;
  startX: number;
  startY: number;
  rect: NodeDraft;
};

type DesignUndoSnapshot = {
  document: DesignDocumentResult["document"];
  summary: DesignPatchSummary;
  label: string;
  selectedId: string | null;
};

type DesignPatchSummary = {
  inserted: number;
  updated: number;
  deleted: number;
  variablesChanged: boolean;
  details: string[];
};

type DesignAgentActivity = {
  id: string;
  nodeId: string;
  nodeName: string;
  scopeId: string;
  scopeName: string;
  kind: "prompt" | "scoped" | "review";
  status: "running" | "sent" | "error";
  message: string;
};

type DesignAgentLaunchPlanItem = {
  id: string;
  nodeId: string;
  nodeName: string;
  scopeId: string;
  scopeName: string;
};

type DesignAgentPermissions = {
  preset: "observe" | "review" | "autonomous" | "custom";
  allowPatch: boolean;
  allowExport: boolean;
  requireReview: boolean;
};

const AGENT_PERMISSION_PRESETS: Array<{
  id: Exclude<DesignAgentPermissions["preset"], "custom">;
  label: string;
  permissions: Omit<DesignAgentPermissions, "preset">;
}> = [
  {
    id: "observe",
    label: "Observe",
    permissions: { allowPatch: false, allowExport: false, requireReview: true },
  },
  {
    id: "review",
    label: "Review",
    permissions: { allowPatch: true, allowExport: true, requireReview: true },
  },
  {
    id: "autonomous",
    label: "Auto",
    permissions: { allowPatch: true, allowExport: true, requireReview: false },
  },
];

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
      setState({ status: "ready", result, selectedId: options.selectedId ?? state.selectedId, layoutDiagnostics });
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
      const result = await roderIpc.readDesign(workspaceId, rootId);
      const layoutDiagnostics = await readLayoutDiagnostics(canInspectLayout, workspaceId, rootId);
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
              document: cloneDesignDocument(state.result.document),
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
      setState({
        status: "ready",
        result,
        selectedId: selectedId === undefined ? (state.status === "ready" ? state.selectedId : null) : selectedId,
        layoutDiagnostics,
      });
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
    setState({ ...state, layoutDiagnostics });
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
          onAttachRootFrames={attachRootFrames}
          onCreateNode={insertNodeAt}
          onAttachSelected={attachSelectedNode}
          onCopySelected={copySelectedNode}
          onDeleteSelected={deleteSelectedNode}
          onDuplicateSelected={duplicateSelectedNode}
          onDrawKindChange={setDrawKind}
          onExportSelected={exportSelectedNode}
          onFitViewport={fitViewport}
          onFitSelected={fitSelectedNode}
          onImportFile={() => importInputRef.current?.click()}
          onInsert={insertNode}
          onPasteClipboard={pasteDesignClipboard}
          onUndo={undoLastDesignPatch}
          onShowGridChange={setShowGrid}
          onShowRulersChange={setShowRulers}
          onRunPromptNode={runPromptNode}
          onSnapToGridChange={setSnapToGrid}
          onZoomBy={zoomBy}
          onViewportChange={setViewport}
          onUpdateNode={updateNode}
          onUpdateNodeLocal={(nodeId, patch) => {
            if (state.status !== "ready") {
              return;
            }
            const node = state.result.document.nodes[nodeId];
            if (!node) {
              return;
            }
            setState({
              ...state,
              result: {
                ...state.result,
                document: {
                  ...state.result.document,
                  nodes: {
                    ...state.result.document.nodes,
                    [nodeId]: { ...node, ...patch },
                  },
                },
              },
            });
          }}
          onSelectNode={selectNode}
        />
        <input
          ref={importInputRef}
          type="file"
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
          onSelectNode={selectNode}
          onUpdateNode={updateNode}
          onAttachRootFrames={attachRootFrames}
          onAttachSelected={attachSelectedNode}
          onReviewSelected={sendSelectedForReview}
          onArrangeChildren={arrangeSelectedChildren}
          onChildLayerMode={updateSelectedChildLayers}
          onLayerOrder={reorderSelectedLayer}
          onFitSelected={fitSelectedNode}
          onFitViewport={fitViewport}
          onClearAgentActivities={() => setAgentActivities([])}
          undoStack={undoStack}
          onClearUndoHistory={() => {
            setUndoStack([]);
            setStatusMessage("Cleared design history");
          }}
          onAgentPermissionsChange={setAgentPermissions}
          onRefreshLayoutDiagnostics={refreshLayoutDiagnostics}
          onRestoreUndoSnapshot={restoreUndoSnapshot}
          onScanWorkspaceTheme={scanWorkspaceThemeTokens}
          onRunPromptNode={runPromptNode}
          onSendExternalAgentManifest={sendExternalAgentManifest}
          onSpawnScopedAgent={spawnScopedAgentForSelected}
          onQueueScopedAgent={queueScopedAgentForSelected}
          onRemoveQueuedScopedAgent={(itemId) =>
            setAgentLaunchPlan((current) => current.filter((item) => item.id !== itemId))
          }
          onClearScopedAgentPlan={() => setAgentLaunchPlan([])}
          onSendScopedAgentPlan={sendScopedAgentPlan}
          onGroupSelected={groupSelectedNode}
          onScanDesignLibraries={scanWorkspaceDesignLibraries}
          onMakeComponent={makeSelectedComponent}
          onInsertInstance={insertInstanceFromSelected}
          onInsertInstanceFromComponent={insertInstanceFromComponent}
          onInsertLibraryNode={insertFromDesignLibrary}
          onImportLibraryTokens={importTokensFromDesignLibrary}
          onInsertTemplate={insertTemplate}
          onDetachInstance={detachSelectedInstance}
          onUngroupSelected={ungroupSelectedNode}
          designLibraries={designLibraries}
          libraryScanStatus={libraryScanStatus}
          onUpdateVariables={(variables) => setDesignVariables(variables)}
          onUpdateSelectedNode={updateSelectedNode}
        />
      </div>
    </div>
  );
}

function DesignLayers({
  nodes,
  onSelectNode,
  onUpdateNode,
  rootIds,
  selectedId,
}: {
  nodes: Record<string, RoderDesignNode>;
  rootIds: string[];
  selectedId: string | null;
  onSelectNode: (id: string) => void;
  onUpdateNode: (nodeId: string, patch: Partial<RoderDesignNode>) => Promise<void>;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const normalizedQuery = normalizeLayerQuery(query);
  const matchingIds = normalizedQuery ? matchingLayerIds(nodes, rootIds, normalizedQuery) : null;
  const visibleRootIds = matchingIds ? rootIds.filter((id) => matchingIds.has(id)) : rootIds;
  const matchCount = matchingIds ? matchingIds.size : Object.keys(nodes).length;
  const firstMatchId = normalizedQuery ? firstMatchingLayerId(nodes, rootIds, normalizedQuery) : null;
  return (
    <section className="flex flex-col gap-1 rounded-lg bg-muted/30 p-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="text-sm font-semibold text-muted-foreground">Layers</div>
        <div className="text-xs text-muted-foreground/80">
          {matchingIds ? `${matchCount} match${matchCount === 1 ? "" : "es"}` : `${Object.keys(nodes).length} nodes`}
        </div>
      </div>
      <div className="flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
        <input
          type="search"
          value={query}
          aria-label="Search layers"
          placeholder="Search layers, types, tokens..."
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && firstMatchId) {
              event.preventDefault();
              onSelectNode(firstMatchId);
            }
          }}
        />
        {firstMatchId && <kbd className="rounded bg-muted px-1 text-[10px] text-muted-foreground">Enter</kbd>}
        {query && (
          <button
            type="button"
            className="rounded px-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => setQuery("")}
          >
            Clear
          </button>
        )}
      </div>
      {visibleRootIds.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-2 py-2 text-xs text-muted-foreground">
          No layers match “{query}”. Try a node name, type, component id, or prompt text.
        </div>
      ) : (
        visibleRootIds.map((id) => {
          const node = nodes[id];
          return node ? (
            <DesignLayerRow
              key={id}
              depth={0}
              node={node}
              nodes={nodes}
              searchQuery={normalizedQuery}
              visibleIds={matchingIds}
              selectedId={selectedId}
              onSelectNode={onSelectNode}
              onUpdateNode={onUpdateNode}
            />
          ) : null;
        })
      )}
    </section>
  );
}

function DesignLayerRow({
  depth,
  node,
  nodes,
  onUpdateNode,
  searchQuery,
  onSelectNode,
  selectedId,
  visibleIds,
}: {
  depth: number;
  node: RoderDesignNode;
  nodes: Record<string, RoderDesignNode>;
  searchQuery: string;
  selectedId: string | null;
  visibleIds: Set<string> | null;
  onSelectNode: (id: string) => void;
  onUpdateNode: (nodeId: string, patch: Partial<RoderDesignNode>) => Promise<void>;
}): React.JSX.Element {
  const visible = node.visible !== false;
  const locked = node.locked === true;
  const directMatch = Boolean(searchQuery && layerNodeMatches(node, searchQuery));
  return (
    <div>
      <div
        className={cn(
          "flex h-7 w-full items-center gap-1 rounded-md px-1 text-sm font-medium hover:bg-accent/60",
          selectedId === node.id && "bg-accent/60 text-foreground",
          directMatch && selectedId !== node.id && "bg-ring/10 text-foreground",
          !visible && "text-muted-foreground/60",
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => onSelectNode(node.id)}
        >
          {node.type === "text" ? (
            <Type className="size-3.5 shrink-0" />
          ) : node.type === "line" ? (
            <Slash className="size-3.5 shrink-0" />
          ) : node.type === "prompt" ? (
            <MessageSquare className="size-3.5 shrink-0" />
          ) : node.type === "image" ? (
            <ImageIcon className="size-3.5 shrink-0" />
          ) : (
            <Frame className="size-3.5 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          {node.type === "component" && (
            <span className="rounded bg-blue-500/10 px-1 text-[10px] font-semibold uppercase text-blue-600">Comp</span>
          )}
          {node.type === "instance" && (
            <span className="rounded bg-violet-500/10 px-1 text-[10px] font-semibold uppercase text-violet-600">
              Inst
            </span>
          )}
        </button>
        <LayerIconButton
          label={visible ? `Hide ${node.name}` : `Show ${node.name}`}
          onClick={() => onUpdateNode(node.id, { visible: !visible })}
        >
          {visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
        </LayerIconButton>
        <LayerIconButton
          label={locked ? `Unlock ${node.name}` : `Lock ${node.name}`}
          onClick={() => onUpdateNode(node.id, { locked: !locked })}
        >
          {locked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
        </LayerIconButton>
      </div>
      {(node.childIds ?? []).map((id) => {
        if (visibleIds && !visibleIds.has(id)) {
          return null;
        }
        const child = nodes[id];
        return child ? (
          <DesignLayerRow
            key={id}
            depth={depth + 1}
            node={child}
            nodes={nodes}
            searchQuery={searchQuery}
            visibleIds={visibleIds}
            selectedId={selectedId}
            onSelectNode={onSelectNode}
            onUpdateNode={onUpdateNode}
          />
        ) : null;
      })}
    </div>
  );
}

function LayerIconButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => Promise<void>;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        void onClick();
      }}
    >
      {children}
    </button>
  );
}

function DesignToolbar({
  canExport,
  drawKind,
  selectedNode,
  showGrid,
  showRulers,
  snapToGrid,
  undoLabel,
  onAttachRootFrames,
  onAttachSelected,
  onCopySelected,
  onDeleteSelected,
  onDuplicateSelected,
  onDrawKindChange,
  onExportSelected,
  onFitViewport,
  onFitSelected,
  onImportFile,
  onInsert,
  onPasteClipboard,
  onUndo,
  onShowGridChange,
  onShowRulersChange,
  onSnapToGridChange,
  onZoomBy,
  viewport,
}: {
  canExport: boolean;
  drawKind: InsertKind | null;
  selectedNode: RoderDesignNode | null;
  showGrid: boolean;
  showRulers: boolean;
  snapToGrid: boolean;
  undoLabel: string | null;
  onAttachRootFrames: () => Promise<void>;
  onAttachSelected: () => Promise<void>;
  onCopySelected: () => Promise<void>;
  onDeleteSelected: () => Promise<void>;
  onDuplicateSelected: () => Promise<void>;
  onDrawKindChange: (kind: InsertKind | null) => void;
  onExportSelected: () => Promise<void>;
  onFitViewport: () => void;
  onFitSelected: () => void;
  onImportFile: () => void;
  onInsert: (kind: InsertKind) => Promise<void>;
  onPasteClipboard: () => Promise<void>;
  onUndo: () => Promise<void>;
  onShowGridChange: (showGrid: boolean) => void;
  onShowRulersChange: (showRulers: boolean) => void;
  onSnapToGridChange: (snapToGrid: boolean) => void;
  onZoomBy: (delta: number) => void;
  viewport: DesignViewport;
}): React.JSX.Element {
  return (
    <>
      <div className="pointer-events-auto absolute left-3 top-3 z-20 flex flex-col items-center gap-1 rounded-2xl border border-border/80 bg-background/95 p-1.5 shadow-xl shadow-black/10 backdrop-blur">
        <ToolbarButton active={drawKind === null} label="Select" shortcut="V" onClick={() => selectTool(null)}>
          <MousePointer2 className="size-5" />
        </ToolbarButton>
        <ToolbarButton
          active={drawKind === "rectangle"}
          label="Rectangle"
          shortcut="R"
          onClick={() => toggleDrawKind("rectangle")}
        >
          <Square className="size-5" />
        </ToolbarButton>
        <ToolbarButton
          active={drawKind === "ellipse"}
          label="Ellipse"
          shortcut="O"
          onClick={() => toggleDrawKind("ellipse")}
        >
          <Circle className="size-5" />
        </ToolbarButton>
        <ToolbarButton active={drawKind === "line"} label="Line" shortcut="L" onClick={() => toggleDrawKind("line")}>
          <Slash className="size-5" />
        </ToolbarButton>
        <ToolbarButton active={drawKind === "text"} label="Text" shortcut="T" onClick={() => toggleDrawKind("text")}>
          <Type className="size-5" />
        </ToolbarButton>
        <ToolbarButton active={drawKind === "frame"} label="Frame" shortcut="F" onClick={() => toggleDrawKind("frame")}>
          <Frame className="size-5" />
        </ToolbarButton>
        <ToolbarButton active={drawKind === "image"} label="Image" shortcut="I" onClick={() => toggleDrawKind("image")}>
          <ImageIcon className="size-5" />
        </ToolbarButton>
        <ToolbarButton
          active={drawKind === "prompt"}
          label="Agent prompt"
          shortcut="P"
          onClick={() => toggleDrawKind("prompt")}
        >
          <MessageSquare className="size-5" />
        </ToolbarButton>
        <ToolbarButton label="Quick add" shortcut="A" onClick={() => onInsert(drawKind ?? "frame")}>
          <Plus className="size-5" />
        </ToolbarButton>
        <div className="my-1 h-px w-7 bg-border" />
        <ToolbarButton
          active={showGrid}
          label={showGrid ? "Hide grid" : "Show grid"}
          shortcut="G"
          onClick={() => toggleGrid()}
        >
          <SlidersHorizontal className="size-5" />
        </ToolbarButton>
        <ToolbarButton
          active={showRulers}
          label={showRulers ? "Hide rulers" : "Show rulers"}
          shortcut="U"
          onClick={() => toggleRulers()}
        >
          <Minus className="size-5" />
        </ToolbarButton>
        <ToolbarButton
          active={snapToGrid}
          label={snapToGrid ? "Disable snap" : "Enable snap"}
          shortcut="S"
          onClick={() => toggleSnap()}
        >
          <Frame className="size-5" />
        </ToolbarButton>
        <div className="my-1 h-px w-7 bg-border" />
        <ToolbarButton
          disabled={!undoLabel}
          label={undoLabel ? `Undo ${undoLabel}` : "Undo"}
          shortcut="⌘Z"
          onClick={() => onUndo()}
        >
          <RefreshCw className="size-5 -scale-x-100" />
        </ToolbarButton>
        <ToolbarButton disabled={!selectedNode} label="Duplicate" shortcut="⌘D" onClick={() => onDuplicateSelected()}>
          <Copy className="size-5" />
        </ToolbarButton>
        <ToolbarButton disabled={!selectedNode} label="Copy node" shortcut="⌘C" onClick={() => onCopySelected()}>
          <Copy className="size-5" />
        </ToolbarButton>
        <ToolbarButton label="Paste node" shortcut="⌘V" onClick={() => onPasteClipboard()}>
          <Plus className="size-5" />
        </ToolbarButton>
        <ToolbarButton
          disabled={!selectedNode || !canExport}
          label="Export"
          shortcut="⇧⌘E"
          onClick={() => onExportSelected()}
        >
          <Download className="size-5" />
        </ToolbarButton>
        <ToolbarButton label="Import .pen/JSON" shortcut="⇧⌘I" onClick={() => openImportFile()}>
          <Upload className="size-5" />
        </ToolbarButton>
        <ToolbarButton
          disabled={!selectedNode || !canExport}
          label="Attach to composer"
          shortcut="⇧⌘A"
          onClick={() => onAttachSelected()}
        >
          <MessageSquare className="size-5" />
        </ToolbarButton>
        <ToolbarButton
          disabled={!canExport}
          label="Attach all frames"
          shortcut="⌥⇧⌘A"
          onClick={() => onAttachRootFrames()}
        >
          <Frame className="size-5" />
        </ToolbarButton>
        <ToolbarButton disabled={!selectedNode} label="Delete" shortcut="Del" onClick={() => onDeleteSelected()}>
          <Trash2 className="size-5" />
        </ToolbarButton>
        <div className="my-1 h-px w-7 bg-border" />
        <ToolbarButton label="Fit canvas" shortcut="⇧1" onClick={() => Promise.resolve(onFitViewport())}>
          <Frame className="size-5" />
        </ToolbarButton>
        <ToolbarButton
          disabled={!selectedNode}
          label="Fit selected"
          shortcut="⇧2"
          onClick={() => Promise.resolve(onFitSelected())}
        >
          <MousePointer2 className="size-5" />
        </ToolbarButton>
      </div>
      <div className="pointer-events-auto absolute bottom-4 right-4 z-20 flex items-center gap-2 rounded-xl border border-border/80 bg-background/95 p-2 shadow-xl shadow-black/10 backdrop-blur">
        <Button
          variant="ghost"
          size="icon-xs"
          className="rounded-md"
          aria-label="Zoom out"
          onClick={() => onZoomBy(-0.1)}
        >
          <Minus className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 min-w-16 rounded-md px-2 font-semibold"
          onClick={onFitViewport}
        >
          {Math.round(viewport.zoom * 100)}%
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="rounded-md"
          aria-label="Zoom in"
          onClick={() => onZoomBy(0.1)}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </>
  );

  function selectTool(kind: InsertKind | null): Promise<void> {
    onDrawKindChange(kind);
    return Promise.resolve();
  }

  function toggleDrawKind(kind: InsertKind): Promise<void> {
    onDrawKindChange(drawKind === kind ? null : kind);
    return Promise.resolve();
  }

  function toggleGrid(): Promise<void> {
    onShowGridChange(!showGrid);
    return Promise.resolve();
  }

  function toggleRulers(): Promise<void> {
    onShowRulersChange(!showRulers);
    return Promise.resolve();
  }

  function toggleSnap(): Promise<void> {
    onSnapToGridChange(!snapToGrid);
    return Promise.resolve();
  }

  function openImportFile(): Promise<void> {
    onImportFile();
    return Promise.resolve();
  }
}

function ToolbarButton({
  active,
  children,
  disabled,
  label,
  onClick,
  shortcut,
}: {
  active?: boolean;
  children: React.ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => Promise<void>;
  shortcut?: string;
}): React.JSX.Element {
  return (
    <div className="group relative">
      <button
        type="button"
        className={cn(
          "grid size-10 place-items-center rounded-xl border text-foreground transition",
          active
            ? "border-border bg-muted text-foreground shadow-sm"
            : "border-transparent bg-transparent hover:border-border/70 hover:bg-background hover:shadow-sm",
          disabled && "cursor-not-allowed opacity-40 hover:border-transparent hover:bg-transparent hover:shadow-none",
        )}
        aria-pressed={active}
        aria-label={label}
        disabled={disabled}
        onClick={() => void onClick()}
      >
        {children}
      </button>
      <div className="pointer-events-none absolute left-[calc(100%+14px)] top-1/2 z-30 hidden -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-lg bg-zinc-950 px-3 py-2 text-sm font-semibold text-white shadow-lg group-hover:flex">
        <span className="absolute -left-1 size-2 rotate-45 bg-zinc-950" />
        <span>{label}</span>
        {shortcut && <kbd className="rounded-md bg-white px-2 py-1 text-xs font-bold text-zinc-900">{shortcut}</kbd>}
      </div>
    </div>
  );
}

function DesignCanvasBody({
  agentActivities,
  canExport,
  drawKind,
  selectedNode,
  showGrid,
  showRulers,
  snapToGrid,
  undoLabel,
  onAttachRootFrames,
  onAttachSelected,
  onCopySelected,
  onCreateNode,
  onDeleteSelected,
  onDuplicateSelected,
  onDrawKindChange,
  onExportSelected,
  onFitViewport,
  onFitSelected,
  onImportFile,
  onInsert,
  onPasteClipboard,
  onUndo,
  onShowGridChange,
  onShowRulersChange,
  onSnapToGridChange,
  onZoomBy,
  onViewportChange,
  onSelectNode,
  onRunPromptNode,
  onUpdateNodeLocal,
  onUpdateNode,
  state,
  viewport,
}: {
  state: DesignCanvasState;
  viewport: DesignViewport;
  agentActivities: DesignAgentActivity[];
  canExport: boolean;
  drawKind: InsertKind | null;
  selectedNode: RoderDesignNode | null;
  showGrid: boolean;
  showRulers: boolean;
  snapToGrid: boolean;
  undoLabel: string | null;
  onAttachRootFrames: () => Promise<void>;
  onAttachSelected: () => Promise<void>;
  onCopySelected: () => Promise<void>;
  onCreateNode: (kind: InsertKind, rect: NodeDraft) => Promise<void>;
  onDeleteSelected: () => Promise<void>;
  onDuplicateSelected: () => Promise<void>;
  onDrawKindChange: (kind: InsertKind | null) => void;
  onExportSelected: () => Promise<void>;
  onFitViewport: () => void;
  onFitSelected: () => void;
  onImportFile: () => void;
  onInsert: (kind: InsertKind) => Promise<void>;
  onPasteClipboard: () => Promise<void>;
  onUndo: () => Promise<void>;
  onShowGridChange: (showGrid: boolean) => void;
  onShowRulersChange: (showRulers: boolean) => void;
  onSnapToGridChange: (snapToGrid: boolean) => void;
  onZoomBy: (delta: number) => void;
  onViewportChange: (viewport: DesignViewport | ((current: DesignViewport) => DesignViewport)) => void;
  onSelectNode: (id: string | null) => void;
  onRunPromptNode: (node: RoderDesignNode) => Promise<void>;
  onUpdateNodeLocal: (nodeId: string, patch: Partial<RoderDesignNode>) => void;
  onUpdateNode: (nodeId: string, patch: Partial<RoderDesignNode>) => Promise<void>;
}): React.JSX.Element {
  const [panStart, setPanStart] = useState<{ clientX: number; clientY: number; viewport: DesignViewport } | null>(null);
  const [creation, setCreation] = useState<CreationInteraction | null>(null);
  const [cursorPoint, setCursorPoint] = useState<{ x: number; y: number } | null>(null);
  if (state.status === "unavailable") {
    return (
      <DesignCanvasMessage
        icon={<AlertCircle className="size-5" />}
        title="Design tools unavailable"
        description="Restart Roder after the bundled app-server is rebuilt so design methods are available."
      />
    );
  }
  if (state.status === "loading") {
    return (
      <DesignCanvasMessage
        title="Loading design"
        description="Opening or creating the project-specific ~/.roder/design/*.roderdesign file."
      />
    );
  }
  if (state.status === "error") {
    return (
      <DesignCanvasMessage
        icon={<AlertCircle className="size-5" />}
        title="Could not load design"
        description={state.message}
      />
    );
  }

  const rootNodes = state.result.document.rootIds
    .map((id) => state.result.document.nodes[id])
    .filter((node): node is RoderDesignNode => Boolean(node));

  return (
    <div
      className="min-h-0 flex-1 overflow-hidden bg-muted/30"
      onWheel={(event) => {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          onViewportChange((current) => ({ ...current, zoom: clampZoom(current.zoom - event.deltaY * 0.001) }));
        }
      }}
    >
      <div
        className={cn(
          "relative size-full overflow-hidden bg-zinc-50",
          drawKind ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing",
        )}
        role="button"
        tabIndex={0}
        aria-label="Clear design selection"
        onClick={(event) => {
          if (event.currentTarget === event.target) {
            onSelectNode(null);
          }
        }}
        onKeyDown={(event) => {
          if (isTextEditingTarget(event.target)) {
            return;
          }
          if (event.key === "Escape") {
            onDrawKindChange(null);
            onSelectNode(null);
            return;
          }
          const shortcut = event.key.toLowerCase();
          if (!event.metaKey && !event.ctrlKey && !event.altKey) {
            const shortcutKind = insertKindForShortcut(shortcut);
            if (shortcutKind !== undefined) {
              event.preventDefault();
              onDrawKindChange(shortcutKind === drawKind ? null : shortcutKind);
              return;
            }
            if (shortcut === "v") {
              event.preventDefault();
              onDrawKindChange(null);
              return;
            }
            if (shortcut === "g") {
              event.preventDefault();
              onShowGridChange(!showGrid);
              return;
            }
            if (shortcut === "u") {
              event.preventDefault();
              onShowRulersChange(!showRulers);
              return;
            }
            if (shortcut === "s") {
              event.preventDefault();
              onSnapToGridChange(!snapToGrid);
              return;
            }
          }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
            event.preventDefault();
            void onUndo();
            return;
          }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
            event.preventDefault();
            void onPasteClipboard();
            return;
          }
          if (event.shiftKey && event.key === "!") {
            event.preventDefault();
            onFitViewport();
            return;
          }
          if (event.shiftKey && event.key === "@") {
            event.preventDefault();
            onFitSelected();
            return;
          }
          if (!state.selectedId) {
            return;
          }
          const selectedNode = state.result.document.nodes[state.selectedId];
          if (!selectedNode) {
            return;
          }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
            event.preventDefault();
            void onDuplicateSelected();
            return;
          }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
            event.preventDefault();
            void onCopySelected();
            return;
          }
          if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "e") {
            event.preventDefault();
            void onExportSelected();
            return;
          }
          if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "i") {
            event.preventDefault();
            onImportFile();
            return;
          }
          if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "a") {
            event.preventDefault();
            if (event.altKey) {
              void onAttachRootFrames();
            } else {
              void onAttachSelected();
            }
            return;
          }
          if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            void onDeleteSelected();
            return;
          }
          if (selectedNode.locked === true) {
            return;
          }
          const delta = event.shiftKey ? GRID_SIZE : snapToGrid ? GRID_SIZE : 1;
          const nudge = arrowKeyNudge(event.key, delta);
          if (nudge) {
            event.preventDefault();
            void onUpdateNode(selectedNode.id, {
              x: Number(selectedNode.x ?? 0) + nudge.x,
              y: Number(selectedNode.y ?? 0) + nudge.y,
            });
          }
        }}
        onPointerDown={(event) => {
          if (drawKind) {
            return;
          }
          if (event.currentTarget !== event.target) {
            return;
          }
          event.currentTarget.setPointerCapture(event.pointerId);
          setPanStart({ clientX: event.clientX, clientY: event.clientY, viewport });
        }}
        onPointerMove={(event) => {
          setCursorPoint(viewportPoint(event, viewport));
          if (drawKind) {
            return;
          }
          if (!panStart) {
            return;
          }
          onViewportChange({
            ...panStart.viewport,
            x: panStart.viewport.x + event.clientX - panStart.clientX,
            y: panStart.viewport.y + event.clientY - panStart.clientY,
          });
        }}
        onPointerLeave={() => setCursorPoint(null)}
        onPointerUp={() => setPanStart(null)}
        onPointerCancel={() => {
          setCursorPoint(null);
          setPanStart(null);
        }}
      >
        <DesignToolbar
          canExport={canExport}
          drawKind={drawKind}
          selectedNode={selectedNode}
          showGrid={showGrid}
          showRulers={showRulers}
          snapToGrid={snapToGrid}
          undoLabel={undoLabel}
          onAttachRootFrames={onAttachRootFrames}
          onAttachSelected={onAttachSelected}
          onCopySelected={onCopySelected}
          onDeleteSelected={onDeleteSelected}
          onDuplicateSelected={onDuplicateSelected}
          onDrawKindChange={onDrawKindChange}
          onExportSelected={onExportSelected}
          onFitViewport={onFitViewport}
          onFitSelected={onFitSelected}
          onImportFile={onImportFile}
          onInsert={onInsert}
          onPasteClipboard={onPasteClipboard}
          onUndo={onUndo}
          onShowGridChange={onShowGridChange}
          onShowRulersChange={onShowRulersChange}
          onSnapToGridChange={onSnapToGridChange}
          onZoomBy={onZoomBy}
          viewport={viewport}
        />
        <div
          className="absolute min-h-[720px] min-w-[960px] bg-white"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            transformOrigin: "0 0",
            width: 1280,
            height: 900,
            backgroundImage: showGrid
              ? "linear-gradient(to right, rgb(228 228 231 / 0.7) 1px, transparent 1px), linear-gradient(to bottom, rgb(228 228 231 / 0.7) 1px, transparent 1px)"
              : undefined,
            backgroundSize: showGrid ? "24px 24px" : undefined,
          }}
          onPointerDown={(event) => {
            setCursorPoint(stagePoint(event, viewport.zoom, false));
            if (!drawKind || event.currentTarget !== event.target) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            const point = stagePoint(event, viewport.zoom, snapToGrid);
            setCreation({
              kind: drawKind,
              pointerId: event.pointerId,
              startX: point.x,
              startY: point.y,
              rect: { x: point.x, y: point.y, width: 1, height: 1 },
            });
          }}
          onPointerMove={(event) => {
            setCursorPoint(stagePoint(event, viewport.zoom, false));
            if (!creation || creation.pointerId !== event.pointerId) {
              return;
            }
            const point = stagePoint(event, viewport.zoom, snapToGrid);
            setCreation({
              ...creation,
              rect: normalizedRect(creation.startX, creation.startY, point.x, point.y),
            });
          }}
          onPointerUp={(event) => {
            if (!creation || creation.pointerId !== event.pointerId) {
              return;
            }
            event.stopPropagation();
            const rect = creation.rect;
            setCreation(null);
            if (rect.width >= 8 && rect.height >= 8) {
              void onCreateNode(creation.kind, rect);
            }
          }}
          onPointerCancel={() => setCreation(null)}
        >
          {creation && <CreationPreview kind={creation.kind} rect={creation.rect} />}
          {rootNodes.map((node) => (
            <DesignNodePreview
              document={state.result.document}
              key={node.id}
              node={node}
              onDeleteSelected={onDeleteSelected}
              onDuplicateSelected={onDuplicateSelected}
              onFitSelected={onFitSelected}
              onUpdateNodeLocal={onUpdateNodeLocal}
              onUpdateNode={onUpdateNode}
              onRunPromptNode={onRunPromptNode}
              selected={state.selectedId === node.id}
              selectedId={state.selectedId}
              snapToGrid={snapToGrid}
              zoom={viewport.zoom}
              onSelectNode={onSelectNode}
            />
          ))}
          <DesignAgentActivityOverlay activities={agentActivities} nodes={state.result.document.nodes} />
        </div>
        {showRulers && <DesignRulers viewport={viewport} />}
        {showRulers && (
          <DesignCoordinateReadout cursorPoint={cursorPoint} selectedNode={selectedNode} snapToGrid={snapToGrid} />
        )}
        <DesignMiniMap
          document={state.result.document}
          selectedId={state.selectedId}
          viewport={viewport}
          onFitSelected={onFitSelected}
          onFitViewport={onFitViewport}
          onSelectNode={onSelectNode}
          onViewportChange={onViewportChange}
        />
      </div>
    </div>
  );
}

function DesignMiniMap({
  document,
  onFitSelected,
  onFitViewport,
  onSelectNode,
  onViewportChange,
  selectedId,
  viewport,
}: {
  document: DesignDocumentResult["document"];
  viewport: DesignViewport;
  selectedId: string | null;
  onFitSelected: () => void;
  onFitViewport: () => void;
  onSelectNode: (id: string | null) => void;
  onViewportChange: (viewport: DesignViewport | ((current: DesignViewport) => DesignViewport)) => void;
}): React.JSX.Element | null {
  const bounds = documentBounds(document);
  if (!bounds) {
    return null;
  }
  const model = miniMapModel(document, bounds, viewport);
  const roots = document.rootIds
    .map((id) => document.nodes[id])
    .filter((node): node is RoderDesignNode => Boolean(node) && node.visible !== false);

  function panToMiniMapPoint(x: number, y: number): void {
    const canvasPoint = miniMapCanvasPoint(model, x, y);
    onViewportChange((current) => ({
      ...current,
      x: Math.round(360 - canvasPoint.x * current.zoom),
      y: Math.round(260 - canvasPoint.y * current.zoom),
    }));
  }

  return (
    <aside className="pointer-events-auto absolute bottom-4 right-4 z-20 flex w-48 flex-col gap-2 rounded-2xl border border-border/80 bg-background/95 p-2 shadow-xl shadow-black/10 backdrop-blur">
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Overview</div>
        <div className="text-xs text-muted-foreground">{Math.round(viewport.zoom * 100)}%</div>
      </div>
      <div
        className="relative cursor-crosshair overflow-hidden rounded-lg border border-border bg-zinc-50"
        style={{ width: model.width, height: model.height }}
        aria-label="Design overview mini-map"
        role="button"
        tabIndex={0}
        title="Click to pan viewport"
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          panToMiniMapPoint(event.clientX - bounds.left, event.clientY - bounds.top);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            panToMiniMapPoint(model.width / 2, model.height / 2);
            return;
          }
          const nudge = arrowKeyNudge(event.key, event.shiftKey ? 48 : 16);
          if (nudge) {
            event.preventDefault();
            onViewportChange((current) => ({ ...current, x: current.x - nudge.x, y: current.y - nudge.y }));
          }
        }}
      >
        {roots.map((node) => {
          const rect = miniMapNodeRect(document, node, model);
          return (
            <button
              key={node.id}
              type="button"
              className={cn(
                "absolute rounded-[2px] border bg-white/85 transition hover:bg-accent",
                node.id === selectedId ? "border-ring shadow-sm" : "border-zinc-300",
              )}
              style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
              title={`Select ${node.name}`}
              aria-label={`Select ${node.name}`}
              onClick={(event) => {
                event.stopPropagation();
                onSelectNode(node.id);
              }}
            />
          );
        })}
        <div
          className="pointer-events-none absolute rounded border-2 border-blue-500/80 bg-blue-500/10"
          style={{
            left: model.viewport.x,
            top: model.viewport.y,
            width: model.viewport.width,
            height: model.viewport.height,
          }}
          aria-hidden
        />
      </div>
      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-accent/60"
          onClick={onFitViewport}
        >
          Fit all
        </button>
        <button
          type="button"
          className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!selectedId}
          onClick={onFitSelected}
        >
          Fit sel.
        </button>
      </div>
    </aside>
  );
}

function DesignRulers({ viewport }: { viewport: DesignViewport }): React.JSX.Element {
  const xTicks = rulerTicks(viewport.x, viewport.zoom, 0, 1600, 96);
  const yTicks = rulerTicks(viewport.y, viewport.zoom, 0, 1000, 96);
  return (
    <>
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 h-6 border-b border-border/70 bg-background/80 text-[10px] text-muted-foreground backdrop-blur">
        {xTicks.map((tick) => (
          <div
            key={`x-${tick.value}`}
            className="absolute top-0 h-full border-l border-border/80"
            style={{ left: tick.position }}
          >
            <span className="ml-1 leading-6">{tick.value}</span>
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute bottom-0 left-0 top-0 z-10 w-7 border-r border-border/70 bg-background/80 text-[10px] text-muted-foreground backdrop-blur">
        {yTicks.map((tick) => (
          <div
            key={`y-${tick.value}`}
            className="absolute left-0 w-full border-t border-border/80"
            style={{ top: tick.position }}
          >
            <span className="absolute left-1 top-1 origin-left -rotate-90">{tick.value}</span>
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute left-0 top-0 z-20 size-7 border-b border-r border-border/70 bg-background/95" />
    </>
  );
}

function DesignCoordinateReadout({
  cursorPoint,
  selectedNode,
  snapToGrid,
}: {
  cursorPoint: { x: number; y: number } | null;
  selectedNode: RoderDesignNode | null;
  snapToGrid: boolean;
}): React.JSX.Element {
  const selectedRect = selectedNode ? nodeRect(selectedNode) : null;
  return (
    <div className="pointer-events-none absolute bottom-4 left-4 z-20 flex flex-col gap-1 rounded-xl border border-border/80 bg-background/95 px-3 py-2 text-xs text-muted-foreground shadow-lg shadow-black/10 backdrop-blur">
      <div>
        Cursor {cursorPoint ? `${Math.round(cursorPoint.x)}, ${Math.round(cursorPoint.y)}` : "--, --"}
        {snapToGrid ? " · snap" : ""}
      </div>
      {selectedRect && (
        <div>
          Sel {Math.round(selectedRect.x)}, {Math.round(selectedRect.y)} · {Math.round(selectedRect.width)}x
          {Math.round(selectedRect.height)}
        </div>
      )}
    </div>
  );
}

function DesignNodePreview({
  document,
  node,
  onDeleteSelected,
  onDuplicateSelected,
  onFitSelected,
  onSelectNode,
  onRunPromptNode,
  onUpdateNodeLocal,
  onUpdateNode,
  selected,
  selectedId,
  snapToGrid,
  zoom,
}: {
  document: DesignDocumentResult["document"];
  node: RoderDesignNode;
  onDeleteSelected: () => Promise<void>;
  onDuplicateSelected: () => Promise<void>;
  onFitSelected: () => void;
  onSelectNode: (id: string) => void;
  onRunPromptNode: (node: RoderDesignNode) => Promise<void>;
  onUpdateNodeLocal: (nodeId: string, patch: Partial<RoderDesignNode>) => void;
  onUpdateNode: (nodeId: string, patch: Partial<RoderDesignNode>) => Promise<void>;
  selected: boolean;
  selectedId: string | null;
  snapToGrid: boolean;
  zoom: number;
}): React.JSX.Element {
  const visible = node.visible !== false;
  const locked = node.locked === true;
  const opacity = nodeOpacity(node);
  const fill =
    colorValue(node.fill) ??
    (node.type === "text" || node.type === "line" || node.type === "path" ? "transparent" : "#ffffff");
  const stroke = colorValue(node.stroke) ?? (node.type === "text" ? "transparent" : "#d4d4d8");
  const cornerRadius = nodeCornerRadius(node);
  const [interaction, setInteraction] = useState<NodeInteraction | null>(null);
  const rect = interaction?.draft ?? nodeRect(node);
  const measurements = selected ? nodeMeasurements(document, node, rect) : null;
  const childNodes = (node.childIds ?? [])
    .map((id) => document.nodes[id])
    .filter((child): child is RoderDesignNode => Boolean(child));

  function beginInteraction(event: React.PointerEvent<HTMLDivElement>, kind: NodeInteraction["kind"]): void {
    if (locked) {
      event.stopPropagation();
      onSelectNode(node.id);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onSelectNode(node.id);
    event.currentTarget.setPointerCapture(event.pointerId);
    const original = nodeRect(node);
    setInteraction({
      kind,
      startClientX: event.clientX,
      startClientY: event.clientY,
      original,
      draft: original,
    });
  }

  function continueInteraction(event: React.PointerEvent<HTMLDivElement>): void {
    if (!interaction) {
      return;
    }
    const dx = (event.clientX - interaction.startClientX) / zoom;
    const dy = (event.clientY - interaction.startClientY) / zoom;
    const draft =
      interaction.kind === "move"
        ? snapRect(
            { ...interaction.original, x: interaction.original.x + dx, y: interaction.original.y + dy },
            snapToGrid,
          )
        : {
            ...interaction.original,
            width: Math.max(24, snapValue(interaction.original.width + dx, snapToGrid)),
            height: Math.max(24, snapValue(interaction.original.height + dy, snapToGrid)),
          };
    setInteraction({ ...interaction, draft });
  }

  function endInteraction(event: React.PointerEvent<HTMLDivElement>): void {
    if (!interaction) {
      return;
    }
    event.stopPropagation();
    const draft = interaction.draft;
    setInteraction(null);
    void onUpdateNode(node.id, {
      x: Math.round(draft.x),
      y: Math.round(draft.y),
      width: Math.round(draft.width),
      height: Math.round(draft.height),
    });
  }

  if (!visible) {
    return <></>;
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Select ${node.name}`}
      className={cn(
        "absolute flex flex-col overflow-visible rounded-lg border text-left shadow-sm ring-1",
        selected ? "ring-2 ring-ring" : "ring-border/70",
        locked && "cursor-default opacity-80",
        (node.type === "line" || node.type === "path" || node.type === "icon") &&
          "border-transparent shadow-none ring-transparent",
        node.type === "text" && "items-start justify-start rounded-md border-transparent p-2 shadow-none",
        node.type === "prompt" &&
          "overflow-hidden border-amber-300 bg-amber-50 text-amber-950 shadow-md ring-amber-300/70",
        node.type === "component" && "ring-blue-400/80",
        node.type === "instance" && "ring-violet-400/80",
      )}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        backgroundColor: fill,
        borderColor: stroke,
        borderRadius: node.type === "ellipse" ? "9999px" : cornerRadius,
        opacity,
        transform: nodeRotation(node) ? `rotate(${nodeRotation(node)}deg)` : undefined,
        transformOrigin: "center",
      }}
      onClick={(event) => {
        event.stopPropagation();
        onSelectNode(node.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectNode(node.id);
        }
      }}
      onPointerDown={(event) => beginInteraction(event, "move")}
      onPointerMove={continueInteraction}
      onPointerUp={endInteraction}
      onPointerCancel={() => setInteraction(null)}
    >
      {(node.type === "component" || node.type === "instance") && (
        <div
          className={cn(
            "pointer-events-none absolute left-2 top-2 z-10 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide shadow-sm",
            node.type === "component" ? "bg-blue-500 text-white" : "bg-violet-500 text-white",
          )}
        >
          {componentBadgeLabel(node)}
        </div>
      )}
      {selected && (
        <div className="absolute -top-10 left-0 z-20 flex items-center gap-1 rounded-xl border border-border/80 bg-background/95 p-1 text-xs shadow-xl shadow-black/10 backdrop-blur">
          <StageActionButton label="Fit selected" onClick={onFitSelected}>
            Fit
          </StageActionButton>
          <StageActionButton label="Duplicate selected" onClick={onDuplicateSelected}>
            <Copy className="size-3.5" />
          </StageActionButton>
          <StageActionButton
            label={locked ? "Unlock selected" : "Lock selected"}
            onClick={() => onUpdateNode(node.id, { locked: !locked })}
          >
            {locked ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />}
          </StageActionButton>
          <StageActionButton label="Delete selected" destructive onClick={onDeleteSelected}>
            <Trash2 className="size-3.5" />
          </StageActionButton>
        </div>
      )}
      {measurements && (
        <div className="pointer-events-none absolute -bottom-7 left-0 z-20 rounded-md border border-border/80 bg-zinc-950 px-2 py-1 text-[11px] font-semibold tabular-nums text-white shadow-lg">
          {measurements.sizeLabel}
          {measurements.spacingLabel ? <span className="ml-2 text-zinc-300">{measurements.spacingLabel}</span> : null}
        </div>
      )}
      {node.type === "text" ? (
        <div
          className="min-h-full w-full cursor-text text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
          role="textbox"
          tabIndex={0}
          contentEditable
          suppressContentEditableWarning
          style={{
            color: fill,
            fontSize: textFontSize(node),
            fontWeight: textFontWeight(node),
            textAlign: textAlign(node),
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
            onSelectNode(node.id);
          }}
          onBlur={(event) => {
            const content = event.currentTarget.textContent ?? "";
            onUpdateNodeLocal(node.id, { content });
            void onUpdateNode(node.id, { content });
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        >
          {String(node.content ?? node.name)}
        </div>
      ) : node.type === "prompt" ? (
        <div className="flex size-full flex-col text-amber-950">
          <div className="flex h-8 items-center gap-2 border-b border-amber-300/70 bg-amber-100/80 px-2 text-sm font-semibold">
            <MessageSquare className="size-3.5" />
            <span className="pointer-events-none min-w-0 flex-1 truncate">Prompt</span>
            <button
              type="button"
              className="rounded-md border border-amber-300 bg-white/70 px-2 py-0.5 text-xs font-semibold text-amber-950 shadow-sm hover:bg-white"
              onClick={(event) => {
                event.stopPropagation();
                void onRunPromptNode(node);
              }}
            >
              Run
            </button>
          </div>
          <div
            className="min-h-0 flex-1 cursor-text overflow-auto p-2 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40"
            role="textbox"
            tabIndex={0}
            contentEditable
            suppressContentEditableWarning
            onPointerDown={(event) => {
              event.stopPropagation();
              onSelectNode(node.id);
            }}
            onBlur={(event) => {
              const prompt = event.currentTarget.textContent ?? "";
              onUpdateNodeLocal(node.id, { prompt });
              void onUpdateNode(node.id, { prompt });
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
                void onRunPromptNode(node);
              }
            }}
          >
            {String(node.prompt ?? node.content ?? "Describe the design change for Roder...")}
          </div>
        </div>
      ) : node.type === "line" ? (
        <svg className="pointer-events-none size-full overflow-visible" aria-hidden>
          <line
            x1="0"
            y1="0"
            x2={Math.max(1, rect.width)}
            y2={Math.max(1, rect.height)}
            stroke={stroke}
            strokeWidth={strokeWidth(node.stroke)}
            strokeLinecap="round"
          />
        </svg>
      ) : node.type === "path" ? (
        <svg className="pointer-events-none size-full overflow-visible" viewBox={pathViewBox(node, rect)} aria-hidden>
          <path
            d={pathData(node, rect)}
            fill={fill === "transparent" ? "none" : fill}
            stroke={stroke}
            strokeWidth={strokeWidth(node.stroke)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : node.type === "icon" ? (
        <div className="pointer-events-none grid size-full place-items-center text-foreground">
          {typeof node.svg === "string" && node.svg.trim() ? (
            <svg className="size-full" viewBox={iconViewBox(node)} aria-label={node.name}>
              <path d={node.svg} fill={fill === "transparent" ? "currentColor" : fill} />
            </svg>
          ) : (
            <PenTool className="size-1/2" />
          )}
        </div>
      ) : node.type === "image" ? (
        <div className="pointer-events-none grid size-full place-items-center overflow-hidden rounded-lg bg-muted/40 text-sm text-muted-foreground">
          {typeof node.src === "string" && node.src ? (
            <img src={node.src} alt={node.name} className="size-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-2">
              <ImageIcon className="size-8" />
              <span>{node.name}</span>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="pointer-events-none flex h-8 items-center gap-2 border-b border-border/70 bg-muted/30 px-2 text-sm font-medium text-muted-foreground">
            {node.type === "ellipse" ? (
              <Circle className="size-3.5" />
            ) : node.type === "prompt" ? (
              <MessageSquare className="size-3.5" />
            ) : node.type === "line" ? (
              <Slash className="size-3.5" />
            ) : node.type === "path" || node.type === "icon" ? (
              <PenTool className="size-3.5" />
            ) : (
              <Frame className="size-3.5" />
            )}
            <span className="truncate">{node.name}</span>
          </div>
          <div className="pointer-events-none grid flex-1 place-items-center text-sm font-normal text-muted-foreground">
            {node.type}
          </div>
        </>
      )}
      {childNodes.map((child) => (
        <DesignNodePreview
          document={document}
          key={child.id}
          node={child}
          onDeleteSelected={onDeleteSelected}
          onDuplicateSelected={onDuplicateSelected}
          onFitSelected={onFitSelected}
          onUpdateNodeLocal={onUpdateNodeLocal}
          onUpdateNode={onUpdateNode}
          onRunPromptNode={onRunPromptNode}
          selected={selectedId === child.id}
          selectedId={selectedId}
          snapToGrid={snapToGrid}
          zoom={zoom}
          onSelectNode={onSelectNode}
        />
      ))}
      {selected && locked && (
        <div className="pointer-events-none absolute right-1 top-1 rounded bg-background/90 p-1 text-muted-foreground shadow-sm ring-1 ring-border">
          <Lock className="size-3.5" />
        </div>
      )}
      {selected && !locked && (
        <div
          className="absolute -bottom-1.5 -right-1.5 size-3 cursor-se-resize rounded-sm bg-ring ring-2 ring-white"
          role="button"
          tabIndex={0}
          aria-label={`Resize ${node.name}`}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
            }
          }}
          onPointerDown={(event) => beginInteraction(event, "resize")}
        />
      )}
    </div>
  );
}

function StageActionButton({
  children,
  destructive,
  label,
  onClick,
}: {
  children: React.ReactNode;
  destructive?: boolean;
  label: string;
  onClick: () => Promise<void> | void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        "grid min-h-7 min-w-7 place-items-center rounded-lg px-2 font-semibold text-muted-foreground hover:bg-accent hover:text-foreground",
        destructive && "hover:bg-destructive/10 hover:text-destructive",
      )}
      aria-label={label}
      title={label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        void onClick();
      }}
    >
      {children}
    </button>
  );
}

function CreationPreview({ kind, rect }: { kind: InsertKind; rect: NodeDraft }): React.JSX.Element {
  if (kind === "line") {
    return (
      <svg
        className="pointer-events-none absolute overflow-visible"
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        aria-hidden
      >
        <line
          x1="0"
          y1="0"
          x2={Math.max(1, rect.width)}
          y2={Math.max(1, rect.height)}
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="6 4"
          className="text-ring"
        />
      </svg>
    );
  }
  return (
    <div
      className={cn(
        "pointer-events-none absolute border-2 border-dashed border-ring bg-ring/10",
        kind === "ellipse" && "rounded-full",
        kind !== "ellipse" && "rounded-lg",
      )}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    />
  );
}

function DesignDiagnosticsPanel({
  diagnostics,
  onSelectNode,
  onRefresh,
  selectedId,
}: {
  diagnostics: DesignLayoutDiagnostics;
  selectedId: string | null;
  onSelectNode: (id: string) => void;
  onRefresh: () => Promise<void>;
}): React.JSX.Element {
  if (!diagnostics.available) {
    return (
      <section className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-sm text-muted-foreground">
        Layout diagnostics are unavailable until the bundled app-server exposes design/snapshot_layout.
      </section>
    );
  }

  const problemNodes = diagnostics.nodes.filter((node) => node.problems.length > 0);

  return (
    <section className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-foreground">Layout diagnostics</div>
          <div className="text-sm text-muted-foreground">
            {diagnostics.problemCount === 0
              ? `${diagnostics.nodes.length} node${diagnostics.nodes.length === 1 ? "" : "s"} checked`
              : `${diagnostics.problemCount} issue${diagnostics.problemCount === 1 ? "" : "s"} across ${problemNodes.length} node${problemNodes.length === 1 ? "" : "s"}`}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground hover:bg-background hover:text-foreground"
            onClick={() => void onRefresh()}
          >
            Refresh
          </button>
          <div
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-semibold",
              diagnostics.problemCount === 0 ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700",
            )}
          >
            {diagnostics.problemCount === 0 ? "OK" : "Review"}
          </div>
        </div>
      </div>
      {problemNodes.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {problemNodes.slice(0, 8).map((node) => (
            <button
              key={node.id}
              type="button"
              className={cn(
                "rounded-md border border-border bg-background px-2 py-1.5 text-left text-sm hover:bg-accent/60",
                selectedId === node.id && "border-ring bg-accent text-accent-foreground",
              )}
              onClick={() => onSelectNode(node.id)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium">{node.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{node.type}</span>
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                {node.problems.slice(0, 3).map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </button>
          ))}
          {problemNodes.length > 8 && (
            <div className="text-xs text-muted-foreground">+{problemNodes.length - 8} more node(s) with issues</div>
          )}
        </div>
      )}
    </section>
  );
}

function DesignAgentActivityOverlay({
  activities,
  nodes,
}: {
  activities: DesignAgentActivity[];
  nodes: Record<string, RoderDesignNode>;
}): React.JSX.Element | null {
  const runningActivities = activities.filter((activity) => activity.status === "running").slice(-3);
  if (runningActivities.length === 0) {
    return null;
  }
  return (
    <div className="pointer-events-none absolute right-4 top-4 z-30 flex max-w-64 flex-col gap-2">
      {runningActivities.map((activity) => {
        const node = nodes[activity.nodeId];
        return (
          <div
            key={activity.id}
            className="rounded-2xl border border-violet-300/70 bg-white/95 px-3 py-2 text-sm text-violet-950 shadow-xl shadow-violet-950/10"
          >
            <div className="flex items-center gap-2 font-semibold">
              <span className="size-2 rounded-full bg-violet-500 motion-safe:animate-pulse" />
              Roder working
            </div>
            <div className="mt-1 truncate text-xs text-violet-800/80">{node?.name ?? activity.nodeName}</div>
          </div>
        );
      })}
    </div>
  );
}

function DesignAgentActivityPanel({
  activities,
  onClear,
  onSelectNode,
  selectedId,
}: {
  activities: DesignAgentActivity[];
  selectedId: string | null;
  onClear: () => void;
  onSelectNode: (id: string) => void;
}): React.JSX.Element {
  const recentActivities = activities.slice(-6).reverse();
  const lanes = agentActivityLanes(activities);
  return (
    <section className="flex flex-col gap-2 rounded-lg bg-muted/30 p-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <div>
          <div className="text-sm font-semibold text-muted-foreground">Agent activity</div>
          <div className="text-xs text-muted-foreground/80">
            Scoped lanes for prompt, review, and container agent work.
          </div>
        </div>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-40"
          disabled={activities.length === 0}
          onClick={onClear}
        >
          Clear
        </button>
      </div>
      {recentActivities.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-2 py-2 text-xs text-muted-foreground">
          Run a prompt node, request a design review, or spawn a scoped agent to see lanes here.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {lanes.map((lane) => (
            <div key={lane.scopeId} className="rounded-lg border border-border bg-background p-2">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className={cn(
                    "min-w-0 truncate text-left text-sm font-semibold hover:text-foreground",
                    selectedId === lane.scopeId ? "text-foreground" : "text-muted-foreground",
                  )}
                  onClick={() => onSelectNode(lane.scopeId)}
                >
                  {lane.scopeName}
                </button>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    lane.running > 0 ? "bg-violet-500/10 text-violet-700" : "bg-muted text-muted-foreground",
                  )}
                >
                  {lane.running > 0
                    ? `${lane.running} running`
                    : `${lane.activities.length} task${lane.activities.length === 1 ? "" : "s"}`}
                </span>
              </div>
              <div className="mt-2 flex flex-col gap-1">
                {lane.activities.slice(0, 3).map((activity) => (
                  <button
                    key={activity.id}
                    type="button"
                    className={cn(
                      "rounded-md px-2 py-1 text-left text-xs hover:bg-accent/60",
                      selectedId === activity.nodeId && "bg-accent text-accent-foreground",
                    )}
                    onClick={() => onSelectNode(activity.nodeId)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">
                        {agentActivityKindLabel(activity.kind)} · {activity.nodeName}
                      </span>
                      <span className={agentActivityStatusClass(activity.status)}>{activity.status}</span>
                    </div>
                    <div className="mt-0.5 line-clamp-1 text-muted-foreground">{activity.message}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DesignAgentPermissionsPanel({
  onChange,
  onSendExternalAgentManifest,
  permissions,
}: {
  permissions: DesignAgentPermissions;
  onChange: (permissions: DesignAgentPermissions) => void;
  onSendExternalAgentManifest: () => Promise<void>;
}): React.JSX.Element {
  function update(patch: Partial<DesignAgentPermissions>): void {
    onChange({ ...permissions, ...patch, preset: patch.preset ?? "custom" });
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg bg-muted/30 p-2">
      <div className="px-1">
        <div className="text-sm font-semibold text-muted-foreground">Agent safety</div>
        <div className="text-xs text-muted-foreground/80">
          Controls included in prompt, scoped-agent, and review handoffs.
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {AGENT_PERMISSION_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={cn(
              "rounded-md border px-2 py-1 text-xs font-medium transition",
              permissions.preset === preset.id
                ? "border-ring bg-accent text-accent-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
            onClick={() => onChange({ ...preset.permissions, preset: preset.id })}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="grid gap-2">
        <InspectorToggle
          active={permissions.allowPatch}
          label="Allow design patches"
          onCommit={(allowPatch) => {
            update({ allowPatch });
            return Promise.resolve();
          }}
        />
        <InspectorToggle
          active={permissions.allowExport}
          label="Allow SVG export"
          onCommit={(allowExport) => {
            update({ allowExport });
            return Promise.resolve();
          }}
        />
        <InspectorToggle
          active={permissions.requireReview}
          label="Require review before changes"
          onCommit={(requireReview) => {
            update({ requireReview });
            return Promise.resolve();
          }}
        />
      </div>
      <div className="rounded-md bg-background/70 px-2 py-1 text-xs text-muted-foreground">
        {agentPermissionSummary(permissions)}
      </div>
      <Button type="button" size="sm" variant="secondary" onClick={() => void onSendExternalAgentManifest()}>
        Send external-agent manifest
      </Button>
    </section>
  );
}

function DesignScopedAgentPlanPanel({
  items,
  onAddSelected,
  onClear,
  onRemove,
  onSelectNode,
  onSend,
  permissions,
  selectedNode,
}: {
  items: DesignAgentLaunchPlanItem[];
  permissions: DesignAgentPermissions;
  selectedNode: RoderDesignNode | null;
  onAddSelected: () => void;
  onClear: () => void;
  onRemove: (itemId: string) => void;
  onSelectNode: (id: string) => void;
  onSend: () => Promise<void>;
}): React.JSX.Element {
  const canAddSelected = Boolean(selectedNode && canContainChildren(selectedNode));
  return (
    <section className="flex flex-col gap-2 rounded-lg bg-muted/30 p-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <div>
          <div className="text-sm font-semibold text-muted-foreground">Scoped agent plan</div>
          <div className="text-xs text-muted-foreground/80">
            Queue containers, then send a multi-scope agent handoff.
          </div>
        </div>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-40"
          disabled={items.length === 0}
          onClick={onClear}
        >
          Clear
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" size="sm" variant="outline" disabled={!canAddSelected} onClick={onAddSelected}>
          Add selected
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={items.length === 0} onClick={() => void onSend()}>
          Send {items.length || "plan"}
        </Button>
      </div>
      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-2 py-2 text-xs text-muted-foreground">
          Select a frame, group, component, or instance, then add it as a scoped agent lane.
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {items.map((item) => (
            <div
              key={item.id}
              className="grid grid-cols-[1fr_auto] items-center gap-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              <button
                type="button"
                className="min-w-0 text-left hover:text-foreground"
                onClick={() => onSelectNode(item.nodeId)}
              >
                <div className="truncate font-medium">{item.nodeName}</div>
                <div className="truncate text-xs text-muted-foreground">Scope · {item.scopeName}</div>
              </button>
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => onRemove(item.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="rounded-md bg-background/70 px-2 py-1 text-xs text-muted-foreground">
        {agentPermissionSummary(permissions)}
      </div>
    </section>
  );
}

function DesignExportActionsPanel({
  canExport,
  onAttachRootFrames,
  onAttachSelected,
  onFitSelected,
  onFitViewport,
  onReviewSelected,
  rootFrameCount,
  selectedNode,
}: {
  canExport: boolean;
  rootFrameCount: number;
  selectedNode: RoderDesignNode | null;
  onAttachRootFrames: () => Promise<void>;
  onAttachSelected: () => Promise<void>;
  onFitSelected: () => void;
  onFitViewport: () => void;
  onReviewSelected: () => Promise<void>;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2 rounded-lg bg-muted/30 p-2">
      <div className="px-1 text-sm font-semibold text-muted-foreground">Navigate, export & attach</div>
      <div className="px-1 text-xs text-muted-foreground/80">
        Fit the canvas quickly, then send SVG exports into the active composer for review or agent iteration.
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onFitViewport}>
          Fit canvas
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={!selectedNode} onClick={onFitSelected}>
          Fit selected
        </Button>
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={!canExport || !selectedNode}
        onClick={() => void onAttachSelected()}
      >
        Attach selected
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={!canExport || !selectedNode}
        onClick={() => void onReviewSelected()}
      >
        Review with SVG context
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={!canExport || rootFrameCount === 0}
        onClick={() => void onAttachRootFrames()}
      >
        Attach {rootFrameCount} root frame{rootFrameCount === 1 ? "" : "s"}
      </Button>
    </section>
  );
}

function DesignSelectionBreadcrumbs({
  nodes,
  onSelectNode,
  selectedNode,
}: {
  nodes: Record<string, RoderDesignNode>;
  selectedNode: RoderDesignNode;
  onSelectNode: (id: string) => void;
}): React.JSX.Element {
  const ancestry = nodeAncestry(nodes, selectedNode);
  return (
    <section className="flex flex-col gap-2 rounded-lg bg-muted/30 p-2">
      <div className="px-1 text-sm font-semibold text-muted-foreground">Selection path</div>
      <div className="flex flex-wrap items-center gap-1 text-sm">
        {ancestry.length === 0 ? (
          <span className="rounded-md bg-background px-2 py-1 text-muted-foreground ring-1 ring-border">
            Canvas root
          </span>
        ) : (
          <>
            <span className="rounded-md bg-background px-2 py-1 text-muted-foreground ring-1 ring-border">Canvas</span>
            {ancestry.map((node, index) => (
              <div key={node.id} className="flex items-center gap-1">
                <span className="text-muted-foreground/60">/</span>
                <button
                  type="button"
                  className={cn(
                    "max-w-36 truncate rounded-md px-2 py-1 text-left ring-1 ring-border hover:bg-accent/60 hover:text-foreground",
                    node.id === selectedNode.id
                      ? "bg-accent text-accent-foreground"
                      : "bg-background text-muted-foreground",
                  )}
                  title={`${node.name} (${node.type})`}
                  onClick={() => onSelectNode(node.id)}
                >
                  {breadcrumbNodeLabel(node, index === ancestry.length - 1)}
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  );
}

function DesignHistoryPanel({
  onClear,
  onRestore,
  snapshots,
}: {
  snapshots: DesignUndoSnapshot[];
  onClear: () => void;
  onRestore: (index: number) => Promise<void>;
}): React.JSX.Element {
  const recentSnapshots = snapshots
    .map((snapshot, index) => ({ index, snapshot }))
    .slice(-6)
    .reverse();
  return (
    <section className="flex flex-col gap-2 rounded-lg bg-muted/30 p-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <div>
          <div className="text-sm font-semibold text-muted-foreground">History</div>
          <div className="text-xs text-muted-foreground/80">Restore recent design mutations.</div>
        </div>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-40"
          disabled={snapshots.length === 0}
          onClick={onClear}
        >
          Clear
        </button>
      </div>
      {recentSnapshots.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-2 py-2 text-xs text-muted-foreground">
          No undo history yet. Changes made through the canvas will appear here.
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {recentSnapshots.map(({ index, snapshot }, offset) => (
            <button
              key={`${index}:${snapshot.label}`}
              type="button"
              className="rounded-md border border-border bg-background px-2 py-1.5 text-left text-sm hover:bg-accent/60"
              onClick={() => void onRestore(index)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{snapshot.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {offset === 0 ? "Undo" : `-${offset + 1}`}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1 text-[10px] font-semibold uppercase tracking-wide">
                {snapshot.summary.inserted > 0 && (
                  <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700">
                    +{snapshot.summary.inserted}
                  </span>
                )}
                {snapshot.summary.updated > 0 && (
                  <span className="rounded-full bg-sky-500/10 px-1.5 py-0.5 text-sky-700">
                    ~{snapshot.summary.updated}
                  </span>
                )}
                {snapshot.summary.deleted > 0 && (
                  <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-destructive">
                    -{snapshot.summary.deleted}
                  </span>
                )}
                {snapshot.summary.variablesChanged && (
                  <span className="rounded-full bg-violet-500/10 px-1.5 py-0.5 text-violet-700">tokens</span>
                )}
              </div>
              {snapshot.summary.details.length > 0 && (
                <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {snapshot.summary.details.slice(0, 3).join(" · ")}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function DesignInspector({
  agentActivities,
  agentLaunchPlan,
  agentPermissions,
  designLibraries,
  libraryScanStatus,
  undoStack,
  onClearUndoHistory,
  onClearScopedAgentPlan,
  onClearAgentActivities,
  onAgentPermissionsChange,
  onDetachInstance,
  onAttachRootFrames,
  onAttachSelected,
  onArrangeChildren,
  onChildLayerMode,
  onGroupSelected,
  onLayerOrder,
  onInsertInstance,
  onInsertInstanceFromComponent,
  onInsertLibraryNode,
  onImportLibraryTokens,
  onInsertTemplate,
  onFitSelected,
  onFitViewport,
  onReviewSelected,
  onMakeComponent,
  onRefreshLayoutDiagnostics,
  onRemoveQueuedScopedAgent,
  onRestoreUndoSnapshot,
  onScanDesignLibraries,
  onScanWorkspaceTheme,
  onSendExternalAgentManifest,
  onSendScopedAgentPlan,
  onSpawnScopedAgent,
  onQueueScopedAgent,
  onUpdateNode,
  onSelectNode,
  onRunPromptNode,
  onUpdateVariables,
  onUpdateSelectedNode,
  onUngroupSelected,
  selectedNode,
  state,
}: {
  state: DesignCanvasState;
  selectedNode: RoderDesignNode | null;
  agentActivities: DesignAgentActivity[];
  agentLaunchPlan: DesignAgentLaunchPlanItem[];
  agentPermissions: DesignAgentPermissions;
  designLibraries: DesignLibraryEntry[];
  libraryScanStatus: string | null;
  undoStack: DesignUndoSnapshot[];
  onAgentPermissionsChange: (permissions: DesignAgentPermissions) => void;
  onClearAgentActivities: () => void;
  onClearScopedAgentPlan: () => void;
  onClearUndoHistory: () => void;
  onDetachInstance: () => Promise<void>;
  onAttachRootFrames: () => Promise<void>;
  onAttachSelected: () => Promise<void>;
  onArrangeChildren: (mode: ChildArrangeMode) => Promise<void>;
  onChildLayerMode: (mode: ChildLayerMode) => Promise<void>;
  onGroupSelected: () => Promise<void>;
  onLayerOrder: (mode: LayerOrderMode) => Promise<void>;
  onInsertInstance: () => Promise<void>;
  onInsertInstanceFromComponent: (componentNodeId: string) => Promise<void>;
  onInsertLibraryNode: (libraryId: string, nodeId: string) => Promise<void>;
  onImportLibraryTokens: (libraryId: string) => Promise<void>;
  onInsertTemplate: (templateId: DesignTemplateId) => Promise<void>;
  onFitSelected: () => void;
  onFitViewport: () => void;
  onReviewSelected: () => Promise<void>;
  onMakeComponent: () => Promise<void>;
  onRefreshLayoutDiagnostics: () => Promise<void>;
  onRemoveQueuedScopedAgent: (itemId: string) => void;
  onRestoreUndoSnapshot: (index: number) => Promise<void>;
  onScanDesignLibraries: () => Promise<void>;
  onScanWorkspaceTheme: () => Promise<void>;
  onSendExternalAgentManifest: () => Promise<void>;
  onSendScopedAgentPlan: () => Promise<void>;
  onSpawnScopedAgent: () => Promise<void>;
  onQueueScopedAgent: () => void;
  onSelectNode: (id: string) => void;
  onUpdateNode: (nodeId: string, patch: Partial<RoderDesignNode>) => Promise<void>;
  onRunPromptNode: (node: RoderDesignNode) => Promise<void>;
  onUpdateVariables: (variables: Record<string, unknown>) => Promise<void>;
  onUpdateSelectedNode: (patch: Partial<RoderDesignNode>) => Promise<void>;
  onUngroupSelected: () => Promise<void>;
}): React.JSX.Element {
  if (state.status !== "ready") {
    return <aside className="min-h-0 border-l border-border bg-background" />;
  }
  return (
    <aside className="flex min-h-0 flex-col gap-3 overflow-auto border-l border-border bg-background p-3">
      <div>
        <div className="text-base font-semibold">Inspector</div>
        <div className="text-sm font-normal text-muted-foreground">
          {state.layoutDiagnostics.available
            ? state.layoutDiagnostics.problemCount === 0
              ? "Layout ok"
              : `${state.layoutDiagnostics.problemCount} layout issue(s)`
            : "Layout checks unavailable"}
        </div>
      </div>
      <DesignDiagnosticsPanel
        diagnostics={state.layoutDiagnostics}
        selectedId={state.selectedId}
        onRefresh={onRefreshLayoutDiagnostics}
        onSelectNode={onSelectNode}
      />
      <DesignAgentActivityPanel
        activities={agentActivities}
        selectedId={state.selectedId}
        onClear={onClearAgentActivities}
        onSelectNode={onSelectNode}
      />
      <DesignScopedAgentPlanPanel
        items={agentLaunchPlan}
        permissions={agentPermissions}
        selectedNode={selectedNode}
        onAddSelected={onQueueScopedAgent}
        onClear={onClearScopedAgentPlan}
        onRemove={onRemoveQueuedScopedAgent}
        onSelectNode={onSelectNode}
        onSend={onSendScopedAgentPlan}
      />
      <DesignAgentPermissionsPanel
        permissions={agentPermissions}
        onChange={onAgentPermissionsChange}
        onSendExternalAgentManifest={onSendExternalAgentManifest}
      />
      <DesignExportActionsPanel
        canExport={state.status === "ready"}
        rootFrameCount={exportableRootFrames(state.result.document).length}
        selectedNode={selectedNode}
        onAttachRootFrames={onAttachRootFrames}
        onAttachSelected={onAttachSelected}
        onFitSelected={onFitSelected}
        onFitViewport={onFitViewport}
        onReviewSelected={onReviewSelected}
      />
      <DesignHistoryPanel snapshots={undoStack} onClear={onClearUndoHistory} onRestore={onRestoreUndoSnapshot} />
      <DesignLayers
        nodes={state.result.document.nodes}
        rootIds={state.result.document.rootIds}
        selectedId={state.selectedId}
        onSelectNode={onSelectNode}
        onUpdateNode={onUpdateNode}
      />
      <DesignVariablesPanel
        selectedNode={selectedNode}
        variables={state.result.document.variables}
        onApplyToSelected={(patch) => onUpdateSelectedNode(patch)}
        onScanWorkspaceTheme={onScanWorkspaceTheme}
        onUpdateVariables={onUpdateVariables}
      />
      <ComponentLibraryPanel
        nodes={state.result.document.nodes}
        selectedId={state.selectedId}
        onInsertInstance={onInsertInstanceFromComponent}
        onSelectNode={onSelectNode}
      />
      <WorkspaceDesignLibraryPanel
        libraries={designLibraries}
        scanStatus={libraryScanStatus}
        onInsertLibraryNode={onInsertLibraryNode}
        onImportLibraryTokens={onImportLibraryTokens}
        onScanLibraries={onScanDesignLibraries}
      />
      <TemplateLibraryPanel onInsertTemplate={onInsertTemplate} />
      {!selectedNode ? (
        <div className="rounded-lg bg-muted/30 p-3 text-base font-normal text-muted-foreground">
          Select a design node.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <DesignSelectionBreadcrumbs
            nodes={state.result.document.nodes}
            selectedNode={selectedNode}
            onSelectNode={onSelectNode}
          />
          <InspectorInput
            key={`${selectedNode.id}:name`}
            label="Name"
            value={selectedNode.name}
            onCommit={(name) => onUpdateSelectedNode({ name })}
          />
          <div className="grid grid-cols-2 gap-2">
            <InspectorToggle
              active={selectedNode.visible !== false}
              label="Visible"
              onCommit={(visible) => onUpdateSelectedNode({ visible })}
            />
            <InspectorToggle
              active={selectedNode.locked === true}
              label="Locked"
              onCommit={(locked) => onUpdateSelectedNode({ locked })}
            />
          </div>
          {importedSourceLabel(selectedNode) && (
            <div className="rounded-md bg-amber-50 px-2 py-1 text-sm text-amber-800 ring-1 ring-amber-200">
              Imported from {importedSourceLabel(selectedNode)} · unsupported Pencil data preserved in node source
            </div>
          )}
          {templateSourceLabel(selectedNode) && (
            <div className="rounded-md bg-violet-50 px-2 py-1 text-sm text-violet-700 ring-1 ring-violet-200">
              Template: {templateSourceLabel(selectedNode)} · customize or convert to a reusable component
            </div>
          )}
          {canContainChildren(selectedNode) && (
            <section className="flex flex-col gap-2 rounded-lg bg-muted/30 p-2">
              <div className="px-1 text-sm font-semibold text-muted-foreground">Scoped agent</div>
              <div className="px-1 text-xs text-muted-foreground/80">
                Ask Roder to work only inside this container, using its child tree and active design context.
              </div>
              <Button type="button" size="sm" onClick={() => void onSpawnScopedAgent()}>
                Send scoped agent task
              </Button>
            </section>
          )}
          {(canGroupNode(state.result.document, selectedNode) ||
            canUngroupNode(state.result.document, selectedNode)) && (
            <section className="flex flex-col gap-2 rounded-lg bg-muted/30 p-2">
              <div className="px-1 text-sm font-semibold text-muted-foreground">Grouping</div>
              <div className="px-1 text-xs text-muted-foreground/80">
                Wrap child artwork in editable groups or release grouped children back to their parent.
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={!canGroupNode(state.result.document, selectedNode)}
                  onClick={() => void onGroupSelected()}
                >
                  Group
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={!canUngroupNode(state.result.document, selectedNode)}
                  onClick={() => void onUngroupSelected()}
                >
                  Ungroup
                </Button>
              </div>
            </section>
          )}
          {canReorderLayer(state.result.document, selectedNode) && (
            <section className="flex flex-col gap-2 rounded-lg bg-muted/30 p-2">
              <div className="px-1 text-sm font-semibold text-muted-foreground">Layer order</div>
              <div className="px-1 text-xs text-muted-foreground/80">
                Move this layer among its siblings without changing its parent container.
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["front", "Front"],
                    ["forward", "Forward"],
                    ["backward", "Backward"],
                    ["back", "Back"],
                  ] as const
                ).map(([mode, label]) => (
                  <Button
                    key={mode}
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!layerOrderOperation(state.result.document, selectedNode, mode)}
                    onClick={() => void onLayerOrder(mode)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </section>
          )}
          {canArrangeChildren(state.result.document, selectedNode, "left") && (
            <section className="flex flex-col gap-2 rounded-lg bg-muted/30 p-2">
              <div className="px-1 text-sm font-semibold text-muted-foreground">Arrange children</div>
              <div className="px-1 text-xs text-muted-foreground/80">
                Align or distribute direct children inside this container without changing their hierarchy.
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["left", "Left"],
                    ["center", "Center"],
                    ["right", "Right"],
                    ["top", "Top"],
                    ["middle", "Middle"],
                    ["bottom", "Bottom"],
                  ] as const
                ).map(([mode, label]) => (
                  <Button
                    key={mode}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void onArrangeChildren(mode)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={!canArrangeChildren(state.result.document, selectedNode, "space-x")}
                  onClick={() => void onArrangeChildren("space-x")}
                >
                  Space X
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={!canArrangeChildren(state.result.document, selectedNode, "space-y")}
                  onClick={() => void onArrangeChildren("space-y")}
                >
                  Space Y
                </Button>
              </div>
            </section>
          )}
          {canUpdateChildLayers(state.result.document, selectedNode, "hide") && (
            <section className="flex flex-col gap-2 rounded-lg bg-muted/30 p-2">
              <div className="px-1 text-sm font-semibold text-muted-foreground">Child layers</div>
              <div className="px-1 text-xs text-muted-foreground/80">
                Bulk show/hide or lock/unlock direct children while preserving each layer's geometry.
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["show", "Show all"],
                    ["hide", "Hide all"],
                    ["unlock", "Unlock all"],
                    ["lock", "Lock all"],
                  ] as const
                ).map(([mode, label]) => (
                  <Button
                    key={mode}
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!canUpdateChildLayers(state.result.document, selectedNode, mode)}
                    onClick={() => void onChildLayerMode(mode)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </section>
          )}
          {(canMakeComponent(selectedNode) ||
            selectedNode.type === "component" ||
            selectedNode.type === "instance") && (
            <section className="flex flex-col gap-2 rounded-lg bg-muted/30 p-2">
              <div className="px-1 text-sm font-semibold text-muted-foreground">Reusable component</div>
              {selectedNode.type === "component" ? (
                <>
                  <div className="rounded-md bg-background/70 px-2 py-1 text-sm text-muted-foreground">
                    Component source · {componentIdForNode(selectedNode)}
                  </div>
                  <Button type="button" size="sm" onClick={() => void onInsertInstance()}>
                    Create instance
                  </Button>
                </>
              ) : selectedNode.type === "instance" ? (
                <>
                  <div className="rounded-md bg-background/70 px-2 py-1 text-sm text-muted-foreground">
                    Instance of {String(selectedNode.sourceComponentId ?? selectedNode.componentId ?? "component")}
                  </div>
                  {typeof selectedNode.sourceComponentId === "string" &&
                    state.result.document.nodes[selectedNode.sourceComponentId] && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => onSelectNode(String(selectedNode.sourceComponentId))}
                      >
                        Select source component
                      </Button>
                    )}
                  {instanceOverrideFields(selectedNode).length > 0 ? (
                    <div className="rounded-md bg-violet-50 px-2 py-1 text-sm text-violet-700 ring-1 ring-violet-200">
                      Overrides: {instanceOverrideFields(selectedNode).join(", ")}
                    </div>
                  ) : (
                    <div className="rounded-md bg-background/70 px-2 py-1 text-sm text-muted-foreground">
                      No local overrides yet
                    </div>
                  )}
                  <Button type="button" size="sm" onClick={() => void onDetachInstance()}>
                    Detach instance
                  </Button>
                </>
              ) : (
                <Button type="button" size="sm" onClick={() => void onMakeComponent()}>
                  Make component
                </Button>
              )}
            </section>
          )}
          <InspectorNumber
            key={`${selectedNode.id}:opacity`}
            label="Opacity %"
            value={Math.round(nodeOpacity(selectedNode) * 100)}
            onCommit={(opacity) => onUpdateSelectedNode({ opacity: clampOpacity(opacity / 100) })}
          />
          <InspectorNumber
            key={`${selectedNode.id}:rotation`}
            label="Rotation"
            value={nodeRotation(selectedNode)}
            onCommit={(rotation) => onUpdateSelectedNode({ rotation: normalizeRotation(rotation) })}
          />
          {canEditCornerRadius(selectedNode) && (
            <InspectorNumber
              key={`${selectedNode.id}:cornerRadius`}
              label="Corner radius"
              value={nodeCornerRadius(selectedNode)}
              onCommit={(cornerRadius) => onUpdateSelectedNode({ cornerRadius: clampCornerRadius(cornerRadius) })}
            />
          )}
          {selectedNode.type === "text" && (
            <>
              <InspectorInput
                key={`${selectedNode.id}:content`}
                label="Content"
                value={String(selectedNode.content ?? "")}
                onCommit={(content) => onUpdateSelectedNode({ content })}
              />
              <div className="grid grid-cols-2 gap-2">
                <InspectorNumber
                  key={`${selectedNode.id}:fontSize`}
                  label="Font size"
                  value={textFontSize(selectedNode)}
                  onCommit={(fontSize) => onUpdateSelectedNode({ fontSize: clampFontSize(fontSize) })}
                />
                <InspectorNumber
                  key={`${selectedNode.id}:fontWeight`}
                  label="Weight"
                  value={textFontWeight(selectedNode)}
                  onCommit={(fontWeight) => onUpdateSelectedNode({ fontWeight: clampFontWeight(fontWeight) })}
                />
              </div>
              <InspectorSegmented
                label="Align"
                value={textAlign(selectedNode)}
                options={[
                  { label: "Left", value: "left" },
                  { label: "Center", value: "center" },
                  { label: "Right", value: "right" },
                ]}
                onCommit={(align) => onUpdateSelectedNode({ textAlign: align })}
              />
            </>
          )}
          {selectedNode.type === "prompt" && (
            <>
              <InspectorTextarea
                key={`${selectedNode.id}:prompt`}
                label="Prompt"
                value={String(selectedNode.prompt ?? selectedNode.content ?? "")}
                onCommit={(prompt) => onUpdateSelectedNode({ prompt })}
              />
              <Button type="button" size="sm" onClick={() => void onRunPromptNode(selectedNode)}>
                <MessageSquare className="size-4" />
                Send prompt to thread
              </Button>
            </>
          )}
          {selectedNode.type === "image" && (
            <>
              <InspectorInput
                key={`${selectedNode.id}:src`}
                label="Image URL"
                value={String(selectedNode.src ?? "")}
                onCommit={(src) => onUpdateSelectedNode({ src })}
              />
              <ImageUploadInput onCommit={(src) => onUpdateSelectedNode({ src })} />
            </>
          )}
          {selectedNode.type === "path" && (
            <InspectorTextarea
              key={`${selectedNode.id}:pathData`}
              label="SVG path"
              value={String(selectedNode.pathData ?? selectedNode.d ?? "")}
              onCommit={(pathData) => onUpdateSelectedNode({ pathData })}
            />
          )}
          {selectedNode.type === "icon" && (
            <>
              <InspectorTextarea
                key={`${selectedNode.id}:svg`}
                label="Icon path"
                value={String(selectedNode.svg ?? selectedNode.pathData ?? "")}
                onCommit={(svg) => onUpdateSelectedNode({ svg })}
              />
              <InspectorInput
                key={`${selectedNode.id}:viewBox`}
                label="ViewBox"
                value={String(selectedNode.viewBox ?? "0 0 24 24")}
                onCommit={(viewBox) => onUpdateSelectedNode({ viewBox })}
              />
            </>
          )}
          <div className="grid grid-cols-2 gap-2">
            <InspectorColor
              key={`${selectedNode.id}:fill`}
              label={selectedNode.type === "text" ? "Text" : "Fill"}
              value={colorValue(selectedNode.fill) ?? (selectedNode.type === "text" ? "#18181b" : "#ffffff")}
              onCommit={(fill) => onUpdateSelectedNode({ fill: { kind: "color", value: fill } })}
            />
            <InspectorColor
              key={`${selectedNode.id}:stroke`}
              label="Stroke"
              value={colorValue(selectedNode.stroke) ?? "#d4d4d8"}
              onCommit={(stroke) =>
                onUpdateSelectedNode({
                  stroke: { kind: "color", value: stroke, width: strokeWidth(selectedNode.stroke) },
                })
              }
            />
          </div>
          {(selectedNode.type === "line" || selectedNode.type === "path") && (
            <InspectorNumber
              key={`${selectedNode.id}:strokeWidth`}
              label="Stroke width"
              value={strokeWidth(selectedNode.stroke)}
              onCommit={(width) =>
                onUpdateSelectedNode({
                  stroke: {
                    kind: "color",
                    value: colorValue(selectedNode.stroke) ?? "#18181b",
                    width: Math.max(1, width),
                  },
                })
              }
            />
          )}
          <div className="grid grid-cols-2 gap-2">
            <InspectorNumber
              key={`${selectedNode.id}:x`}
              label="X"
              value={Number(selectedNode.x ?? 0)}
              onCommit={(x) => onUpdateSelectedNode({ x })}
            />
            <InspectorNumber
              key={`${selectedNode.id}:y`}
              label="Y"
              value={Number(selectedNode.y ?? 0)}
              onCommit={(y) => onUpdateSelectedNode({ y })}
            />
            <InspectorNumber
              key={`${selectedNode.id}:width`}
              label="W"
              value={Number(selectedNode.width ?? 0)}
              onCommit={(width) => onUpdateSelectedNode({ width })}
            />
            <InspectorNumber
              key={`${selectedNode.id}:height`}
              label="H"
              value={Number(selectedNode.height ?? 0)}
              onCommit={(height) => onUpdateSelectedNode({ height })}
            />
          </div>
        </div>
      )}
    </aside>
  );
}

function ComponentLibraryPanel({
  nodes,
  onInsertInstance,
  onSelectNode,
  selectedId,
}: {
  nodes: Record<string, RoderDesignNode>;
  selectedId: string | null;
  onInsertInstance: (componentNodeId: string) => Promise<void>;
  onSelectNode: (id: string) => void;
}): React.JSX.Element | null {
  const components = Object.values(nodes)
    .filter((node) => node.type === "component")
    .sort((a, b) => a.name.localeCompare(b.name));

  if (components.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg bg-muted/30 p-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="text-sm font-semibold text-muted-foreground">Component library</div>
        <div className="text-xs text-muted-foreground">{components.length}</div>
      </div>
      <div className="flex max-h-44 flex-col gap-1 overflow-auto">
        {components.map((component) => (
          <div
            key={component.id}
            className={cn(
              "flex items-center gap-1 rounded-md bg-background/70 p-1 ring-1 ring-border/60",
              selectedId === component.id && "ring-ring",
            )}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left hover:bg-accent/60"
              onClick={() => onSelectNode(component.id)}
            >
              <Frame className="size-3.5 shrink-0 text-blue-600" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{component.name}</span>
            </button>
            <Button
              type="button"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => void onInsertInstance(component.id)}
            >
              Insert
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function WorkspaceDesignLibraryPanel({
  libraries,
  onInsertLibraryNode,
  onImportLibraryTokens,
  onScanLibraries,
  scanStatus,
}: {
  libraries: DesignLibraryEntry[];
  scanStatus: string | null;
  onInsertLibraryNode: (libraryId: string, nodeId: string) => Promise<void>;
  onImportLibraryTokens: (libraryId: string) => Promise<void>;
  onScanLibraries: () => Promise<void>;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2 rounded-lg bg-muted/30 p-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <div>
          <div className="text-sm font-semibold text-muted-foreground">Workspace libraries</div>
          <div className="text-xs text-muted-foreground">Scan common project-specific .roderdesign library paths.</div>
        </div>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
          onClick={() => void onScanLibraries()}
        >
          Scan
        </button>
      </div>
      {scanStatus && <div className="px-1 text-xs text-muted-foreground">{scanStatus}</div>}
      {libraries.length > 0 && (
        <div className="flex max-h-56 flex-col gap-2 overflow-auto">
          {libraries.map((library) => (
            <div key={library.id} className="rounded-md bg-background/70 p-2 ring-1 ring-border/60">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{library.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {library.nodeCount} node{library.nodeCount === 1 ? "" : "s"} · {library.path}
                  </div>
                </div>
                {Object.keys(library.variables).length > 0 && (
                  <button
                    type="button"
                    className="shrink-0 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-xs font-semibold text-blue-700 hover:bg-blue-500/20"
                    onClick={() => void onImportLibraryTokens(library.id)}
                  >
                    Import {Object.keys(library.variables).length} tokens
                  </button>
                )}
              </div>
              <div className="mt-2 flex flex-col gap-1">
                {library.rootNodes.slice(0, 5).map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    className="flex items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-accent/60"
                    onClick={() => void onInsertLibraryNode(library.id, node.id)}
                  >
                    <Frame className="size-3.5 shrink-0 text-indigo-600" />
                    <span className="min-w-0 flex-1 truncate">{node.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{node.type}</span>
                  </button>
                ))}
                {library.rootNodes.length > 5 && (
                  <div className="px-1 text-xs text-muted-foreground">
                    +{library.rootNodes.length - 5} more root node(s)
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TemplateLibraryPanel({
  onInsertTemplate,
}: {
  onInsertTemplate: (templateId: DesignTemplateId) => Promise<void>;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2 rounded-lg bg-muted/30 p-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="text-sm font-semibold text-muted-foreground">Built-in templates</div>
        <div className="text-xs text-muted-foreground">{DESIGN_TEMPLATES.length}</div>
      </div>
      <div className="grid grid-cols-1 gap-1">
        {DESIGN_TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            className="flex items-center gap-2 rounded-md bg-background/70 p-2 text-left ring-1 ring-border/60 hover:bg-accent/60"
            onClick={() => void onInsertTemplate(template.id)}
          >
            <Frame className="size-4 shrink-0 text-violet-600" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{template.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{template.description}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function InspectorInput({
  label,
  onCommit,
  value,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => Promise<void>;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-muted-foreground">
      {label}
      <input
        value={draft}
        aria-label={label}
        className="h-8 rounded-md border border-input bg-background px-2 text-base font-medium text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={() => void onCommit(draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function InspectorTextarea({
  label,
  onCommit,
  value,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => Promise<void>;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-muted-foreground">
      {label}
      <textarea
        value={draft}
        aria-label={label}
        rows={4}
        className="min-h-24 resize-y rounded-md border border-input bg-background px-2 py-1 text-base font-normal text-foreground outline-none focus:ring-2 focus:ring-ring/20"
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={() => {
          if (draft !== value) {
            void onCommit(draft);
          }
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function ImageUploadInput({ onCommit }: { onCommit: (src: string) => Promise<void> }): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-muted-foreground">
      Upload image
      <input
        type="file"
        accept="image/*"
        className="block w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground file:mr-2 file:rounded-md file:border-0 file:bg-muted file:px-2 file:py-1 file:text-sm file:text-foreground"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (!file) {
            return;
          }
          const reader = new FileReader();
          reader.addEventListener("load", () => {
            if (typeof reader.result === "string") {
              void onCommit(reader.result);
            }
          });
          reader.readAsDataURL(file);
        }}
      />
    </label>
  );
}

function DesignVariablesPanel({
  onApplyToSelected,
  onScanWorkspaceTheme,
  onUpdateVariables,
  selectedNode,
  variables,
}: {
  variables: Record<string, unknown>;
  selectedNode: RoderDesignNode | null;
  onApplyToSelected: (patch: Partial<RoderDesignNode>) => Promise<void>;
  onScanWorkspaceTheme: () => Promise<void>;
  onUpdateVariables: (variables: Record<string, unknown>) => Promise<void>;
}): React.JSX.Element {
  const colorVariables = Object.entries(variables)
    .map(([name, value]) => ({ name, color: variableColor(value) }))
    .filter((entry): entry is { name: string; color: string } => Boolean(entry.color));
  const spacingVariables = Object.entries(variables)
    .map(([name, value]) => ({ name, spacing: variableSpacing(value) }))
    .filter((entry): entry is { name: string; spacing: number } => typeof entry.spacing === "number");
  const typographyVariables = Object.entries(variables)
    .map(([name, value]) => ({ name, typography: variableTypography(value) }))
    .filter((entry): entry is { name: string; typography: TypographyToken } => Boolean(entry.typography));
  const [name, setName] = useState("");
  const [color, setColor] = useState("#18181b");
  const [spacing, setSpacing] = useState("16");
  const [typographySize, setTypographySize] = useState("16");
  const [typographyWeight, setTypographyWeight] = useState("500");
  const [typographyAlign, setTypographyAlign] = useState<TextAlign>("left");
  const [tokenKind, setTokenKind] = useState<"color" | "spacing" | "typography">("color");
  const canApply = Boolean(selectedNode);
  const selectedFill = selectedNode ? variableColor(selectedNode.fill) : null;
  const selectedStroke = selectedNode ? variableColor(selectedNode.stroke) : null;

  async function saveVariable(): Promise<void> {
    const tokenName = safeVariableName(name);
    if (!tokenName) {
      return;
    }
    if (tokenKind === "spacing") {
      await onUpdateVariables({ [tokenName]: { kind: "spacing", value: clampSpacing(Number(spacing)) } });
    } else if (tokenKind === "typography") {
      await onUpdateVariables({
        [tokenName]: {
          kind: "typography",
          fontSize: clampFontSize(Number(typographySize)),
          fontWeight: clampFontWeight(Number(typographyWeight)),
          textAlign: typographyAlign,
        },
      });
    } else {
      await onUpdateVariables({ [tokenName]: { kind: "color", value: color } });
    }
    setName("");
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg bg-muted/30 p-2">
      <div>
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="text-sm font-semibold text-muted-foreground">Design tokens</div>
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
            onClick={() => void onScanWorkspaceTheme()}
          >
            Scan theme
          </button>
        </div>
        <div className="px-1 text-xs text-muted-foreground/80">
          Color, spacing, and type variables shared with agents. Scan reads common Tailwind/CSS theme files.
        </div>
      </div>
      {colorVariables.length === 0 ? (
        <div className="rounded-md bg-background/70 px-2 py-1 text-sm text-muted-foreground">No color tokens yet.</div>
      ) : (
        <div className="flex flex-col gap-1">
          {colorVariables.map((variable) => (
            <div key={variable.name} className="flex items-center gap-2 rounded-md bg-background/70 px-2 py-1">
              <span
                className="size-4 shrink-0 rounded border border-border"
                style={{ backgroundColor: variable.color }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{variable.name}</span>
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                disabled={!canApply}
                onClick={() => void onApplyToSelected({ fill: { kind: "color", value: variable.color } })}
              >
                Fill
              </button>
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                disabled={!canApply}
                onClick={() =>
                  void onApplyToSelected({
                    stroke: {
                      kind: "color",
                      value: variable.color,
                      width: selectedNode ? strokeWidth(selectedNode.stroke) : 2,
                    },
                  })
                }
              >
                Stroke
              </button>
            </div>
          ))}
        </div>
      )}
      {spacingVariables.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">Spacing</div>
          {spacingVariables.map((variable) => (
            <div key={variable.name} className="flex items-center gap-2 rounded-md bg-background/70 px-2 py-1">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {variable.name}
                <span className="ml-1 font-normal text-muted-foreground">{variable.spacing}px</span>
              </span>
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                disabled={!canApply}
                onClick={() => void onApplyToSelected({ width: variable.spacing })}
              >
                W
              </button>
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                disabled={!canApply}
                onClick={() => void onApplyToSelected({ height: variable.spacing })}
              >
                H
              </button>
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                disabled={!canApply}
                onClick={() => void onApplyToSelected({ x: variable.spacing, y: variable.spacing })}
              >
                XY
              </button>
            </div>
          ))}
        </div>
      )}
      {typographyVariables.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">Typography</div>
          {typographyVariables.map((variable) => (
            <div key={variable.name} className="flex items-center gap-2 rounded-md bg-background/70 px-2 py-1">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {variable.name}
                <span className="ml-1 font-normal text-muted-foreground">
                  {variable.typography.fontSize}px/{variable.typography.fontWeight} {variable.typography.textAlign}
                </span>
              </span>
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                disabled={!canApply || selectedNode?.type !== "text"}
                onClick={() =>
                  void onApplyToSelected({
                    fontSize: variable.typography.fontSize,
                    fontWeight: variable.typography.fontWeight,
                    textAlign: variable.typography.textAlign,
                  })
                }
              >
                Apply
              </button>
            </div>
          ))}
        </div>
      )}
      <InspectorSegmented
        label="Token type"
        value={tokenKind}
        options={[
          { label: "Color", value: "color" },
          { label: "Space", value: "spacing" },
          { label: "Type", value: "typography" },
        ]}
        onCommit={(nextKind) => {
          setTokenKind(nextKind);
          return Promise.resolve();
        }}
      />
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input
          value={name}
          aria-label="Token name"
          placeholder="brand.primary"
          className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
          onChange={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void saveVariable();
            }
          }}
        />
        {tokenKind === "color" ? (
          <input
            type="color"
            value={color}
            aria-label="Token color"
            className="h-8 w-10 rounded-md border border-input bg-background p-1"
            onChange={(event) => setColor(event.currentTarget.value)}
          />
        ) : tokenKind === "spacing" ? (
          <input
            type="number"
            min="0"
            max="4096"
            value={spacing}
            aria-label="Token spacing"
            className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
            onChange={(event) => setSpacing(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void saveVariable();
              }
            }}
          />
        ) : (
          <input
            type="number"
            min="8"
            max="144"
            value={typographySize}
            aria-label="Token typography size"
            className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
            onChange={(event) => setTypographySize(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void saveVariable();
              }
            }}
          />
        )}
      </div>
      {tokenKind === "typography" && (
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input
            type="number"
            min="100"
            max="900"
            step="100"
            value={typographyWeight}
            aria-label="Token typography weight"
            className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
            onChange={(event) => setTypographyWeight(event.currentTarget.value)}
          />
          <select
            value={typographyAlign}
            aria-label="Token typography align"
            className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
            onChange={(event) => setTypographyAlign(textAlignValue(event.currentTarget.value))}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
      )}
      {selectedNode && tokenKind === "spacing" && (
        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            className="rounded-md bg-background/70 px-2 py-1 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
            onClick={() => setSpacing(String(Math.round(Number(selectedNode.width ?? 0))))}
          >
            Use selected W
          </button>
          <button
            type="button"
            className="rounded-md bg-background/70 px-2 py-1 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
            onClick={() => setSpacing(String(Math.round(Number(selectedNode.height ?? 0))))}
          >
            Use selected H
          </button>
        </div>
      )}
      {selectedNode?.type === "text" && tokenKind === "typography" && (
        <button
          type="button"
          className="rounded-md bg-background/70 px-2 py-1 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
          onClick={() => {
            setTypographySize(String(textFontSize(selectedNode)));
            setTypographyWeight(String(textFontWeight(selectedNode)));
            setTypographyAlign(textAlign(selectedNode));
          }}
        >
          Use selected text style
        </button>
      )}
      {(selectedFill || selectedStroke) && (
        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            className="rounded-md bg-background/70 px-2 py-1 text-xs text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-40"
            disabled={!selectedFill}
            onClick={() => selectedFill && setColor(selectedFill)}
          >
            Use selected fill
          </button>
          <button
            type="button"
            className="rounded-md bg-background/70 px-2 py-1 text-xs text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-40"
            disabled={!selectedStroke}
            onClick={() => selectedStroke && setColor(selectedStroke)}
          >
            Use selected stroke
          </button>
        </div>
      )}
      <Button type="button" size="sm" onClick={() => void saveVariable()} disabled={!safeVariableName(name)}>
        Save token
      </Button>
    </section>
  );
}

function InspectorNumber({
  label,
  onCommit,
  value,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => Promise<void>;
}): React.JSX.Element {
  return <InspectorInput label={label} value={String(value)} onCommit={(next) => onCommit(Number(next) || 0)} />;
}

function InspectorColor({
  label,
  onCommit,
  value,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => Promise<void>;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-muted-foreground">
      {label}
      <div className="flex h-8 overflow-hidden rounded-md border border-input bg-background">
        <input
          type="color"
          value={draft}
          aria-label={`${label} color`}
          className="h-full w-9 shrink-0 cursor-pointer border-0 bg-transparent p-1"
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={() => void onCommit(draft)}
        />
        <input
          value={draft}
          aria-label={label}
          className="min-w-0 flex-1 bg-transparent px-2 text-base font-medium text-foreground outline-none"
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={() => void onCommit(draft)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
      </div>
    </label>
  );
}

function InspectorToggle({
  active,
  label,
  onCommit,
}: {
  active: boolean;
  label: string;
  onCommit: (active: boolean) => Promise<void>;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        "flex h-8 items-center justify-center rounded-md border px-2 text-sm font-medium",
        active
          ? "border-ring bg-accent text-accent-foreground"
          : "border-input bg-background text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
      aria-pressed={active}
      onClick={() => void onCommit(!active)}
    >
      {label}
    </button>
  );
}

function InspectorSegmented<T extends string>({
  label,
  onCommit,
  options,
  value,
}: {
  label: string;
  value: T;
  options: Array<{ label: string; value: T }>;
  onCommit: (value: T) => Promise<void>;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 text-sm font-medium text-muted-foreground">
      {label}
      <div className="grid grid-cols-3 overflow-hidden rounded-md border border-input bg-background">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={cn(
              "h-8 border-border px-2 text-sm text-muted-foreground transition hover:bg-accent/70 hover:text-foreground [&:not(:last-child)]:border-r",
              option.value === value && "bg-accent text-accent-foreground",
            )}
            onClick={() => void onCommit(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function DesignCanvasMessage({
  description,
  icon,
  title,
}: {
  description: string;
  icon?: React.ReactNode;
  title: string;
}): React.JSX.Element {
  return (
    <div className="grid min-h-0 flex-1 place-items-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-2 text-center">
        {icon}
        <div className="text-base font-semibold">{title}</div>
        <div className="text-base font-normal text-muted-foreground">{description}</div>
      </div>
    </div>
  );
}

function designTemplateById(templateId: DesignTemplateId): DesignTemplate {
  return DESIGN_TEMPLATES.find((template) => template.id === templateId) ?? DESIGN_TEMPLATES[0];
}

function buildDesignTemplate(
  template: DesignTemplate,
  parentId: string | null,
  offset: number,
): { rootId: string; operations: DesignPatchOperation[] } {
  const rootId = crypto.randomUUID();
  const x = 64 + offset;
  const y = 64 + offset;
  const operations: DesignPatchOperation[] = [];
  const children: RoderDesignNode[] = [];
  const root =
    template.id === "hero"
      ? heroTemplateRoot(rootId, parentId, x, y)
      : template.id === "form"
        ? formTemplateRoot(rootId, parentId, x, y)
        : cardTemplateRoot(rootId, parentId, x, y);

  const addChild = (node: RoderDesignNode): void => {
    const labelNode = templateNestedLabelNode(node);
    children.push(node);
    operations.push({ op: "insert_node", parentId: root.id, node });
    if (labelNode) {
      operations.push({ op: "insert_node", parentId: node.id, node: labelNode });
    }
  };

  if (template.id === "hero") {
    addChild(templateText("Hero headline", root.id, 32, 28, 460, 52, "Build interfaces with Roder", 32, 700));
    addChild(
      templateText(
        "Hero copy",
        root.id,
        34,
        92,
        420,
        54,
        "Use this editable template as a starting point for agent-generated product screens.",
        16,
        400,
      ),
    );
    addChild(templateButton("Primary CTA", root.id, 34, 168, 150, 44, "Start designing"));
    addChild(templateButton("Secondary CTA", root.id, 200, 168, 130, 44, "View library", "#ffffff", "#18181b"));
  } else if (template.id === "form") {
    addChild(templateText("Form title", root.id, 24, 22, 240, 36, "Welcome back", 24, 700));
    addChild(templateText("Email label", root.id, 24, 78, 220, 24, "Email", 13, 600));
    addChild(templateField("Email field", root.id, 24, 104, 272, 42, "name@example.com"));
    addChild(templateText("Password label", root.id, 24, 162, 220, 24, "Password", 13, 600));
    addChild(templateField("Password field", root.id, 24, 188, 272, 42, "••••••••"));
    addChild(templateButton("Submit button", root.id, 24, 252, 272, 44, "Sign in"));
  } else {
    addChild({
      ...designNodeForInsert("icon", 1, 0, root.id, { x: 24, y: 24, width: 44, height: 44 }),
      name: "Feature icon",
      fill: { kind: "color", value: "#4f46e5" },
    });
    addChild(templateText("Card title", root.id, 24, 84, 260, 34, "Agent-ready component", 20, 700));
    addChild(
      templateText(
        "Card copy",
        root.id,
        24,
        124,
        260,
        58,
        "Convert this card into a reusable component, then create instances with local overrides.",
        14,
        400,
      ),
    );
  }

  root.childIds = children.map((child) => child.id);
  operations.unshift({ op: "insert_node", parentId, node: root });
  return { rootId, operations };
}

function heroTemplateRoot(id: string, parentId: string | null, x: number, y: number): RoderDesignNode {
  return templateFrame(id, parentId, "Hero section", x, y, 560, 260, "#eef2ff");
}

function formTemplateRoot(id: string, parentId: string | null, x: number, y: number): RoderDesignNode {
  return templateFrame(id, parentId, "Sign-in form", x, y, 320, 328, "#ffffff");
}

function cardTemplateRoot(id: string, parentId: string | null, x: number, y: number): RoderDesignNode {
  return templateFrame(id, parentId, "Feature card", x, y, 320, 220, "#ffffff");
}

function templateFrame(
  id: string,
  parentId: string | null,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
): RoderDesignNode {
  return {
    id,
    type: "frame",
    name,
    parentId,
    childIds: [],
    x,
    y,
    width,
    height,
    visible: true,
    cornerRadius: 24,
    fill: { kind: "color", value: fill },
    stroke: { kind: "color", value: "#d4d4d8", width: 1 },
    source: { template: true },
  };
}

function templateText(
  name: string,
  parentId: string,
  x: number,
  y: number,
  width: number,
  height: number,
  content: string,
  fontSize: number,
  fontWeight: number,
): RoderDesignNode {
  return {
    id: crypto.randomUUID(),
    type: "text",
    name,
    parentId,
    childIds: [],
    x,
    y,
    width,
    height,
    visible: true,
    content,
    fontSize,
    fontWeight,
    textAlign: "left",
    fill: { kind: "color", value: "#18181b" },
  };
}

function templateButton(
  name: string,
  parentId: string,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  fill = "#18181b",
  text = "#ffffff",
): RoderDesignNode {
  const buttonId = crypto.randomUUID();
  const labelNode = templateText(`${name} label`, buttonId, 16, 11, Math.max(48, width - 32), 22, label, 14, 700);
  labelNode.fill = { kind: "color", value: text };
  labelNode.textAlign = "center";
  return {
    id: buttonId,
    type: "frame",
    name,
    parentId,
    childIds: [labelNode.id],
    x,
    y,
    width,
    height,
    visible: true,
    cornerRadius: 12,
    fill: { kind: "color", value: fill },
    stroke: { kind: "color", value: fill === "#ffffff" ? "#d4d4d8" : fill, width: 1 },
    source: { templateElement: "button", labelNode },
  };
}

function templateField(
  name: string,
  parentId: string,
  x: number,
  y: number,
  width: number,
  height: number,
  placeholder: string,
): RoderDesignNode {
  const fieldId = crypto.randomUUID();
  const labelNode = templateText(
    `${name} placeholder`,
    fieldId,
    14,
    10,
    Math.max(48, width - 28),
    22,
    placeholder,
    14,
    400,
  );
  labelNode.fill = { kind: "color", value: "#71717a" };
  return {
    id: fieldId,
    type: "frame",
    name,
    parentId,
    childIds: [labelNode.id],
    x,
    y,
    width,
    height,
    visible: true,
    cornerRadius: 10,
    fill: { kind: "color", value: "#ffffff" },
    stroke: { kind: "color", value: "#d4d4d8", width: 1 },
    source: { templateElement: "input", labelNode },
  };
}

function templateNestedLabelNode(node: RoderDesignNode): RoderDesignNode | null {
  const source = node.source;
  if (!isRecord(source) || !isRecord(source.labelNode)) {
    return null;
  }
  const labelNode = source.labelNode as RoderDesignNode;
  node.source = { ...source, labelNode: undefined };
  return labelNode;
}

function designNodeForInsert(
  kind: InsertKind,
  index: number,
  offset: number,
  parentId: string | null,
  rect?: NodeDraft,
): RoderDesignNode {
  const id = crypto.randomUUID();
  const positionOffset = parentId ? Math.min(32 + index * 12, 96) : offset;
  const fallbackX = 40 + positionOffset;
  const fallbackY = 40 + positionOffset;
  if (kind === "text") {
    return {
      id,
      type: "text",
      name: `Text ${index}`,
      parentId,
      childIds: [],
      x: rect?.x ?? 48 + positionOffset,
      y: rect?.y ?? 48 + positionOffset,
      width: rect?.width ?? 220,
      height: rect?.height ?? 48,
      visible: true,
      content: "Text",
      fontSize: 16,
      fontWeight: 500,
      textAlign: "left",
      fill: { kind: "color", value: "#18181b" },
    };
  }
  if (kind === "image") {
    return {
      id,
      type: "image",
      name: `Image ${index}`,
      parentId,
      childIds: [],
      x: rect?.x ?? fallbackX,
      y: rect?.y ?? fallbackY,
      width: rect?.width ?? 240,
      height: rect?.height ?? 160,
      visible: true,
      cornerRadius: 12,
      fill: { kind: "color", value: "#f4f4f5" },
      stroke: { kind: "color", value: "#d4d4d8", width: 1 },
      src: "",
    };
  }
  if (kind === "line") {
    return {
      id,
      type: "line",
      name: `Line ${index}`,
      parentId,
      childIds: [],
      x: rect?.x ?? fallbackX,
      y: rect?.y ?? fallbackY,
      width: rect?.width ?? 160,
      height: rect?.height ?? 80,
      visible: true,
      fill: { kind: "color", value: "transparent" },
      stroke: { kind: "color", value: "#18181b", width: 2 },
    };
  }
  if (kind === "path") {
    return {
      id,
      type: "path",
      name: `Path ${index}`,
      parentId,
      childIds: [],
      x: rect?.x ?? fallbackX,
      y: rect?.y ?? fallbackY,
      width: rect?.width ?? 160,
      height: rect?.height ?? 100,
      visible: true,
      fill: { kind: "color", value: "transparent" },
      stroke: { kind: "color", value: "#18181b", width: 2 },
      pathData: "M 8 80 C 40 8, 120 8, 152 80",
      viewBox: "0 0 160 100",
    };
  }
  if (kind === "icon") {
    return {
      id,
      type: "icon",
      name: `Icon ${index}`,
      parentId,
      childIds: [],
      x: rect?.x ?? fallbackX,
      y: rect?.y ?? fallbackY,
      width: rect?.width ?? 80,
      height: rect?.height ?? 80,
      visible: true,
      fill: { kind: "color", value: "#18181b" },
      stroke: { kind: "color", value: "transparent", width: 0 },
      svg: "M12 2l2.8 6.2 6.7.7-5 4.6 1.4 6.5L12 16.7 6.1 20l1.4-6.5-5-4.6 6.7-.7L12 2z",
      viewBox: "0 0 24 24",
    };
  }
  if (kind === "prompt") {
    return {
      id,
      type: "prompt",
      name: `Prompt ${index}`,
      parentId,
      childIds: [],
      x: rect?.x ?? fallbackX,
      y: rect?.y ?? fallbackY,
      width: rect?.width ?? 280,
      height: rect?.height ?? 160,
      visible: true,
      cornerRadius: 14,
      fill: { kind: "color", value: "#fef3c7" },
      stroke: { kind: "color", value: "#f59e0b", width: 1 },
      prompt: "Describe the design change for Roder...",
    };
  }
  return {
    id,
    type: kind,
    name: `${kind[0]?.toUpperCase() ?? "N"}${kind.slice(1)} ${index}`,
    parentId,
    childIds: [],
    x: rect?.x ?? fallbackX,
    y: rect?.y ?? fallbackY,
    width: rect?.width ?? (kind === "frame" ? 360 : 180),
    height: rect?.height ?? (kind === "frame" ? 240 : 120),
    visible: true,
    cornerRadius: kind === "rectangle" ? 8 : 12,
    fill: { kind: "color", value: kind === "frame" ? "#ffffff" : "#f4f4f5" },
    stroke: { kind: "color", value: "#d4d4d8", width: 1 },
  };
}

function importPencilLikeDesign(
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

function parseJsonObject(source: string, fileName: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error(
      `Could not parse ${fileName} as JSON/.pen: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectImportableNodes(parsed: unknown): unknown[] {
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

function importedNodeFromRaw(
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

function importKind(sourceType: string): InsertKind {
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

function importedRect(raw: Record<string, unknown>, index: number): NodeDraft {
  const width = importedNumber(raw.width ?? raw.w, 180) ?? 180;
  const height = importedNumber(raw.height ?? raw.h, 120) ?? 120;
  return {
    x: importedNumber(raw.x ?? raw.left, 48 + index * GRID_SIZE) ?? 48 + index * GRID_SIZE,
    y: importedNumber(raw.y ?? raw.top, 48 + index * GRID_SIZE) ?? 48 + index * GRID_SIZE,
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

function uniqueImportedNodeId(value: unknown, index: number, usedIds: Set<string>): string {
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

function importedPaint(value: unknown): unknown | null {
  if (typeof value === "string" && value.trim()) {
    return { kind: "color", value: value.trim() };
  }
  if (isRecord(value) && typeof value.value === "string") {
    return { kind: "color", value: value.value };
  }
  return null;
}

function importedStroke(value: unknown, width: unknown): unknown | null {
  const paint = importedPaint(value);
  if (!paint || !isRecord(paint)) {
    return null;
  }
  return { ...paint, width: importedNumber(width, 1) ?? 1 };
}

function importedNumber(value: unknown, fallback: unknown): number | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  return typeof fallback === "number" && Number.isFinite(fallback) ? fallback : null;
}

function importTextAlign(value: unknown, fallback: unknown): string {
  return value === "center" || value === "right" || value === "left"
    ? value
    : fallback === "center" || fallback === "right"
      ? fallback
      : "left";
}

async function scanDesignLibrariesFromWorkspace(
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

function designLibraryFromText(text: string, path: string): DesignLibraryEntry | null {
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

function nodesRecordFromUnknown(value: unknown): Record<string, RoderDesignNode> {
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

function cloneLibraryNode(
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

function decodeBase64Text(dataBase64: string): string {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0)));
  } catch {
    return atob(dataBase64);
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function joinPath(root: string, file: string): string {
  return `${root.replace(/\/+$/u, "")}/${file.replace(/^\/+/, "")}`;
}

function normalizePath(path: string): string {
  return path.replace(/\\/gu, "/").replace(/\/+/gu, "/");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function importedSourceLabel(node: RoderDesignNode): string | null {
  if (!isRecord(node.source) || typeof node.source.importedFrom !== "string") {
    return null;
  }
  return node.source.importedFrom;
}

function templateSourceLabel(node: RoderDesignNode): string | null {
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

function cloneDesignDocument(document: DesignDocumentResult["document"]): DesignDocumentResult["document"] {
  return JSON.parse(JSON.stringify(document)) as DesignDocumentResult["document"];
}

function describePatchOperations(operations: DesignPatchOperation[]): string {
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

function summarizePatchOperations(
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

function pushPatchDetail(summary: DesignPatchSummary, detail: string): void {
  if (summary.details.length < 5 && !summary.details.includes(detail)) {
    summary.details.push(detail);
  }
}

function countInsertedNode(node: RoderDesignNode): number {
  return 1 + (node.childIds?.length ?? 0);
}

function countNodeSubtree(document: DesignDocumentResult["document"], nodeId: string): number {
  const node = document.nodes[nodeId];
  if (!node) {
    return 1;
  }
  return 1 + (node.childIds ?? []).reduce((count, childId) => count + countNodeSubtree(document, childId), 0);
}

function patchFieldSummary(patch: Partial<RoderDesignNode>): string {
  const fields = Object.keys(patch).filter((field) => !["id", "childIds", "parentId"].includes(field));
  if (fields.length === 0) {
    return "";
  }
  return ` (${fields.slice(0, 3).join(", ")}${fields.length > 3 ? ", ..." : ""})`;
}

function designRestoreOperations(
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

function appendRestoreNode(
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
  const restoredNode = { ...snapshotNode, parentId };
  if (!current.nodes[nodeId]) {
    operations.push({ op: "insert_node", parentId, node: restoredNode });
  } else if (!jsonEqual(current.nodes[nodeId], restoredNode)) {
    operations.push({ op: "update_node", nodeId, patch: restoredNode });
  }
  for (const childId of snapshotNode.childIds ?? []) {
    appendRestoreNode(snapshot, current, childId, nodeId, operations);
  }
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneDesignSubtree(
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

function designClipboardPayload(
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

function parseDesignClipboardPayload(text: string): DesignClipboardPayload | null {
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

function canMakeComponent(node: RoderDesignNode): boolean {
  return (
    node.type === "frame" ||
    node.type === "group" ||
    node.type === "rectangle" ||
    node.type === "text" ||
    node.type === "image" ||
    node.type === "prompt"
  );
}

function canGroupNode(document: DesignDocumentResult["document"], node: RoderDesignNode): boolean {
  const parent = node.parentId ? document.nodes[node.parentId] : null;
  return Boolean(
    parent &&
    canContainChildren(parent) &&
    node.type !== "group" &&
    node.type !== "component" &&
    node.type !== "instance",
  );
}

function canUngroupNode(document: DesignDocumentResult["document"], node: RoderDesignNode): boolean {
  return (
    node.type === "group" && Boolean(node.parentId && document.nodes[node.parentId]) && (node.childIds?.length ?? 0) > 0
  );
}

function designGroupForNode(node: RoderDesignNode, parentId: string): RoderDesignNode {
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

function replaceChildId(childIds: string[], targetId: string, replacement: string | string[]): string[] {
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

function normalizeLayerQuery(value: string): string {
  return value.trim().toLowerCase();
}

function matchingLayerIds(nodes: Record<string, RoderDesignNode>, rootIds: string[], query: string): Set<string> {
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

function firstMatchingLayerId(nodes: Record<string, RoderDesignNode>, rootIds: string[], query: string): string | null {
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

function layerNodeMatches(node: RoderDesignNode, query: string): boolean {
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

function componentIdForNode(node: RoderDesignNode): string {
  const existing = typeof node.componentId === "string" && node.componentId ? node.componentId : null;
  return existing ?? `component:${node.id}`;
}

function componentBadgeLabel(node: RoderDesignNode): string {
  if (node.type === "instance") {
    const overrideCount = instanceOverrideFields(node).length;
    return overrideCount > 0 ? `Instance · ${overrideCount}` : "Instance";
  }
  return "Component";
}

function instanceOverrideFields(node: RoderDesignNode): string[] {
  if (!Array.isArray(node.overrides)) {
    return [];
  }
  return node.overrides.filter((field): field is string => typeof field === "string" && field.length > 0).sort();
}

function patchWithInstanceOverrides(node: RoderDesignNode, patch: Partial<RoderDesignNode>): Partial<RoderDesignNode> {
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

function isInstanceOverrideField(field: string): boolean {
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

function nodeRect(node: RoderDesignNode): NodeDraft {
  return {
    x: Number(node.x ?? 0),
    y: Number(node.y ?? 0),
    width: Number(node.width ?? 320),
    height: Number(node.height ?? 180),
  };
}

function nodeAbsoluteBounds(document: DesignDocumentResult["document"], node: RoderDesignNode): NodeDraft {
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

function nodeMeasurements(
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

function documentBounds(document: DesignDocumentResult["document"]): NodeDraft | null {
  const roots = document.rootIds
    .map((id) => document.nodes[id])
    .filter((node): node is RoderDesignNode => Boolean(node));
  const candidates = roots.length > 0 ? roots : Object.values(document.nodes).filter((node) => !node.parentId);
  return unionBounds(candidates.map((node) => nodeAbsoluteBounds(document, node)));
}

function miniMapModel(
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

function miniMapNodeRect(
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

function miniMapCanvasPoint(
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

function miniMapViewportRect(
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

function unionBounds(bounds: NodeDraft[]): NodeDraft | null {
  if (bounds.length === 0) {
    return null;
  }
  const minX = Math.min(...bounds.map((bound) => bound.x));
  const minY = Math.min(...bounds.map((bound) => bound.y));
  const maxX = Math.max(...bounds.map((bound) => bound.x + bound.width));
  const maxY = Math.max(...bounds.map((bound) => bound.y + bound.height));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function canArrangeChildren(
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

function canReorderLayer(document: DesignDocumentResult["document"], node: RoderDesignNode): boolean {
  if (!node.parentId) {
    return false;
  }
  const siblings = siblingLayerIds(document, node);
  return siblings.length > 1 && siblings.includes(node.id);
}

function siblingLayerIds(document: DesignDocumentResult["document"], node: RoderDesignNode): string[] {
  if (node.parentId) {
    const parent = document.nodes[node.parentId];
    return parent?.childIds?.filter((id) => Boolean(document.nodes[id])) ?? [];
  }
  return document.rootIds.filter((id) => Boolean(document.nodes[id]));
}

function layerOrderOperation(
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

function layerOrderModeLabel(mode: LayerOrderMode): string {
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

function arrangeableChildren(
  document: DesignDocumentResult["document"],
  container: RoderDesignNode,
): RoderDesignNode[] {
  return (container.childIds ?? [])
    .map((id) => document.nodes[id])
    .filter((child): child is RoderDesignNode => Boolean(child) && child.visible !== false && child.locked !== true);
}

function arrangeChildOperations(
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
  const sortedByX = [...childRects].sort((a, b) => a.rect.x - b.rect.x);
  const sortedByY = [...childRects].sort((a, b) => a.rect.y - b.rect.y);
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

function arrangeModeLabel(mode: ChildArrangeMode): string {
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

function canUpdateChildLayers(
  document: DesignDocumentResult["document"],
  container: RoderDesignNode,
  mode: ChildLayerMode,
): boolean {
  if (!canContainChildren(container)) {
    return false;
  }
  return childLayerOperations(document, container, mode).length > 0;
}

function childLayerOperations(
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

function childLayerModeLabel(mode: ChildLayerMode): string {
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

function nodeOpacity(node: RoderDesignNode): number {
  return clampOpacity(typeof node.opacity === "number" ? node.opacity : 1);
}

function clampOpacity(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1));
}

function nodeRotation(node: RoderDesignNode): number {
  return normalizeRotation(typeof node.rotation === "number" ? node.rotation : 0);
}

function normalizeRotation(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const normalized = value % 360;
  return Math.round(normalized < 0 ? normalized + 360 : normalized);
}

function canEditCornerRadius(node: RoderDesignNode): boolean {
  return node.type !== "ellipse" && node.type !== "line" && node.type !== "text";
}

function nodeCornerRadius(node: RoderDesignNode): number {
  if (!canEditCornerRadius(node)) {
    return 0;
  }
  return clampCornerRadius(typeof node.cornerRadius === "number" ? node.cornerRadius : 8);
}

function clampCornerRadius(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value));
}

function promptText(node: RoderDesignNode): string {
  return String(node.prompt ?? node.content ?? "").trim();
}

function formatPromptNodeRequest(
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

function formatDesignReviewRequest(
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

function formatScopedAgentRequest(
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

function formatScopedAgentPlanRequest(
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

function formatExternalAgentManifest(
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

function formatAgentPermissions(permissions: DesignAgentPermissions): string {
  return [
    "Design-agent permissions:",
    `- Mode: ${agentPermissionPresetLabel(permissions.preset)}`,
    `- Typed design/patch mutations: ${permissions.allowPatch ? "allowed" : "not allowed; propose changes only"}`,
    `- SVG export/attachments: ${permissions.allowExport ? "allowed" : "not allowed unless user explicitly asks"}`,
    `- Review gate: ${permissions.requireReview ? "summarize intended changes before mutating" : "direct edits allowed within scope"}`,
  ].join("\n");
}

function agentPermissionSummary(permissions: DesignAgentPermissions): string {
  const preset = agentPermissionPresetLabel(permissions.preset);
  const patch = permissions.allowPatch ? "patches allowed" : "proposal-only";
  const exportMode = permissions.allowExport ? "exports allowed" : "exports restricted";
  const review = permissions.requireReview ? "review first" : "direct edit";
  return `${preset} · ${patch} · ${exportMode} · ${review}`;
}

function agentPermissionPresetLabel(preset: DesignAgentPermissions["preset"]): string {
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

const GRID_SIZE = 24;

function stagePoint(
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

function viewportPoint(event: React.PointerEvent<HTMLDivElement>, viewport: DesignViewport): { x: number; y: number } {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.round((event.clientX - bounds.left - viewport.x) / viewport.zoom),
    y: Math.round((event.clientY - bounds.top - viewport.y) / viewport.zoom),
  };
}

function rulerTicks(
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

function snapRect(rect: NodeDraft, snapToGrid: boolean): NodeDraft {
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

function snapValue(value: number, snapToGrid: boolean): number {
  return snapToGrid ? Math.round(value / GRID_SIZE) * GRID_SIZE : Math.round(value);
}

function normalizedRect(startX: number, startY: number, currentX: number, currentY: number): NodeDraft {
  return {
    x: Math.min(startX, currentX),
    y: Math.min(startY, currentY),
    width: Math.max(1, Math.abs(currentX - startX)),
    height: Math.max(1, Math.abs(currentY - startY)),
  };
}

function arrowKeyNudge(key: string, delta: number): { x: number; y: number } | null {
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

function insertKindForShortcut(key: string): InsertKind | null | undefined {
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

function isTextEditingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLInputElement);
}

function canContainChildren(node: RoderDesignNode): boolean {
  return node.type === "frame" || node.type === "group" || node.type === "component" || node.type === "instance";
}

function nodeAncestry(nodes: Record<string, RoderDesignNode>, node: RoderDesignNode): RoderDesignNode[] {
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

function breadcrumbNodeLabel(node: RoderDesignNode, selected: boolean): string {
  const name = node.name?.trim() || node.type || node.id;
  return selected ? `${name} · ${node.type}` : name;
}

function agentActivityScope(
  document: DesignDocumentResult["document"],
  node: RoderDesignNode,
): { id: string; name: string } {
  const ancestry = nodeAncestry(document.nodes, node);
  const container = ancestry.findLast((candidate) => canContainChildren(candidate)) ?? node;
  return { id: container.id, name: container.name?.trim() || `${container.type} ${container.id.slice(0, 6)}` };
}

function agentActivityLanes(activities: DesignAgentActivity[]): Array<{
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

function agentActivityKindLabel(kind: DesignAgentActivity["kind"]): string {
  switch (kind) {
    case "review":
      return "Review";
    case "scoped":
      return "Scoped agent";
    case "prompt":
      return "Prompt";
  }
}

function agentActivityStatusClass(status: DesignAgentActivity["status"]): string {
  return cn(
    "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
    status === "running" && "bg-violet-500/10 text-violet-700",
    status === "sent" && "bg-emerald-500/10 text-emerald-700",
    status === "error" && "bg-destructive/10 text-destructive",
  );
}

function exportableRootFrames(document: DesignDocumentResult["document"]): RoderDesignNode[] {
  return document.rootIds
    .map((id) => document.nodes[id])
    .filter(
      (node): node is RoderDesignNode =>
        Boolean(node) &&
        node.visible !== false &&
        (node.type === "frame" || node.type === "component" || node.type === "instance"),
    );
}

function safeAttachmentName(name: string): string {
  const normalized = name
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "design-node";
}

async function scanDesignTokensFromWorkspace(workspaceRootPath: string): Promise<ThemeScanResult> {
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

function joinWorkspacePath(root: string, relativePath: string): string {
  return `${root.replace(/\/+$/u, "")}/${relativePath.replace(/^\/+/, "")}`;
}

function extractThemeVariables(source: string): Record<string, unknown> {
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

function extractCssCustomProperties(source: string, variables: Record<string, unknown>): void {
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

function extractTailwindObjectSection(
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

function isColorTokenValue(value: string): boolean {
  return (
    /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.test(value) ||
    /^rgba?\(/iu.test(value) ||
    /^hsla?\(/iu.test(value) ||
    /^oklch\(/iu.test(value)
  );
}

function cssLengthToPx(value: string): number | null {
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

function clampZoom(value: number): number {
  return Math.min(2.5, Math.max(0.25, value));
}

async function readLayoutDiagnostics(
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

function colorValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "value" in value && typeof value.value === "string") {
    return value.value;
  }
  return null;
}

function variableColor(value: unknown): string | null {
  const color = colorValue(value);
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : null;
}

function variableSpacing(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampSpacing(value);
  }
  if (value && typeof value === "object" && "value" in value && typeof value.value === "number") {
    return clampSpacing(value.value);
  }
  return null;
}

function clampSpacing(value: number): number {
  return Math.min(4096, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)));
}

function safeVariableName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._-]/gi, "")
    .replace(/^\.+|\.+$/g, "");
}

function strokeWidth(value: unknown): number {
  if (value && typeof value === "object" && "width" in value && typeof value.width === "number") {
    return value.width;
  }
  return 2;
}

function pathData(node: RoderDesignNode, rect: NodeDraft): string {
  const data = typeof node.pathData === "string" ? node.pathData : typeof node.d === "string" ? node.d : "";
  return (
    data.trim() ||
    `M 0 ${Math.max(1, rect.height)} C ${rect.width / 3} 0, ${(rect.width * 2) / 3} 0, ${rect.width} ${Math.max(1, rect.height)}`
  );
}

function pathViewBox(node: RoderDesignNode, rect: NodeDraft): string {
  return typeof node.viewBox === "string" && node.viewBox.trim()
    ? node.viewBox
    : `0 0 ${Math.max(1, rect.width)} ${Math.max(1, rect.height)}`;
}

function iconViewBox(node: RoderDesignNode): string {
  return typeof node.viewBox === "string" && node.viewBox.trim() ? node.viewBox : "0 0 24 24";
}

type TextAlign = "left" | "center" | "right";

type TypographyToken = {
  fontSize: number;
  fontWeight: number;
  textAlign: TextAlign;
};

function textFontSize(node: RoderDesignNode): number {
  return clampFontSize(typeof node.fontSize === "number" ? node.fontSize : 16);
}

function clampFontSize(value: number): number {
  return Math.min(144, Math.max(8, Math.round(Number.isFinite(value) ? value : 16)));
}

function textFontWeight(node: RoderDesignNode): number {
  return clampFontWeight(typeof node.fontWeight === "number" ? node.fontWeight : 500);
}

function clampFontWeight(value: number): number {
  const normalized = Math.round((Number.isFinite(value) ? value : 500) / 100) * 100;
  return Math.min(900, Math.max(100, normalized));
}

function textAlign(node: RoderDesignNode): TextAlign {
  return textAlignValue(node.textAlign);
}

function textAlignValue(value: unknown): TextAlign {
  return value === "center" || value === "right" ? value : "left";
}

function variableTypography(value: unknown): TypographyToken | null {
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

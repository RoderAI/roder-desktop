import {
  AlertCircle,
  Circle,
  Copy,
  Frame,
  ImageIcon,
  Lock,
  MessageSquare,
  PenTool,
  Slash,
  Trash2,
  Unlock,
} from "lucide-react";
import { memo, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import type { DesignDocumentResult, RoderDesignNode } from "@/types/roder";
import type {
  CreationInteraction,
  DesignAgentActivity,
  DesignCanvasState,
  DesignViewport,
  InsertKind,
  NodeDraft,
  NodeInteraction,
} from "./design-canvas-types";
import { GRID_SIZE } from "./design-canvas-utils";
import {
  arrowKeyNudge,
  clampZoom,
  colorValue,
  componentBadgeLabel,
  documentBounds,
  iconViewBox,
  insertKindForShortcut,
  isTextEditingTarget,
  miniMapCanvasPoint,
  miniMapModel,
  miniMapNodeRect,
  nodeCornerRadius,
  nodeMeasurements,
  nodeOpacity,
  nodeRect,
  nodeRotation,
  normalizedRect,
  pathData,
  pathViewBox,
  rulerTicks,
  snapRect,
  snapValue,
  stagePoint,
  strokeWidth,
  textAlign,
  textFontSize,
  textFontWeight,
  viewportPoint,
} from "./design-canvas-helpers";
import { DesignToolbar } from "./design-toolbar";

type CursorPoint = { x: number; y: number } | null;

/**
 * Cursor position changes on every pointer move; routing it through React state
 * re-rendered the whole canvas tree per move. Instead the position lives in a
 * tiny external store that only the coordinate readout subscribes to.
 */
type CursorPointStore = {
  getSnapshot: () => CursorPoint;
  set: (point: CursorPoint) => void;
  subscribe: (listener: () => void) => () => void;
};

function createCursorPointStore(): CursorPointStore {
  let point: CursorPoint = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => point,
    set: (next) => {
      if (next === point || (next !== null && point !== null && next.x === point.x && next.y === point.y)) {
        return;
      }
      point = next;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

type PanGesture = {
  clientX: number;
  clientY: number;
  origin: DesignViewport;
  latest: DesignViewport;
};

function applyStageTransform(stage: HTMLDivElement | null, viewport: DesignViewport): void {
  if (stage) {
    stage.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;
  }
}

// Memoized: the panel passes stable handler identities, so this bails out when
// only unrelated panel state (status message, undo stack, launch plan) changed.
export const DesignCanvasBody = memo(DesignCanvasBodyImpl);

function DesignCanvasBodyImpl({
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
  const [creation, setCreation] = useState<CreationInteraction | null>(null);
  // Transient pointer state lives in refs so pointer moves never re-render the tree.
  const cursorPointStoreRef = useRef<CursorPointStore | null>(null);
  cursorPointStoreRef.current ??= createCursorPointStore();
  const cursorPointStore = cursorPointStoreRef.current;
  const panRef = useRef<PanGesture | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const designDocument = state.status === "ready" ? state.result.document : null;
  const rootNodes = useMemo(
    () =>
      designDocument
        ? designDocument.rootIds
            .map((id) => designDocument.nodes[id])
            .filter((node): node is RoderDesignNode => Boolean(node))
        : [],
    [designDocument],
  );
  const commitPan = (): void => {
    const pan = panRef.current;
    panRef.current = null;
    if (pan && (pan.latest.x !== pan.origin.x || pan.latest.y !== pan.origin.y)) {
      onViewportChange(pan.latest);
    }
  };
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
          panRef.current = { clientX: event.clientX, clientY: event.clientY, origin: viewport, latest: viewport };
        }}
        onPointerMove={(event) => {
          const pan = panRef.current;
          cursorPointStore.set(viewportPoint(event, pan?.latest ?? viewport));
          if (drawKind || !pan) {
            return;
          }
          // Pan by mutating the stage transform directly; viewport state is
          // committed once on pointer-up so the tree doesn't re-render per move.
          const next = {
            ...pan.origin,
            x: pan.origin.x + event.clientX - pan.clientX,
            y: pan.origin.y + event.clientY - pan.clientY,
          };
          pan.latest = next;
          applyStageTransform(stageRef.current, next);
        }}
        onPointerLeave={() => cursorPointStore.set(null)}
        onPointerUp={commitPan}
        onPointerCancel={() => {
          cursorPointStore.set(null);
          const pan = panRef.current;
          panRef.current = null;
          if (pan) {
            applyStageTransform(stageRef.current, viewport);
          }
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
          ref={stageRef}
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
            cursorPointStore.set(stagePoint(event, viewport.zoom, false));
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
            cursorPointStore.set(stagePoint(event, viewport.zoom, false));
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
          <DesignCoordinateReadout
            cursorPointStore={cursorPointStore}
            selectedNode={selectedNode}
            snapToGrid={snapToGrid}
          />
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

const DesignMiniMap = memo(DesignMiniMapImpl);

function DesignMiniMapImpl({
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
  cursorPointStore,
  selectedNode,
  snapToGrid,
}: {
  cursorPointStore: CursorPointStore;
  selectedNode: RoderDesignNode | null;
  snapToGrid: boolean;
}): React.JSX.Element {
  const cursorPoint = useSyncExternalStore(cursorPointStore.subscribe, cursorPointStore.getSnapshot);
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

const DesignNodePreview = memo(DesignNodePreviewImpl);

function DesignNodePreviewImpl({
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

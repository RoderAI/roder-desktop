import { Frame, MessageSquare } from "lucide-react";
import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RoderDesignNode } from "@/types/roder";
import type {
  ChildArrangeMode,
  ChildLayerMode,
  DesignAgentActivity,
  DesignAgentLaunchPlanItem,
  DesignAgentPermissions,
  DesignCanvasState,
  DesignLayoutDiagnostics,
  DesignLibraryEntry,
  DesignTemplateId,
  DesignUndoSnapshot,
  LayerOrderMode,
} from "./design-canvas-types";
import { AGENT_PERMISSION_PRESETS, DESIGN_TEMPLATES } from "./design-canvas-types";
import {
  agentActivityKindLabel,
  agentActivityLanes,
  agentActivityStatusClass,
  agentPermissionSummary,
  breadcrumbNodeLabel,
  canArrangeChildren,
  canContainChildren,
  canEditCornerRadius,
  canGroupNode,
  canMakeComponent,
  canReorderLayer,
  canUngroupNode,
  canUpdateChildLayers,
  clampCornerRadius,
  clampFontSize,
  clampFontWeight,
  clampOpacity,
  clampSpacing,
  colorValue,
  componentIdForNode,
  exportableRootFrames,
  importedSourceLabel,
  instanceOverrideFields,
  layerOrderOperation,
  nodeAncestry,
  nodeCornerRadius,
  nodeOpacity,
  nodeRotation,
  normalizeRotation,
  safeVariableName,
  strokeWidth,
  templateSourceLabel,
  textAlign,
  textAlignValue,
  textFontSize,
  textFontWeight,
  variableColor,
  variableSpacing,
  variableTypography,
  type TextAlign,
  type TypographyToken,
} from "./design-canvas-helpers";
import { DesignLayers } from "./design-layers";

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

export const DesignInspector = memo(DesignInspectorImpl);

function DesignInspectorImpl({
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
        aria-label="Upload image"
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


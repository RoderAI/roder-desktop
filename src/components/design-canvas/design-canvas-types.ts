import type { DesignDocumentResult, DesignPatchOperation, RoderDesignNode } from "@/types/roder";

export type DesignDocument = DesignDocumentResult["document"];

export type DesignViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type DesignCanvasState =
  | { status: "loading" }
  | { status: "unavailable" }
  | {
      status: "ready";
      result: DesignDocumentResult;
      selectedId: string | null;
      layoutDiagnostics: DesignLayoutDiagnostics;
    }
  | { status: "error"; message: string };

export type DesignLayoutDiagnostics = {
  available: boolean;
  nodes: Array<{
    id: string;
    name: string;
    type: string;
    problems: string[];
  }>;
  problemCount: number;
};

export type InsertKind = "frame" | "text" | "rectangle" | "ellipse" | "line" | "path" | "icon" | "image" | "prompt";

export type NodeDraft = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DesignTemplateId = "hero" | "card" | "form";

export type DesignTemplate = {
  id: DesignTemplateId;
  name: string;
  description: string;
};

export type ChildArrangeMode = "left" | "center" | "right" | "top" | "middle" | "bottom" | "space-x" | "space-y";

export type ChildLayerMode = "show" | "hide" | "lock" | "unlock";

export type LayerOrderMode = "front" | "forward" | "backward" | "back";

export type DesignClipboardPayload = {
  kind: "roder-design-node";
  version: 1;
  rootId: string;
  nodes: Record<string, RoderDesignNode>;
};

export type ThemeScanResult = {
  sources: string[];
  variables: Record<string, unknown>;
};

export type DesignLibraryEntry = {
  id: string;
  name: string;
  path: string;
  nodeCount: number;
  nodes: Record<string, RoderDesignNode>;
  rootNodes: RoderDesignNode[];
  variables: Record<string, unknown>;
};

export const DESIGN_TEMPLATES: DesignTemplate[] = [
  { id: "hero", name: "Hero section", description: "Frame with headline, body, and CTA" },
  { id: "card", name: "Feature card", description: "Reusable card with icon, title, and copy" },
  { id: "form", name: "Sign-in form", description: "Email/password fields and action button" },
];

export const THEME_SCAN_FILES = [
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

export const DESIGN_LIBRARY_FILES = [
  "project.roderdesign",
  ".roderdesign",
  "design.roderdesign",
  "design/system.roderdesign",
  "design/library.roderdesign",
];

export type NodeInteraction = {
  kind: "move" | "resize";
  startClientX: number;
  startClientY: number;
  original: NodeDraft;
  draft: NodeDraft;
};

export type CreationInteraction = {
  kind: InsertKind;
  pointerId: number;
  startX: number;
  startY: number;
  rect: NodeDraft;
};

export type DesignUndoSnapshot = {
  document: DesignDocument;
  summary: DesignPatchSummary;
  label: string;
  selectedId: string | null;
};

export type DesignPatchSummary = {
  inserted: number;
  updated: number;
  deleted: number;
  variablesChanged: boolean;
  details: string[];
};

export type DesignAgentActivity = {
  id: string;
  nodeId: string;
  nodeName: string;
  scopeId: string;
  scopeName: string;
  kind: "prompt" | "scoped" | "review";
  status: "running" | "sent" | "error";
  message: string;
};

export type DesignAgentLaunchPlanItem = {
  id: string;
  nodeId: string;
  nodeName: string;
  scopeId: string;
  scopeName: string;
};

export type DesignAgentPermissions = {
  preset: "observe" | "review" | "autonomous" | "custom";
  allowPatch: boolean;
  allowExport: boolean;
  requireReview: boolean;
};

export const AGENT_PERMISSION_PRESETS: Array<{
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

export type DesignPatchOperations = DesignPatchOperation[];

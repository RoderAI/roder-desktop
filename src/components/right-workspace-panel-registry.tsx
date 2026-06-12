import { Files, GitCompareArrows, Globe2, LayoutTemplate, Paintbrush, Puzzle, TerminalSquare } from "lucide-react";
import React, { lazy, Suspense } from "react";
import type { NativeOverlayOcclusion, RightWorkspacePanelEntry } from "@/components/right-workspace-panel-shell";
import type { ThreadHunkSummary } from "@/hooks/use-thread-hunk-summary";
import type { FilePanelSelectionIntent } from "@/lib/file-panel";
import type { RouteReviewScope, RouteWorkspacePanel } from "@/lib/route-search";
import type { DesktopAttachment, WorkspaceRoot } from "@/types/roder";

// Panels are lazy so heavyweight dependencies (xterm, the design canvas,
// @pierre diff/tree viewers) stay out of the initial chunk until opened.
const TerminalPanel = lazy(() => import("@/components/terminal-panel").then((m) => ({ default: m.TerminalPanel })));
const BrowserPanel = lazy(() => import("@/components/browser-panel").then((m) => ({ default: m.BrowserPanel })));
const CanvasPanel = lazy(() => import("@/components/canvas-panel").then((m) => ({ default: m.CanvasPanel })));
const DesignCanvasPanel = lazy(() =>
  import("@/components/design-canvas/design-canvas-panel").then((m) => ({ default: m.DesignCanvasPanel })),
);
const ExtensionsPanel = lazy(() =>
  import("@/components/extensions/extensions-panel").then((m) => ({ default: m.ExtensionsPanel })),
);
const FilePanel = lazy(() => import("@/components/file-panel").then((m) => ({ default: m.FilePanel })));
const ReviewPanel = lazy(() => import("@/components/review-panel").then((m) => ({ default: m.ReviewPanel })));

function PanelFallback(): React.JSX.Element {
  return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading...</div>;
}

export const rightWorkspacePanelEntries: RightWorkspacePanelEntry[] = [
  {
    id: "terminal",
    title: "Terminal",
    description: "Command session",
    icon: <TerminalSquare />,
  },
  {
    id: "browser",
    title: "Browser",
    description: "Local preview",
    icon: <Globe2 />,
  },
  {
    id: "canvas",
    title: "Canvas",
    description: "Sketch and annotate",
    icon: <Paintbrush />,
  },
  {
    id: "design",
    title: "Design",
    description: "AI design canvas",
    icon: <LayoutTemplate />,
  },
  {
    id: "review",
    title: "Review",
    description: "Changed files",
    icon: <GitCompareArrows />,
  },
  {
    id: "extensions",
    title: "Extensions",
    description: "Installed panels",
    icon: <Puzzle />,
  },
  {
    id: "files",
    title: "Files",
    description: "Browse workspace",
    icon: <Files />,
  },
];

export type RightWorkspacePanelRenderContext = {
  active: boolean;
  appServerMethods: string[];
  activeThreadId: string;
  activeWorkspaceCwd: string;
  activeWorkspaceRef: { workspaceId: string; rootId: string };
  activeWorkspaceRoots: WorkspaceRoot[];
  hunkSummary: ThreadHunkSummary;
  reviewPath: string;
  reviewScope: RouteReviewScope;
  reviewTurnId: string;
  selectedExtensionId: string | null;
  selectedExtensionPanelId: string | null;
  fileSearchSelectionIntent: FilePanelSelectionIntent | null;
  nativeOverlayOcclusion: NativeOverlayOcclusion | null;
  width: number;
  onAttachToComposer: (attachment: DesktopAttachment) => void;
  onReviewPathChange: (path: string) => void;
  onReviewScopeChange: (scope: RouteReviewScope, turnId?: string) => void;
  onSendPrompt: (prompt: string, attachments: DesktopAttachment[]) => Promise<void>;
  onSelectedExtensionPanelChange: (extensionPanel: string) => void;
};

export function renderRightWorkspacePanel(
  panel: RouteWorkspacePanel,
  context: RightWorkspacePanelRenderContext,
): React.ReactNode {
  const content = renderPanelContent(panel, context);
  if (content == null) {
    return content;
  }
  return <Suspense fallback={<PanelFallback />}>{content}</Suspense>;
}

function renderPanelContent(
  panel: RouteWorkspacePanel,
  context: RightWorkspacePanelRenderContext,
): React.ReactNode {
  if (panel === "terminal") {
    return <TerminalPanel active={context.active} cwd={context.activeWorkspaceCwd} />;
  }
  if (panel === "browser") {
    return (
      <BrowserPanel
        active={context.active}
        nativeOverlayOcclusion={context.nativeOverlayOcclusion}
        onAttach={context.onAttachToComposer}
      />
    );
  }
  if (panel === "canvas") {
    return <CanvasPanel onAttach={context.onAttachToComposer} />;
  }
  if (panel === "design") {
    const activeRoot = context.activeWorkspaceRoots.find((root) => root.id === context.activeWorkspaceRef.rootId);
    return (
      <DesignCanvasPanel
        workspaceId={context.activeWorkspaceRef.workspaceId}
        rootId={context.activeWorkspaceRef.rootId}
        workspaceRootPath={activeRoot?.path ?? context.activeWorkspaceCwd}
        appServerMethods={context.appServerMethods}
        onAttach={context.onAttachToComposer}
        onSendPrompt={context.onSendPrompt}
      />
    );
  }
  if (panel === "review") {
    return (
      <ReviewPanel
        threadId={context.activeThreadId}
        workspaceId={context.activeWorkspaceRef.workspaceId}
        rootId={context.activeWorkspaceRef.rootId}
        threadHunks={context.hunkSummary.hunks}
        threadObservedChanges={context.hunkSummary.observedChanges}
        threadLatestTurnId={context.hunkSummary.latestTurnId}
        scope={context.reviewScope}
        turnId={context.reviewTurnId}
        selectedPath={context.reviewPath}
        width={context.width}
        appServerMethods={context.appServerMethods}
        onScopeChange={context.onReviewScopeChange}
        onSelectedPathChange={context.onReviewPathChange}
      />
    );
  }
  if (panel === "extensions") {
    return (
      <ExtensionsPanel
        selectedExtensionId={context.selectedExtensionId}
        selectedPanelId={context.selectedExtensionPanelId}
        onSelectedPanelChange={context.onSelectedExtensionPanelChange}
      />
    );
  }
  if (panel === "files") {
    return (
      <FilePanel
        workspaceId={context.activeWorkspaceRef.workspaceId}
        roots={context.activeWorkspaceRoots}
        selectedRootId={context.activeWorkspaceRef.rootId}
        appServerMethods={context.appServerMethods}
        selectionIntent={context.fileSearchSelectionIntent}
      />
    );
  }
}

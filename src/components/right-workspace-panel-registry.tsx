import { Files, GitCompareArrows, Globe2, Paintbrush, Puzzle, TerminalSquare } from "lucide-react";
import type React from "react";
import { BrowserPanel } from "@/components/browser-panel";
import { CanvasPanel } from "@/components/canvas-panel";
import { ExtensionsPanel } from "@/components/extensions/extensions-panel";
import { FilePanel } from "@/components/file-panel";
import { ReviewPanel } from "@/components/review-panel";
import { TerminalPanel } from "@/components/terminal-panel";
import type { NativeOverlayOcclusion, RightWorkspacePanelEntry } from "@/components/right-workspace-panel-shell";
import type { ThreadHunkSummary } from "@/hooks/use-thread-hunk-summary";
import type { RouteReviewScope, RouteWorkspacePanel } from "@/lib/route-search";
import type { DesktopAttachment, WorkspaceRoot } from "@/types/roder";

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
  nativeOverlayOcclusion: NativeOverlayOcclusion | null;
  width: number;
  onAttachToComposer: (attachment: DesktopAttachment) => void;
  onReviewPathChange: (path: string) => void;
  onReviewScopeChange: (scope: RouteReviewScope, turnId?: string) => void;
  onSelectedExtensionPanelChange: (extensionPanel: string) => void;
};

export function renderRightWorkspacePanel(
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
    const workspaceKey = context.activeWorkspaceRoots.map((root) => `${root.id}:${root.path}`).join("|");
    const filesystemKey =
      context.appServerMethods.includes("fs/readDirectory") && context.appServerMethods.includes("fs/readFile")
        ? "fs-ready"
        : "fs-unavailable";
    return (
      <FilePanel
        key={`${context.activeWorkspaceRef.workspaceId}:${context.activeWorkspaceRef.rootId}:${workspaceKey}:${filesystemKey}`}
        roots={context.activeWorkspaceRoots}
        selectedRootId={context.activeWorkspaceRef.rootId}
        appServerMethods={context.appServerMethods}
      />
    );
  }
}

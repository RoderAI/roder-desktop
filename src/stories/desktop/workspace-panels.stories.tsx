import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import { BrowserPanel } from "@/components/browser-panel";
import { CanvasPanel } from "@/components/canvas-panel";
import { DesignCanvasPanel } from "@/components/design-canvas/design-canvas-panel";
import { FilePanel } from "@/components/file-panel";
import { ReviewPanel } from "@/components/review-panel";
import { TerminalPanel } from "@/components/terminal-panel";
import type { HunkRecord } from "@/types/roder";
import type { RouteReviewScope } from "@/lib/route-search";
import { noop, noopAsync, threads, workspace, workspacePath } from "./fixtures";

const meta = { title: "Desktop/Workspace panels" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function PanelFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[28rem] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border">
      {children}
    </div>
  );
}

export const BrowserChrome: Story = {
  render: () => (
    <PanelFrame>
      <BrowserPanel onAttach={noop} />
    </PanelFrame>
  ),
};
export const Terminal: Story = {
  render: () => (
    <PanelFrame>
      <TerminalPanel cwd={workspacePath} />
    </PanelFrame>
  ),
};
export const FilesOffline: Story = {
  render: () => (
    <PanelFrame>
      <FilePanel
        workspaceId={workspace.id}
        roots={workspace.roots}
        selectedRootId={workspace.defaultRootId}
        appServerMethods={[]}
      />
    </PanelFrame>
  ),
};
export const SketchCanvas: Story = {
  render: () => (
    <PanelFrame>
      <CanvasPanel onAttach={noop} />
    </PanelFrame>
  ),
};
export const DesignCanvasOffline: Story = {
  render: () => (
    <PanelFrame>
      <DesignCanvasPanel
        workspaceId={workspace.id}
        rootId={workspace.defaultRootId}
        workspaceRootPath={workspacePath}
        appServerMethods={[]}
        onAttach={noop}
        onSendPrompt={noopAsync}
      />
    </PanelFrame>
  ),
};

const hunks: HunkRecord[] = [
  {
    id: "sample-hunk",
    threadId: threads[0].id,
    turnId: "sample-turn",
    path: "README.md",
    oldStart: 1,
    oldLines: 2,
    newStart: 1,
    newLines: 2,
    diff: [
      { kind: "context", text: "# Roder Desktop", oldLine: 1, newLine: 1 },
      { kind: "removed", text: "Desktop app for Roder.", oldLine: 2 },
      { kind: "added", text: "Desktop workbench for Roder.", newLine: 2 },
    ],
    toolCallId: "sample-edit",
    toolName: "apply_patch",
    rollback: { unavailable: { reason: "Storybook fixture" } },
    createdAt: "2026-01-01T00:00:00Z",
  },
];

function ReviewExample() {
  const [scope, setScope] = useState<RouteReviewScope>("turn");
  const [path, setPath] = useState("README.md");
  return (
    <PanelFrame>
      <ReviewPanel
        workspaceId={workspace.id}
        rootId={workspace.defaultRootId}
        threadId={threads[0].id}
        threadHunks={hunks}
        threadObservedChanges={[]}
        threadLatestTurnId="sample-turn"
        turnId="sample-turn"
        selectedPath={path}
        scope={scope}
        width={800}
        appServerMethods={[]}
        onScopeChange={setScope}
        onSelectedPathChange={setPath}
      />
    </PanelFrame>
  );
}

export const ReviewChanges: Story = { render: () => <ReviewExample /> };

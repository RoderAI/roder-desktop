import { Outlet } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { BrowserPanel } from "@/components/browser-panel";
import { CanvasPanel } from "@/components/canvas-panel";
import { ExtensionActivityRail } from "@/components/extensions/extension-activity-rail";
import { ExtensionsPanel } from "@/components/extensions/extensions-panel";
import { ReviewPanel } from "@/components/review-panel";
import { TerminalPanel } from "@/components/terminal-panel";
import { TopBar, type ToolPanel } from "@/components/top-bar";
import type { ThreadHunkSummary } from "@/hooks/use-thread-hunk-summary";
import type { RouteReviewScope } from "@/lib/route-search";
import type { FolderOption } from "@/lib/workspace-thread-options";
import type { DesktopAttachment, RoderStatus, RoderThread } from "@/types/roder";

export type AppShellLayoutProps = {
  activeThread?: RoderThread;
  activeThreadId: string;
  activeTool: ToolPanel;
  activeWorkspaceCwd: string;
  folderOptions: FolderOption[];
  isPluginsRoute: boolean;
  leftSidebarWidth: number;
  hunkSummary: ThreadHunkSummary;
  reviewPath: string;
  reviewScope: RouteReviewScope;
  reviewTurnId: string;
  selectedExtensionId: string | null;
  selectedExtensionPanelId: string | null;
  sidebarOpen: boolean;
  status: RoderStatus;
  threadOptions: RoderThread[];
  threads: RoderThread[];
  toolPanelWidth: number;
  onArchiveThread: (threadId: string) => void;
  onAttachToComposer: (attachment: DesktopAttachment) => void;
  onBeginSidebarResize: (event: React.PointerEvent<HTMLDivElement>) => void;
  onBeginToolPanelResize: (event: React.PointerEvent<HTMLDivElement>) => void;
  onNewProject: () => void;
  onNewThread: () => void;
  onNewThreadInFolder: (path: string) => void;
  onOpenPlugins: () => void;
  onOpenSettings: (section: string) => void;
  onRestart: () => void;
  onSelectExtension: (extensionId: string) => void;
  onSelectFolder: (path: string) => void;
  onSelectThread: (threadId: string) => void;
  onSelectedExtensionPanelChange: (extensionPanel: string) => void;
  onReviewPathChange: (path: string) => void;
  onReviewScopeChange: (scope: RouteReviewScope, turnId?: string) => void;
  onToggleBrowser: () => void;
  onToggleCanvas: () => void;
  onToggleExtensions: () => void;
  onToggleReview: () => void;
  onToggleSidebar: () => void;
  onToggleTerminal: () => void;
};

export function AppShellLayout({
  activeThread,
  activeThreadId,
  activeTool,
  activeWorkspaceCwd,
  folderOptions,
  isPluginsRoute,
  leftSidebarWidth,
  hunkSummary,
  reviewPath,
  reviewScope,
  reviewTurnId,
  selectedExtensionId,
  selectedExtensionPanelId,
  sidebarOpen,
  status,
  threadOptions,
  threads,
  toolPanelWidth,
  onArchiveThread,
  onAttachToComposer,
  onBeginSidebarResize,
  onBeginToolPanelResize,
  onNewProject,
  onNewThread,
  onNewThreadInFolder,
  onOpenPlugins,
  onOpenSettings,
  onRestart,
  onSelectExtension,
  onSelectFolder,
  onSelectThread,
  onSelectedExtensionPanelChange,
  onReviewPathChange,
  onReviewScopeChange,
  onToggleBrowser,
  onToggleCanvas,
  onToggleExtensions,
  onToggleReview,
  onToggleSidebar,
  onToggleTerminal,
}: AppShellLayoutProps): React.JSX.Element {
  const sidebarRailStyle = { "--sidebar-width": `${leftSidebarWidth}px` } as SidebarRailStyle;

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-background">
      <div
        className="sidebar-shell shrink-0"
        data-open={sidebarOpen ? "true" : undefined}
        style={sidebarRailStyle}
        aria-hidden={!sidebarOpen}
      >
        <AppSidebar
          threads={threads}
          activeThreadId={activeThreadId}
          activeView={isPluginsRoute ? "plugins" : "chat"}
          width={leftSidebarWidth}
          onSelectThread={onSelectThread}
          onArchiveThread={onArchiveThread}
          onNewProject={onNewProject}
          onNewThread={onNewThread}
          onNewThreadInFolder={onNewThreadInFolder}
          onOpenPlugins={onOpenPlugins}
          onOpenSettings={() => onOpenSettings("general")}
        />
      </div>
      {sidebarOpen && (
        <div
          className="no-drag relative z-30 -ml-1 -mr-1 h-screen w-2 shrink-0 cursor-col-resize bg-transparent hover:bg-border"
          aria-label="Resize thread sidebar"
          role="separator"
          onPointerDown={onBeginSidebarResize}
        />
      )}
      <section className="flex min-w-0 flex-1 flex-col">
        {isPluginsRoute ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <Outlet />
          </div>
        ) : (
          <>
            <TopBar
              thread={activeThread}
              threads={threadOptions}
              folders={folderOptions}
              activeFolderPath={activeWorkspaceCwd}
              status={status}
              activeTool={activeTool}
              sidebarOpen={sidebarOpen}
              onRestart={onRestart}
              onToggleSidebar={onToggleSidebar}
              onSelectFolder={onSelectFolder}
              onSelectThread={onSelectThread}
              onToggleTerminal={onToggleTerminal}
              onToggleBrowser={onToggleBrowser}
              onToggleCanvas={onToggleCanvas}
              onToggleExtensions={onToggleExtensions}
              onToggleReview={onToggleReview}
            />
            <div className="flex min-h-0 flex-1">
              <div className="flex min-w-[500px] flex-1 flex-col">
                <Outlet />
              </div>
              {activeTool && (
                <ToolPanelHost
                  activeTool={activeTool}
                  appServerMethods={status.appServerMethods ?? []}
                  activeThreadId={activeThreadId}
                  activeWorkspaceCwd={activeWorkspaceCwd}
                  hunkSummary={hunkSummary}
                  reviewPath={reviewPath}
                  reviewScope={reviewScope}
                  reviewTurnId={reviewTurnId}
                  selectedExtensionId={selectedExtensionId}
                  selectedExtensionPanelId={selectedExtensionPanelId}
                  width={toolPanelWidth}
                  onAttachToComposer={onAttachToComposer}
                  onBeginResize={onBeginToolPanelResize}
                  onReviewPathChange={onReviewPathChange}
                  onReviewScopeChange={onReviewScopeChange}
                  onSelectedExtensionPanelChange={onSelectedExtensionPanelChange}
                />
              )}
              <ExtensionActivityRail
                active={activeTool === "extensions"}
                activeExtensionId={selectedExtensionId}
                onSelectExtension={onSelectExtension}
                onOpenSettings={() => onOpenSettings("extensions")}
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function ToolPanelHost({
  activeTool,
  appServerMethods,
  activeThreadId,
  activeWorkspaceCwd,
  hunkSummary,
  reviewPath,
  reviewScope,
  reviewTurnId,
  selectedExtensionId,
  selectedExtensionPanelId,
  width,
  onAttachToComposer,
  onBeginResize,
  onReviewPathChange,
  onReviewScopeChange,
  onSelectedExtensionPanelChange,
}: {
  activeTool: NonNullable<ToolPanel>;
  appServerMethods: string[];
  activeThreadId: string;
  activeWorkspaceCwd: string;
  hunkSummary: ThreadHunkSummary;
  reviewPath: string;
  reviewScope: RouteReviewScope;
  reviewTurnId: string;
  selectedExtensionId: string | null;
  selectedExtensionPanelId: string | null;
  width: number;
  onAttachToComposer: (attachment: DesktopAttachment) => void;
  onBeginResize: (event: React.PointerEvent<HTMLDivElement>) => void;
  onReviewPathChange: (path: string) => void;
  onReviewScopeChange: (scope: RouteReviewScope, turnId?: string) => void;
  onSelectedExtensionPanelChange: (extensionPanel: string) => void;
}): React.JSX.Element {
  return (
    <div className="relative h-full min-w-0 shrink-0" style={{ width }}>
      <div
        className="no-drag absolute inset-y-0 left-0 z-30 w-2 cursor-col-resize bg-transparent hover:bg-border"
        aria-label="Resize tool panel"
        role="separator"
        onPointerDown={onBeginResize}
      />
      {activeTool === "terminal" && <TerminalPanel />}
      {activeTool === "browser" && <BrowserPanel onAttach={onAttachToComposer} />}
      {activeTool === "canvas" && <CanvasPanel onAttach={onAttachToComposer} />}
      {activeTool === "review" && (
        <ReviewPanel
          threadId={activeThreadId}
          workspace={activeWorkspaceCwd}
          threadHunks={hunkSummary.hunks}
          threadObservedChanges={hunkSummary.observedChanges}
          threadLatestTurnId={hunkSummary.latestTurnId}
          scope={reviewScope}
          turnId={reviewTurnId}
          selectedPath={reviewPath}
          width={width}
          appServerMethods={appServerMethods}
          onScopeChange={onReviewScopeChange}
          onSelectedPathChange={onReviewPathChange}
        />
      )}
      {activeTool === "extensions" && (
        <ExtensionsPanel
          selectedExtensionId={selectedExtensionId}
          selectedPanelId={selectedExtensionPanelId}
          onSelectedPanelChange={onSelectedExtensionPanelChange}
        />
      )}
    </div>
  );
}

type SidebarRailStyle = CSSProperties & {
  "--sidebar-width": string;
};

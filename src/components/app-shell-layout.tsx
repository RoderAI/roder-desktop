import { Outlet } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { ExtensionActivityRail } from "@/components/extensions/extension-activity-rail";
import { renderRightWorkspacePanel, rightWorkspacePanelEntries } from "@/components/right-workspace-panel-registry";
import { RightWorkspacePanelShell } from "@/components/right-workspace-panel-shell";
import { TopBar, type WorkspacePanel } from "@/components/top-bar";
import type { ThreadHunkSummary } from "@/hooks/use-thread-hunk-summary";
import { getSidebarExtensions } from "@/lib/extension-sidebar";
import type { RouteReviewScope, RouteWorkspacePanel } from "@/lib/route-search";
import { useExtensionsStore } from "@/stores/extensions-store";
import type { FolderOption } from "@/lib/workspace-thread-options";
import type { DesktopAttachment, RoderStatus, RoderThread, RoderThreadGoal } from "@/types/roder";

export type AppShellLayoutProps = {
  activeThread?: RoderThread;
  activeThreadId: string;
  activeThreadGoal?: RoderThreadGoal | null;
  activePanel: WorkspacePanel;
  activeWorkspaceCwd: string;
  activeWorkspaceRef: { workspaceId: string; rootId: string };
  folderOptions: FolderOption[];
  isPluginsRoute: boolean;
  leftSidebarWidth: number;
  hunkSummary: ThreadHunkSummary;
  panelTabs: RouteWorkspacePanel[];
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
  workspacePanelOpen: boolean;
  onArchiveThread: (threadId: string) => void;
  onAttachToComposer: (attachment: DesktopAttachment) => void;
  onBeginSidebarResize: (event: React.PointerEvent<HTMLDivElement>) => void;
  onBeginToolPanelResize: (event: React.PointerEvent<HTMLDivElement>) => void;
  onCloseWorkspacePanel: (panel: RouteWorkspacePanel) => void;
  onCloseWorkspacePanelShell: () => void;
  onNewProject: () => void;
  onNewThread: () => void;
  onNewThreadInFolder: (path: string) => void;
  onOpenPlugins: () => void;
  onOpenWorkspacePanel: (panel: RouteWorkspacePanel) => void;
  onOpenWorkspacePanelShell: () => void;
  onOpenSettings: (section: string) => void;
  onRestart: () => void;
  onSelectExtension: (extensionId: string) => void;
  onSelectFolder: (path: string) => void;
  onSelectThread: (threadId: string) => void;
  onSelectWorkspacePanel: (panel: RouteWorkspacePanel) => void;
  onSelectedExtensionPanelChange: (extensionPanel: string) => void;
  onReviewPathChange: (path: string) => void;
  onReviewScopeChange: (scope: RouteReviewScope, turnId?: string) => void;
  onToggleSidebar: () => void;
};

export function AppShellLayout({
  activeThread,
  activeThreadId,
  activeThreadGoal,
  activePanel,
  activeWorkspaceCwd,
  activeWorkspaceRef,
  folderOptions,
  isPluginsRoute,
  leftSidebarWidth,
  hunkSummary,
  panelTabs,
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
  workspacePanelOpen,
  onArchiveThread,
  onAttachToComposer,
  onBeginSidebarResize,
  onBeginToolPanelResize,
  onCloseWorkspacePanel,
  onCloseWorkspacePanelShell,
  onNewProject,
  onNewThread,
  onNewThreadInFolder,
  onOpenPlugins,
  onOpenWorkspacePanel,
  onOpenWorkspacePanelShell,
  onOpenSettings,
  onRestart,
  onSelectExtension,
  onSelectFolder,
  onSelectThread,
  onSelectWorkspacePanel,
  onSelectedExtensionPanelChange,
  onReviewPathChange,
  onReviewScopeChange,
  onToggleSidebar,
}: AppShellLayoutProps): React.JSX.Element {
  const sidebarRailStyle = { "--sidebar-width": `${leftSidebarWidth}px` } as SidebarRailStyle;
  const useWindowTopBar = window.roderDesktop.platform !== "darwin";
  const extensions = useExtensionsStore((state) => state.extensions);
  const extensionSidebarVisible = !isPluginsRoute && getSidebarExtensions(extensions).length > 0;

  if (!useWindowTopBar) {
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
            reserveTitlebarSpace
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
                goal={activeThreadGoal}
                threads={threadOptions}
                folders={folderOptions}
                activeFolderPath={activeWorkspaceCwd}
                status={status}
                workspacePanelOpen={workspacePanelOpen}
                extensionSidebarVisible={extensionSidebarVisible}
                sidebarOpen={sidebarOpen}
                placement="content"
                onNewProject={onNewProject}
                onNewThread={onNewThread}
                onOpenSettings={() => onOpenSettings("general")}
                onRestart={onRestart}
                onToggleSidebar={onToggleSidebar}
                onSelectFolder={onSelectFolder}
                onSelectThread={onSelectThread}
                onCloseWorkspacePanelShell={onCloseWorkspacePanelShell}
                onOpenWorkspacePanelShell={onOpenWorkspacePanelShell}
              />
              <div className="flex min-h-0 min-w-[500px] flex-1 flex-col">
                <Outlet />
              </div>
            </>
          )}
        </section>
        {!isPluginsRoute && (
          <>
            <RightWorkspacePanelShell
              open={workspacePanelOpen}
              tabs={panelTabs}
              activePanel={activePanel}
              entries={rightWorkspacePanelEntries}
              width={toolPanelWidth}
              onAddPanel={onOpenWorkspacePanel}
              onBeginResize={onBeginToolPanelResize}
              onClosePanel={onCloseWorkspacePanel}
              onSelectPanel={onSelectWorkspacePanel}
              renderPanel={(entry, state) =>
                renderRightWorkspacePanel(entry.id, {
                  active: state.active,
                  appServerMethods: status.appServerMethods ?? [],
                  activeThreadId,
                  activeWorkspaceCwd,
                  activeWorkspaceRef,
                  hunkSummary,
                  reviewPath,
                  reviewScope,
                  reviewTurnId,
                  selectedExtensionId,
                  selectedExtensionPanelId,
                  nativeOverlayOcclusion: state.nativeOverlayOcclusion,
                  width: toolPanelWidth,
                  onAttachToComposer,
                  onReviewPathChange,
                  onReviewScopeChange,
                  onSelectedExtensionPanelChange,
                })
              }
            />
            <ExtensionActivityRail
              active={activePanel === "extensions"}
              activeExtensionId={selectedExtensionId}
              onSelectExtension={onSelectExtension}
              onOpenSettings={() => onOpenSettings("extensions")}
            />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-background">
      <TopBar
        thread={activeThread}
        goal={activeThreadGoal}
        threads={threadOptions}
        folders={folderOptions}
        activeFolderPath={activeWorkspaceCwd}
        status={status}
        workspacePanelOpen={workspacePanelOpen}
        extensionSidebarVisible={extensionSidebarVisible}
        sidebarOpen={sidebarOpen}
        placement="window"
        onNewProject={onNewProject}
        onNewThread={onNewThread}
        onOpenSettings={() => onOpenSettings("general")}
        onRestart={onRestart}
        onToggleSidebar={onToggleSidebar}
        onSelectFolder={onSelectFolder}
        onSelectThread={onSelectThread}
        onCloseWorkspacePanelShell={onCloseWorkspacePanelShell}
        onOpenWorkspacePanelShell={onOpenWorkspacePanelShell}
      />
      <div className="flex min-h-0 flex-1">
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
            reserveTitlebarSpace={false}
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
            className="no-drag relative z-30 -ml-1 -mr-1 h-full w-2 shrink-0 cursor-col-resize bg-transparent hover:bg-border"
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
            <div className="flex min-h-0 min-w-[500px] flex-1 flex-col">
              <Outlet />
            </div>
          )}
        </section>
        {!isPluginsRoute && (
          <>
            <RightWorkspacePanelShell
              open={workspacePanelOpen}
              tabs={panelTabs}
              activePanel={activePanel}
              entries={rightWorkspacePanelEntries}
              width={toolPanelWidth}
              onAddPanel={onOpenWorkspacePanel}
              onBeginResize={onBeginToolPanelResize}
              onClosePanel={onCloseWorkspacePanel}
              onSelectPanel={onSelectWorkspacePanel}
              renderPanel={(entry, state) =>
                renderRightWorkspacePanel(entry.id, {
                  active: state.active,
                  appServerMethods: status.appServerMethods ?? [],
                  activeThreadId,
                  activeWorkspaceCwd,
                  activeWorkspaceRef,
                  hunkSummary,
                  reviewPath,
                  reviewScope,
                  reviewTurnId,
                  selectedExtensionId,
                  selectedExtensionPanelId,
                  nativeOverlayOcclusion: state.nativeOverlayOcclusion,
                  width: toolPanelWidth,
                  onAttachToComposer,
                  onReviewPathChange,
                  onReviewScopeChange,
                  onSelectedExtensionPanelChange,
                })
              }
            />
            <ExtensionActivityRail
              active={activePanel === "extensions"}
              activeExtensionId={selectedExtensionId}
              onSelectExtension={onSelectExtension}
              onOpenSettings={() => onOpenSettings("extensions")}
            />
          </>
        )}
      </div>
    </div>
  );
}

type SidebarRailStyle = CSSProperties & {
  "--sidebar-width": string;
};

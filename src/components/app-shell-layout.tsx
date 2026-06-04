import { Outlet } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
  usePanelRef,
  type Layout,
  type PanelSize,
} from "react-resizable-panels";
import { AppSidebar } from "@/components/app-sidebar";
import { ExtensionActivityRail } from "@/components/extensions/extension-activity-rail";
import { renderRightWorkspacePanel, rightWorkspacePanelEntries } from "@/components/right-workspace-panel-registry";
import { RightWorkspacePanelShell } from "@/components/right-workspace-panel-shell";
import { TopBar, type WorkspacePanel } from "@/components/top-bar";
import type { ThreadHunkSummary } from "@/hooks/use-thread-hunk-summary";
import { getSidebarExtensions } from "@/lib/extension-sidebar";
import {
  sidebarWidthBounds,
  toolPanelWidthBounds,
  type RouteReviewScope,
  type RouteWorkspacePanel,
} from "@/lib/route-search";
import { useExtensionsStore } from "@/stores/extensions-store";
import type { FolderOption } from "@/lib/workspace-thread-options";
import type { DesktopAttachment, RoderStatus, RoderThread, RoderThreadGoal } from "@/types/roder";

const sidebarPanelId = "thread-sidebar";
const contentPanelId = "thread-content";
const workspacePanelId = "workspace-panel";
const layoutId = "app-shell-workspace";
const workspaceLayoutPanelIds = [sidebarPanelId, contentPanelId, workspacePanelId];
const mainPanelMinSize = "500px";
const shellLayoutAnimationMs = 220;
const sidebarPanelWidthStorageKey = "roder:app-shell:sidebar-panel-width";
const resizeHandleClassName =
  "no-drag relative z-30 -ml-1 -mr-1 h-full w-2 cursor-col-resize bg-transparent after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors after:content-[''] hover:after:bg-input active:after:bg-input focus-visible:after:bg-ring";

type ShellAnimationState = {
  animating: boolean;
  frozenWorkspacePanelWidth: number | null;
};

export type AppShellLayoutProps = {
  activeThread?: RoderThread;
  activeThreadId: string;
  activeThreadGoal?: RoderThreadGoal | null;
  activePanel: WorkspacePanel;
  activeWorkspaceCwd: string;
  activeWorkspaceRef: { workspaceId: string; rootId: string };
  folderOptions: FolderOption[];
  isPluginsRoute: boolean;
  hunkSummary: ThreadHunkSummary;
  panelTabs: RouteWorkspacePanel[];
  reviewPath: string;
  reviewScope: RouteReviewScope;
  reviewTurnId: string;
  selectedExtensionId: string | null;
  selectedExtensionPanelId: string | null;
  initialSidebarWidth: number;
  initialWorkspacePanelWidth: number;
  sidebarOpen: boolean;
  status: RoderStatus;
  threadOptions: RoderThread[];
  threads: RoderThread[];
  workspacePanelOpen: boolean;
  onArchiveThread: (threadId: string) => void;
  onAttachToComposer: (attachment: DesktopAttachment) => void;
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
  hunkSummary,
  panelTabs,
  reviewPath,
  reviewScope,
  reviewTurnId,
  selectedExtensionId,
  selectedExtensionPanelId,
  initialSidebarWidth,
  initialWorkspacePanelWidth,
  sidebarOpen,
  status,
  threadOptions,
  threads,
  workspacePanelOpen,
  onArchiveThread,
  onAttachToComposer,
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
  const useWindowTopBar = window.roderDesktop.platform !== "darwin";
  const extensions = useExtensionsStore((state) => state.extensions);
  const extensionSidebarVisible = !isPluginsRoute && getSidebarExtensions(extensions).length > 0;
  const sidebarPanelRef = usePanelRef();
  const workspacePanelRef = usePanelRef();
  const { defaultLayout, onLayoutChanged: saveLayout } = useDefaultLayout({
    id: layoutId,
    panelIds: workspaceLayoutPanelIds,
  });
  const [measuredSidebarPanelWidth, setMeasuredSidebarPanelWidth] = useState<number>(() =>
    readStoredSidebarPanelWidth(initialSidebarWidth),
  );
  const [measuredWorkspacePanelWidthOverride, setMeasuredWorkspacePanelWidthOverride] = useState<number | null>(null);
  const [shellAnimationState, setShellAnimationState] = useState<ShellAnimationState>({
    animating: false,
    frozenWorkspacePanelWidth: null,
  });
  const measuredWorkspacePanelWidthRef = useRef<number>(initialWorkspacePanelWidth);
  const panelToggleInitializedRef = useRef(false);
  const shellLayoutAnimating = shellAnimationState.animating;
  const measuredWorkspacePanelWidth = measuredWorkspacePanelWidthOverride ?? initialWorkspacePanelWidth;

  useLayoutEffect(() => {
    const sidebarPanel = sidebarPanelRef.current;
    const workspacePanel = workspacePanelRef.current;
    const shouldAnimate = panelToggleInitializedRef.current;
    if (shouldAnimate) {
      setShellAnimationState({
        animating: true,
        frozenWorkspacePanelWidth: measuredWorkspacePanelWidthRef.current,
      });
    }

    if (sidebarPanel) {
      if (sidebarOpen) {
        sidebarPanel.expand();
      } else {
        sidebarPanel.collapse();
      }
    }

    if (workspacePanel) {
      if (!isPluginsRoute && workspacePanelOpen) {
        workspacePanel.expand();
      } else {
        workspacePanel.collapse();
      }
    }

    if (!shouldAnimate) {
      panelToggleInitializedRef.current = true;
      return;
    }

    const animationTimer = window.setTimeout(() => {
      setShellAnimationState({ animating: false, frozenWorkspacePanelWidth: null });
    }, shellLayoutAnimationMs);
    return () => window.clearTimeout(animationTimer);
  }, [isPluginsRoute, sidebarOpen, sidebarPanelRef, workspacePanelOpen, workspacePanelRef]);

  function handleSidebarPanelResize(panelSize: PanelSize): void {
    if (panelSize.inPixels <= 0 || shellLayoutAnimating) {
      return;
    }
    const nextWidth = clampPanelWidth(Math.round(panelSize.inPixels), sidebarWidthBounds.min, sidebarWidthBounds.max);
    setMeasuredSidebarPanelWidth(nextWidth);
    writeStoredSidebarPanelWidth(nextWidth);
  }

  function handleWorkspacePanelResize(panelSize: PanelSize): void {
    if (panelSize.inPixels <= 0 || shellLayoutAnimating) {
      return;
    }
    const nextWidth = Math.round(panelSize.inPixels);
    measuredWorkspacePanelWidthRef.current = nextWidth;
    setMeasuredWorkspacePanelWidthOverride(nextWidth);
  }

  function handleLayoutChanged(layout: Layout): void {
    const allRestorablePanelsOpen = sidebarOpen && !isPluginsRoute && workspacePanelOpen;
    // Keep route-level hide/show state from overwriting the user's last real panel sizes.
    if (allRestorablePanelsOpen) {
      saveLayout(layout);
    }
  }

  const sidebarPanel = (
    <Panel
      id={sidebarPanelId}
      panelRef={sidebarPanelRef}
      collapsible
      collapsedSize="0px"
      defaultSize={sidebarOpen ? `${measuredSidebarPanelWidth}px` : "0px"}
      minSize={`${sidebarWidthBounds.min}px`}
      maxSize={`${sidebarWidthBounds.max}px`}
      groupResizeBehavior="preserve-pixel-size"
      onResize={handleSidebarPanelResize}
      data-shell-toggle={shellLayoutAnimating ? "true" : undefined}
      className="min-h-0 min-w-0"
    >
      <div
        className="sidebar-shell h-full w-full"
        data-open={sidebarOpen ? "true" : undefined}
        aria-hidden={!sidebarOpen}
      >
        <AppSidebar
          threads={threads}
          activeThreadId={activeThreadId}
          activeView={isPluginsRoute ? "plugins" : "chat"}
          reserveTitlebarSpace={!useWindowTopBar}
          onSelectThread={onSelectThread}
          onArchiveThread={onArchiveThread}
          onNewProject={onNewProject}
          onNewThread={onNewThread}
          onNewThreadInFolder={onNewThreadInFolder}
          onOpenPlugins={onOpenPlugins}
          onOpenSettings={() => onOpenSettings("general")}
        />
      </div>
    </Panel>
  );

  const contentPanel = (
    <Panel
      id={contentPanelId}
      minSize={mainPanelMinSize}
      data-shell-toggle={shellLayoutAnimating ? "true" : undefined}
      className="min-h-0 min-w-0"
    >
      <section className="flex h-full min-w-0 flex-col">
        {isPluginsRoute ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <Outlet />
          </div>
        ) : (
          <>
            {!useWindowTopBar && (
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
            )}
            <div className="flex min-h-0 flex-1 flex-col">
              <Outlet />
            </div>
          </>
        )}
      </section>
    </Panel>
  );

  const workspacePanel = (
    <Panel
      id={workspacePanelId}
      panelRef={workspacePanelRef}
      collapsible
      collapsedSize="0px"
      defaultSize={workspacePanelOpen ? `${initialWorkspacePanelWidth}px` : "0px"}
      minSize={`${toolPanelWidthBounds.min}px`}
      maxSize={`${toolPanelWidthBounds.max}px`}
      groupResizeBehavior="preserve-pixel-size"
      onResize={handleWorkspacePanelResize}
      data-shell-toggle={shellLayoutAnimating ? "true" : undefined}
      className="min-h-0 min-w-0"
    >
      <RightWorkspacePanelShell
        open={!isPluginsRoute && workspacePanelOpen}
        tabs={panelTabs}
        activePanel={activePanel}
        entries={rightWorkspacePanelEntries}
        freezeLayout={!isPluginsRoute && shellLayoutAnimating}
        layoutWidth={shellAnimationState.frozenWorkspacePanelWidth ?? measuredWorkspacePanelWidth}
        onAddPanel={onOpenWorkspacePanel}
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
            width: measuredWorkspacePanelWidth,
            onAttachToComposer,
            onReviewPathChange,
            onReviewScopeChange,
            onSelectedExtensionPanelChange,
          })
        }
      />
    </Panel>
  );

  const appChromeGroup = (
    <Group
      key={layoutId}
      id={layoutId}
      orientation="horizontal"
      defaultLayout={defaultLayout}
      onLayoutChanged={handleLayoutChanged}
      resizeTargetMinimumSize={{ coarse: 28, fine: 12 }}
      className="min-h-0 min-w-0 flex-1"
    >
      {sidebarPanel}
      {sidebarOpen && (
        <Separator id="thread-sidebar-resize" aria-label="Resize thread sidebar" className={resizeHandleClassName} />
      )}
      {contentPanel}
      {!isPluginsRoute && workspacePanelOpen && (
        <Separator id="workspace-panel-resize" aria-label="Resize workspace panel" className={resizeHandleClassName} />
      )}
      {workspacePanel}
    </Group>
  );

  const extensionActivityRail = !isPluginsRoute && (
    <ExtensionActivityRail
      active={activePanel === "extensions"}
      activeExtensionId={selectedExtensionId}
      onSelectExtension={onSelectExtension}
      onOpenSettings={() => onOpenSettings("extensions")}
    />
  );

  if (!useWindowTopBar) {
    return (
      <div className="relative flex h-screen w-screen overflow-hidden bg-background">
        {appChromeGroup}
        {extensionActivityRail}
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
        {appChromeGroup}
        {extensionActivityRail}
      </div>
    </div>
  );
}

function readStoredSidebarPanelWidth(fallbackWidth: number): number {
  if (typeof window === "undefined") {
    return fallbackWidth;
  }

  try {
    const storedWidth = window.localStorage.getItem(sidebarPanelWidthStorageKey);
    if (!storedWidth) {
      return fallbackWidth;
    }
    return clampPanelWidth(Number.parseInt(storedWidth, 10), sidebarWidthBounds.min, sidebarWidthBounds.max);
  } catch {
    return fallbackWidth;
  }
}

function writeStoredSidebarPanelWidth(width: number): void {
  try {
    window.localStorage.setItem(sidebarPanelWidthStorageKey, String(width));
  } catch {
    // Layout persistence is best-effort chrome state.
  }
}

function clampPanelWidth(width: number, min: number, max: number): number {
  if (!Number.isFinite(width)) {
    return min;
  }
  return Math.min(max, Math.max(min, width));
}

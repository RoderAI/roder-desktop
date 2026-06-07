import { Outlet } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
  useGroupRef,
  usePanelRef,
  type Layout,
  type PanelSize,
} from "react-resizable-panels";
import { AppSidebar } from "@/components/app-sidebar";
import { ProjectConfigDialog } from "@/components/project-config-dialog";
import { ExtensionActivityRail } from "@/components/extensions/extension-activity-rail";
import { renderRightWorkspacePanel, rightWorkspacePanelEntries } from "@/components/right-workspace-panel-registry";
import { RightWorkspacePanelShell } from "@/components/right-workspace-panel-shell";
import { TopBar, type WorkspacePanel } from "@/components/top-bar";
import type { ThreadHunkSummary } from "@/hooks/use-thread-hunk-summary";
import {
  canShowWorkspacePanelForGroupWidth,
  clampSidebarWidth,
  mainPanelMinWidth,
  nativeWindowMinWidth,
  shouldRenderWorkspacePanel,
  sidebarWidthBounds,
  workspacePanelMaxOpenWidthForGroup,
} from "@/lib/app-shell-layout";
import { getSidebarExtensions } from "@/lib/extension-sidebar";
import type { WorkspaceCreateParams } from "@/lib/roder-ipc";
import { toolPanelWidthBounds, type RouteReviewScope, type RouteWorkspacePanel } from "@/lib/route-search";
import { useExtensionsStore } from "@/stores/extensions-store";
import type { FolderOption } from "@/lib/workspace-thread-options";
import type { DesktopAttachment, RoderStatus, RoderThread, RoderThreadGoal, WorkspaceRoot } from "@/types/roder";

const contentPanelId = "thread-content";
const workspacePanelId = "workspace-panel";
// Bumped to invalidate any persisted three-panel layout from when the sidebar lived in the group.
const layoutId = "app-shell-workspace-v2";
const workspaceLayoutPanelIds = [contentPanelId, workspacePanelId];
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
  activeWorkspaceRoots: WorkspaceRoot[];
  folderOptions: FolderOption[];
  isPluginsRoute: boolean;
  hunkSummary: ThreadHunkSummary;
  panelTabs: RouteWorkspacePanel[];
  reviewPath: string;
  reviewScope: RouteReviewScope;
  reviewTurnId: string;
  selectedExtensionId: string | null;
  selectedExtensionPanelId: string | null;
  initialWorkspacePanelWidth: number;
  projectConfigOpen: boolean;
  projectCreating: boolean;
  projectInitialFolders: string[];
  sidebarOpen: boolean;
  status: RoderStatus;
  threadOptions: RoderThread[];
  threads: RoderThread[];
  workspacePanelOpen: boolean;
  onArchiveThread: (threadId: string) => void;
  onAttachToComposer: (attachment: DesktopAttachment) => void;
  onCreateProject: (params: WorkspaceCreateParams) => void;
  onProjectConfigOpenChange: (open: boolean) => void;
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
  onSendPrompt: (prompt: string, attachments: DesktopAttachment[]) => Promise<void>;
  onToggleSidebar: () => void;
};

export function AppShellLayout({
  activeThread,
  activeThreadId,
  activeThreadGoal,
  activePanel,
  activeWorkspaceCwd,
  activeWorkspaceRef,
  activeWorkspaceRoots,
  folderOptions,
  isPluginsRoute,
  hunkSummary,
  panelTabs,
  reviewPath,
  reviewScope,
  reviewTurnId,
  selectedExtensionId,
  selectedExtensionPanelId,
  initialWorkspacePanelWidth,
  projectConfigOpen,
  projectCreating,
  projectInitialFolders,
  sidebarOpen,
  status,
  threadOptions,
  threads,
  workspacePanelOpen,
  onArchiveThread,
  onAttachToComposer,
  onCreateProject,
  onProjectConfigOpenChange,
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
  onSendPrompt,
  onToggleSidebar,
}: AppShellLayoutProps): React.JSX.Element {
  const useWindowTopBar = window.roderDesktop.platform !== "darwin";
  const workspacePanelRequested = shouldRenderWorkspacePanel({ isPluginsRoute, workspacePanelOpen });
  const extensions = useExtensionsStore((state) => state.extensions);
  const extensionSidebarVisible = !isPluginsRoute && getSidebarExtensions(extensions).length > 0;
  const appChromeGroupRef = useGroupRef();
  const workspacePanelRef = usePanelRef();
  const { defaultLayout, onLayoutChanged: saveLayout } = useDefaultLayout({
    id: layoutId,
    panelIds: workspaceLayoutPanelIds,
  });
  const [sidebarWidth, setSidebarWidth] = useState<number>(() =>
    readStoredSidebarPanelWidth(sidebarWidthBounds.defaultValue),
  );
  const [measuredWorkspacePanelWidthOverride, setMeasuredWorkspacePanelWidthOverride] = useState<number | null>(null);
  const [shellAnimationState, setShellAnimationState] = useState<ShellAnimationState>({
    animating: false,
    frozenWorkspacePanelWidth: null,
  });
  const sidebarWidthRef = useRef<number>(sidebarWidth);
  const measuredWorkspacePanelWidthRef = useRef<number>(initialWorkspacePanelWidth);
  const panelToggleInitializedRef = useRef(false);
  const previousSidebarOpenRef = useRef(sidebarOpen);
  const previousWorkspaceVisibleRef = useRef(false);
  const shellLayoutAnimating = shellAnimationState.animating;
  const measuredWorkspacePanelWidth = measuredWorkspacePanelWidthOverride ?? initialWorkspacePanelWidth;
  const [appChromeGroupElement, setAppChromeGroupElement] = useState<HTMLDivElement | null>(null);
  const [appChromeGroupWidth, setAppChromeGroupWidth] = useState<number | null>(() => Math.round(window.innerWidth));
  // The workspace panel shares the group with the main column; the sidebar does not (it is a fixed
  // flex item beside the group), so this only depends on the measured group width.
  const canShowWorkspacePanel =
    appChromeGroupWidth === null
      ? true
      : canShowWorkspacePanelForGroupWidth({
          groupWidth: appChromeGroupWidth,
          workspacePanelMinWidth: toolPanelWidthBounds.min,
        });
  const workspacePanelVisible = workspacePanelRequested && canShowWorkspacePanel;
  const workspacePanelToggleVisible = workspacePanelOpen || canShowWorkspacePanel;
  const workspacePanelMaxOpenWidth = workspacePanelMaxOpenWidthForGroup({
    groupWidth: appChromeGroupWidth,
    workspacePanelMinWidth: toolPanelWidthBounds.min,
    workspacePanelMaxWidth: toolPanelWidthBounds.max,
  });

  useLayoutEffect(() => {
    if (!appChromeGroupElement) {
      setAppChromeGroupWidth(null);
      return;
    }

    const groupElement = appChromeGroupElement;
    function syncAppChromeGroupWidth(): void {
      setAppChromeGroupWidth(Math.round(groupElement.getBoundingClientRect().width));
    }

    syncAppChromeGroupWidth();
    const resizeObserver = new ResizeObserver(syncAppChromeGroupWidth);
    resizeObserver.observe(groupElement);
    return () => resizeObserver.disconnect();
  }, [appChromeGroupElement]);

  // Expand/collapse only the workspace panel via the resize library. The sidebar is not in the group
  // — its open/close is a pure CSS width animation — so toggling the workspace panel cannot touch it
  // and resizing the window cannot squeeze it. `sidebarOpen` is a dependency only so the shared
  // animation freeze covers the sidebar's width transition too.
  useLayoutEffect(() => {
    const workspacePanel = workspacePanelRef.current;
    const initialized = panelToggleInitializedRef.current;
    const sidebarChanged = previousSidebarOpenRef.current !== sidebarOpen;
    const workspaceChanged = previousWorkspaceVisibleRef.current !== workspacePanelVisible;
    previousSidebarOpenRef.current = sidebarOpen;
    previousWorkspaceVisibleRef.current = workspacePanelVisible;

    if (workspacePanel && (!initialized || workspaceChanged)) {
      if (workspacePanelVisible) {
        workspacePanel.expand();
        workspacePanel.resize(`${workspacePanelMaxOpenWidth}px`);
        const appliedWidth = Math.round(workspacePanel.getSize().inPixels);
        if (appliedWidth > 0) {
          measuredWorkspacePanelWidthRef.current = appliedWidth;
        }
      } else {
        workspacePanel.collapse();
      }
    }

    if (!initialized) {
      panelToggleInitializedRef.current = true;
      return;
    }
    if (!sidebarChanged && !workspaceChanged) {
      return;
    }

    setShellAnimationState({
      animating: true,
      frozenWorkspacePanelWidth: measuredWorkspacePanelWidthRef.current,
    });
    const animationTimer = window.setTimeout(() => {
      setShellAnimationState({ animating: false, frozenWorkspacePanelWidth: null });
    }, shellLayoutAnimationMs);
    return () => window.clearTimeout(animationTimer);
  }, [sidebarOpen, workspacePanelMaxOpenWidth, workspacePanelRef, workspacePanelVisible]);

  // Keep the native window minimum width at "everything beside the main column + the readable main
  // minimum". `chromeWidth` (window width minus the group width) is the sidebar + its handle + the
  // extension rail; it stays constant as the window resizes because only the group (main column)
  // flexes, so there is no feedback loop and the main column can never be squeezed below its minimum.
  // The right workspace panel lives in the group and is never reserved, so it yields first.
  useLayoutEffect(() => {
    if (appChromeGroupWidth === null) {
      return;
    }
    const chromeWidth = Math.max(0, Math.round(window.innerWidth) - appChromeGroupWidth);
    const minWidth = nativeWindowMinWidth({ chromeWidth });
    // Guard against a stale preload bridge (e.g. before a full Electron dev restart) so a missing
    // method can't throw out of this effect.
    if (typeof window.roderDesktop.setMinWindowWidth === "function") {
      void window.roderDesktop.setMinWindowWidth(minWidth);
    }
  }, [appChromeGroupWidth, sidebarOpen, sidebarWidth]);

  useLayoutEffect(() => {
    if (workspacePanelRequested && !canShowWorkspacePanel) {
      onCloseWorkspacePanelShell();
    }
  }, [canShowWorkspacePanel, onCloseWorkspacePanelShell, workspacePanelRequested]);

  useLayoutEffect(() => {
    const group = appChromeGroupRef.current;
    if (
      !group ||
      !workspacePanelVisible ||
      appChromeGroupWidth === null ||
      shellLayoutAnimating ||
      initialWorkspacePanelWidth === toolPanelWidthBounds.defaultValue
    ) {
      return;
    }

    const nextWorkspaceWidth = Math.min(
      toolPanelWidthBounds.max,
      Math.max(toolPanelWidthBounds.min, initialWorkspacePanelWidth),
      Math.max(toolPanelWidthBounds.min, appChromeGroupWidth - mainPanelMinWidth),
    );
    const currentWorkspaceWidth = measuredWorkspacePanelWidthRef.current;
    if (Math.abs(currentWorkspaceWidth - nextWorkspaceWidth) < 2) {
      return;
    }

    const workspacePercent = (nextWorkspaceWidth / appChromeGroupWidth) * 100;
    group.setLayout({
      [contentPanelId]: Math.max(0, 100 - workspacePercent),
      [workspacePanelId]: workspacePercent,
    });
    measuredWorkspacePanelWidthRef.current = nextWorkspaceWidth;
    setMeasuredWorkspacePanelWidthOverride(nextWorkspaceWidth);
  }, [appChromeGroupRef, appChromeGroupWidth, initialWorkspacePanelWidth, shellLayoutAnimating, workspacePanelVisible]);

  function applySidebarWidth(nextWidth: number): void {
    sidebarWidthRef.current = nextWidth;
    setSidebarWidth(nextWidth);
    writeStoredSidebarPanelWidth(nextWidth);
  }

  // Custom drag handle: the sidebar lives outside the resize group, so we drive its width directly.
  // This makes the sidebar width purely user-controlled and structurally independent of the window
  // width (flex-shrink-0 keeps it fixed; only the main column flexes).
  function handleSidebarResizePointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidthRef.current;
    // Reserve the readable main column plus whatever chrome already sits beside the sidebar (its
    // handle, the extension rail) so dragging wider can never squeeze the main column below 500px.
    const chromeBesideSidebar =
      appChromeGroupWidth === null ? 0 : Math.max(0, Math.round(window.innerWidth) - appChromeGroupWidth - startWidth);
    const maxByWindow = Math.max(
      sidebarWidthBounds.min,
      Math.round(window.innerWidth) - chromeBesideSidebar - mainPanelMinWidth,
    );

    function handlePointerMove(moveEvent: PointerEvent): void {
      const proposed = startWidth + (moveEvent.clientX - startX);
      applySidebarWidth(Math.min(clampSidebarWidth(proposed), maxByWindow));
    }
    function handlePointerUp(): void {
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
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
    // The group only holds the main column and workspace panel; persist their split only while the
    // workspace panel is open so a collapsed (0px) state never overwrites the user's last real sizes.
    if (workspacePanelVisible) {
      saveLayout(layout);
    }
  }

  // The sidebar is a fixed flex item beside the resizable group (not inside it). flex-shrink-0 keeps
  // its width independent of the window; open/close is a CSS width animation between 0 and its width.
  const sidebarRegion = (
    <div
      className="sidebar-shell-region relative shrink-0 overflow-hidden"
      data-shell-toggle={shellLayoutAnimating ? "true" : undefined}
      style={{ width: sidebarOpen ? sidebarWidth : 0 }}
    >
      <div
        className="sidebar-shell h-full"
        data-open={sidebarOpen ? "true" : undefined}
        aria-hidden={!sidebarOpen}
        style={{ width: sidebarWidth }}
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
    </div>
  );

  const sidebarResizeHandle = sidebarOpen ? (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize thread sidebar"
      tabIndex={0}
      className={`${resizeHandleClassName} shrink-0`}
      onPointerDown={handleSidebarResizePointerDown}
    />
  ) : null;

  const contentPanel = (
    <Panel
      id={contentPanelId}
      minSize={`${mainPanelMinWidth}px`}
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
                workspacePanelToggleVisible={workspacePanelToggleVisible}
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
      defaultSize={workspacePanelVisible ? `${workspacePanelMaxOpenWidth}px` : "0px"}
      minSize={`${toolPanelWidthBounds.min}px`}
      maxSize={`${toolPanelWidthBounds.max}px`}
      groupResizeBehavior="preserve-pixel-size"
      onResize={handleWorkspacePanelResize}
      data-shell-toggle={shellLayoutAnimating ? "true" : undefined}
      className="min-h-0 min-w-0"
    >
      <RightWorkspacePanelShell
        open={workspacePanelVisible}
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
            activeWorkspaceRoots,
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
            onSendPrompt,
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
      groupRef={appChromeGroupRef}
      elementRef={setAppChromeGroupElement}
      onLayoutChanged={handleLayoutChanged}
      resizeTargetMinimumSize={{ coarse: 28, fine: 12 }}
      className="min-h-0 min-w-0 flex-1"
    >
      {contentPanel}
      {workspacePanelVisible && (
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

  const projectDialog = (
    <ProjectConfigDialog
      open={projectConfigOpen}
      defaultPath={activeWorkspaceCwd || status.cwd}
      initialFolders={projectInitialFolders}
      creating={projectCreating}
      onOpenChange={onProjectConfigOpenChange}
      onCreateProject={onCreateProject}
    />
  );

  if (!useWindowTopBar) {
    return (
      <>
        {projectDialog}
        <div className="relative flex h-screen w-screen overflow-hidden bg-background">
          {sidebarRegion}
          {sidebarResizeHandle}
          {appChromeGroup}
          {extensionActivityRail}
        </div>
      </>
    );
  }

  return (
    <>
      {projectDialog}
      <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-background">
        <TopBar
          thread={activeThread}
          goal={activeThreadGoal}
          threads={threadOptions}
          folders={folderOptions}
          activeFolderPath={activeWorkspaceCwd}
          status={status}
          workspacePanelOpen={workspacePanelOpen}
          workspacePanelToggleVisible={workspacePanelToggleVisible}
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
          {sidebarRegion}
          {sidebarResizeHandle}
          {appChromeGroup}
          {extensionActivityRail}
        </div>
      </div>
    </>
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
    return clampSidebarWidth(Number.parseInt(storedWidth, 10));
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

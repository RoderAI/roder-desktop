import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { AppShellLayout } from "@/components/app-shell-layout";
import { Transcript } from "@/components/transcript";
import { IssuesPage } from "@/components/issues-page";
import { PersistentAgentsPage } from "@/components/persistent-agents-page";
import { ThreadsPage } from "@/components/threads-page";
import { toolPanelWidthBounds, type RouteWorkspacePanel } from "@/lib/route-search";
import { messages, noop, noopAsync, threads, workspace, workspacePath } from "./fixtures";

const meta = { title: "Desktop/Workbench", parameters: { layout: "fullscreen" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function WorkbenchShell() {
  const [threadId, setThreadId] = useState(threads[0].id);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panel, setPanel] = useState<RouteWorkspacePanel>("browser");
  const [tabs, setTabs] = useState<RouteWorkspacePanel[]>(["browser"]);
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);

  function openPanel(next: RouteWorkspacePanel) {
    setTabs((current) => (current.includes(next) ? current : [...current, next]));
    setPanel(next);
    setPanelOpen(true);
  }

  return (
    <AppShellLayout
      activeThread={threads.find(({ id }) => id === threadId)}
      activeThreadId={threadId}
      activePanel={tabs.includes(panel) ? panel : (tabs[0] ?? null)}
      activeWorkspaceCwd={workspacePath}
      activeWorkspaceRef={{ workspaceId: workspace.id, rootId: workspace.defaultRootId }}
      activeWorkspaceRoots={workspace.roots}
      folderOptions={[
        { path: workspacePath, name: workspace.name, updatedAt: workspace.updatedAt, threadCount: threads.length },
      ]}
      isPluginsRoute={false}
      hunkSummary={{
        fileCount: 0,
        latestTurnId: "",
        turnChangeCounts: {},
        turnChangeSummaries: {},
        hunks: [],
        observedChanges: [],
        loading: false,
        error: null,
      }}
      hasMoreThreads={false}
      loadingMoreThreads={false}
      panelTabs={tabs}
      fileSearchOpen={false}
      fileSearchSelectionIntent={null}
      reviewPath=""
      reviewScope="thread"
      reviewTurnId=""
      selectedExtensionId={null}
      selectedExtensionPanelId={null}
      initialWorkspacePanelWidth={toolPanelWidthBounds.defaultValue}
      projectPickerOpen={projectPickerOpen}
      projectPickerInitialPath="/storybook"
      projectConfigOpen={projectOpen}
      projectCreating={false}
      projectInitialFolders={[workspacePath]}
      sidebarOpen={sidebarOpen}
      status={{ state: "ready", binary: "storybook-fixture" }}
      threadOptions={threads}
      threads={threads}
      workspacePanelOpen={panelOpen}
      onArchiveThread={noop}
      onLoadMoreThreads={noop}
      onAttachToComposer={noop}
      onCreateProject={noopAsync}
      onFileSearchOpenChange={noop}
      onFileSearchSelect={noop}
      onProjectConfigOpenChange={setProjectOpen}
      onProjectPickerOpenChange={setProjectPickerOpen}
      onPickProjectFolder={() => {
        setProjectPickerOpen(false);
        setProjectOpen(true);
      }}
      onCloseWorkspacePanel={(next) => setTabs((current) => current.filter((tab) => tab !== next))}
      onCloseWorkspacePanelShell={() => setPanelOpen(false)}
      onNewProject={() => setProjectPickerOpen(true)}
      onNewThread={noop}
      onNewThreadInFolder={noop}
      onOpenPlugins={noop}
      onOpenWorkspacePanel={openPanel}
      onToggleWorkspacePanelShell={() => setPanelOpen((current) => !current)}
      onOpenSettings={noop}
      onRestart={noop}
      onSelectExtension={noop}
      onSelectFolder={noop}
      onSelectThread={setThreadId}
      onSelectWorkspacePanel={setPanel}
      onSelectedExtensionPanelChange={noop}
      onReviewPathChange={noop}
      onReviewScopeChange={noop}
      onSendPrompt={noopAsync}
      onToggleSidebar={() => setSidebarOpen((current) => !current)}
    />
  );
}

function WorkbenchExample({ initialPath = "/" }: { initialPath?: string }) {
  const [router] = useState(() => {
    const root = createRootRoute();
    const shell = createRoute({ getParentRoute: () => root, id: "storybook-shell", component: WorkbenchShell });
    const thread = createRoute({
      getParentRoute: () => shell,
      path: "/",
      component: () => <Transcript messages={messages} followSignal={0} scrollStateKey="storybook-workbench" />,
    });
    const issues = createRoute({ getParentRoute: () => root, path: "issues", component: IssuesPage });
    const agents = createRoute({
      getParentRoute: () => root,
      path: "persistent-agents",
      component: PersistentAgentsPage,
    });
    const threadsRoute = createRoute({ getParentRoute: () => root, path: "threads", component: ThreadsPage });
    const threadRoute = createRoute({
      getParentRoute: () => shell,
      path: "threads/$threadId",
      component: thread.options.component,
    });

    return createRouter({
      routeTree: root.addChildren([shell.addChildren([thread, threadRoute]), threadsRoute, issues, agents]),
      history: createMemoryHistory({ initialEntries: [initialPath] }),
    });
  });

  return <RouterProvider router={router} />;
}

export const ThreadWorkspace: Story = { render: () => <WorkbenchExample /> };
export const Threads: Story = { render: () => <WorkbenchExample initialPath="/threads" /> };
export const Issues: Story = { render: () => <WorkbenchExample initialPath="/issues" /> };
export const PersistentAgents: Story = { render: () => <WorkbenchExample initialPath="/persistent-agents" /> };

import {
  isRemoteRunner,
  REMOTE_WORKSPACE_ROOT_ID,
  remoteRunnerLabel,
  remoteRunnerTargetName,
  remoteWorkspaceIdForMachine,
  remoteWorkspaceIdForThread,
  type ActiveRemoteWorkspace,
  type CloudMachine,
} from "@/lib/cloud-machines";
import type { SettingsSection } from "@/stores/theme-store";
import type { RoderThread, Workspace, WorkspaceRoot } from "@/types/roder";

type ThreadSelectionInput =
  | {
      route: "thread";
      threadId: string;
      activeThreadId: string;
    }
  | {
      route: "new";
      activeThreadId: string;
    };

export type ThreadSelection = {
  threadId: string;
  pushHistory: false;
};

export type ArchiveRouteTarget =
  | {
      route: "thread";
      threadId: string;
    }
  | {
      route: "new";
    };

export type ActiveWorkspaceContext = {
  cwd: string;
  ref: { workspaceId: string; rootId: string };
  roots: WorkspaceRoot[];
  remote: ActiveRemoteWorkspace | null;
};

export const pluginSectionValues = ["installed", "explore"] as const;
export type PluginSection = (typeof pluginSectionValues)[number];
export type PluginRoutePath = "/plugins/installed" | "/plugins/explore";

const validSettingsSections = new Set<SettingsSection>([
  "general",
  "appearance",
  "providers",
  "cloud-machines",
  "models",
  "skills",
  "extensions",
  "browser",
  "computer-use",
  "terminal",
  "configuration",
  "personalization",
  "mcp",
  "git",
  "usage",
]);

export function threadSelectionForRoute(input: ThreadSelectionInput): ThreadSelection | null {
  if (input.route === "new") {
    return input.activeThreadId ? { threadId: "", pushHistory: false } : null;
  }
  if (!input.threadId || input.threadId === input.activeThreadId) {
    return null;
  }
  return { threadId: input.threadId, pushHistory: false };
}

export async function stageNewThreadAfterNavigation(
  navigateToNew: () => Promise<unknown>,
  stageNewThread: (path: string) => void,
  path: string,
): Promise<void> {
  await navigateToNew();
  stageNewThread(path);
}

export function activeWorkspaceCwdForPathname({
  pathname,
  activeThreadCwd,
  selectedWorkspaceCwd,
  statusCwd,
}: {
  pathname: string;
  activeThreadCwd?: string;
  selectedWorkspaceCwd?: string;
  statusCwd?: string;
}): string {
  const stagingNewThread = (pathname.replace(/\/+$/u, "") || "/") === "/new";
  return stagingNewThread
    ? selectedWorkspaceCwd || activeThreadCwd || statusCwd || ""
    : activeThreadCwd || selectedWorkspaceCwd || statusCwd || "";
}

export function activeWorkspaceContextForRoute({
  isNewRoute,
  routeThread,
  selectedWorkspaceCwd,
  selectedWorkspaceId,
  selectedRootId,
  statusCwd,
  workspaces,
  cloudMachines = [],
  selectedCloudMachineId = "",
}: {
  isNewRoute: boolean;
  routeThread?: Pick<RoderThread, "id" | "cwd" | "workspaceId" | "rootId" | "runner">;
  selectedWorkspaceCwd: string;
  selectedWorkspaceId: string;
  selectedRootId: string;
  statusCwd?: string;
  workspaces: Workspace[];
  cloudMachines?: readonly CloudMachine[];
  selectedCloudMachineId?: string;
}): ActiveWorkspaceContext {
  if (!isNewRoute && routeThread && isRemoteRunner(routeThread.runner)) {
    const workspaceId = remoteWorkspaceIdForThread(routeThread.id);
    const label = remoteRunnerLabel(routeThread.runner, cloudMachines);
    const targetName = remoteRunnerTargetName(routeThread.runner);
    const workspacePath = routeThread.runner.workspace;
    return {
      cwd: workspacePath,
      ref: { workspaceId, rootId: REMOTE_WORKSPACE_ROOT_ID },
      roots: [{ id: REMOTE_WORKSPACE_ROOT_ID, name: label, path: workspacePath }],
      remote: {
        workspaceId,
        providerId: routeThread.runner.providerId,
        label,
        workspacePath,
        targetName,
        threadId: routeThread.id,
      },
    };
  }

  if (isNewRoute && selectedCloudMachineId) {
    const selectedMachine = cloudMachines.find((machine) => machine.id === selectedCloudMachineId);
    if (selectedMachine && selectedMachine.providerId !== "unix-local") {
      const workspaceId = remoteWorkspaceIdForMachine(selectedMachine.id);
      return {
        cwd: selectedMachine.workspace,
        ref: { workspaceId, rootId: REMOTE_WORKSPACE_ROOT_ID },
        roots: [{ id: REMOTE_WORKSPACE_ROOT_ID, name: selectedMachine.name, path: selectedMachine.workspace }],
        remote: {
          workspaceId,
          providerId: selectedMachine.providerId,
          label: selectedMachine.name,
          workspacePath: selectedMachine.workspace,
          targetName: selectedMachine.name,
          machineId: selectedMachine.id,
        },
      };
    }
  }

  const workspaceSelection = isNewRoute
    ? resolveWorkspaceSelection(workspaces, {
        workspaceId: selectedWorkspaceId,
        rootId: selectedRootId,
        path: selectedWorkspaceCwd,
      })
    : resolveWorkspaceSelection(workspaces, {
        workspaceId: routeThread?.workspaceId,
        rootId: routeThread?.rootId,
        path: routeThread?.cwd,
      });
  const workspaceId = isNewRoute
    ? selectedWorkspaceId || workspaceSelection?.workspace.id || ""
    : routeThread?.workspaceId || workspaceSelection?.workspace.id || selectedWorkspaceId || "";
  const rootId = isNewRoute
    ? selectedRootId || workspaceSelection?.root.id || ""
    : routeThread?.rootId || workspaceSelection?.root.id || selectedRootId || "";
  const cwd = isNewRoute
    ? selectedWorkspaceCwd || workspaceSelection?.root.path || statusCwd || ""
    : routeThread?.cwd || workspaceSelection?.root.path || selectedWorkspaceCwd || statusCwd || "";
  const roots = workspaces.find((workspace) => workspace.id === workspaceId)?.roots ?? [];

  return {
    cwd,
    ref: { workspaceId, rootId },
    roots,
    remote: null,
  };
}

export function normalizeSettingsSectionParam(section: string | undefined): SettingsSection {
  if (section && validSettingsSections.has(section as SettingsSection)) {
    return section as SettingsSection;
  }
  return "general";
}

export function defaultRouteForHydratedState(): string {
  return "/new";
}

export function defaultPluginsRoute(): PluginRoutePath {
  return "/plugins/explore";
}

export function pluginsRouteForSection(section: PluginSection): PluginRoutePath {
  return section === "explore" ? "/plugins/explore" : "/plugins/installed";
}

export function isPluginsRoutePath(pathname: string): boolean {
  const normalizedPathname = pathname.replace(/\/+$/u, "") || "/";
  return normalizedPathname === "/plugins" || normalizedPathname.startsWith("/plugins/");
}

export type FullPageRoute = "threads" | "issues" | "persistentAgents" | "plugins";

export function fullPageRouteForPathname(pathname: string): FullPageRoute | null {
  const normalized = pathname.replace(/\/+$/u, "") || "/";
  if (normalized === "/threads") return "threads";
  if (normalized === "/issues") return "issues";
  if (normalized === "/persistent-agents") return "persistentAgents";
  return isPluginsRoutePath(normalized) ? "plugins" : null;
}

export function isNewRoutePath(pathname: string): boolean {
  return (pathname.replace(/\/+$/u, "") || "/") === "/new";
}

export function archiveRouteAfterThreadRemoval({
  activeThreadId,
  archivedThreadId,
  threads,
}: {
  activeThreadId: string;
  archivedThreadId: string;
  threads: Array<{ id: string }>;
}): ArchiveRouteTarget | null {
  if (!archivedThreadId || archivedThreadId !== activeThreadId) {
    return null;
  }
  const nextThread = threads.find((thread) => thread.id !== archivedThreadId);
  return nextThread ? { route: "thread", threadId: nextThread.id } : { route: "new" };
}

function resolveWorkspaceSelection(
  workspaces: Workspace[],
  params: { workspaceId?: string | null; rootId?: string | null; path?: string },
): { workspace: Workspace; root: WorkspaceRoot } | null {
  const workspaceById = params.workspaceId ? workspaces.find((workspace) => workspace.id === params.workspaceId) : null;
  const rootFromWorkspace = workspaceById ? rootForWorkspace(workspaceById, params.rootId || undefined) : null;
  if (workspaceById && rootFromWorkspace) {
    return { workspace: workspaceById, root: rootFromWorkspace };
  }

  const path = (params.path || "").replace(/\/+$/, "");
  if (!path) {
    return null;
  }
  for (const workspace of workspaces) {
    for (const root of workspace.roots) {
      if (root.path.replace(/\/+$/, "") === path) {
        return { workspace, root };
      }
    }
  }
  return null;
}

function rootForWorkspace(workspace: Workspace, rootId?: string): WorkspaceRoot | null {
  if (rootId) {
    return workspace.roots.find((root) => root.id === rootId) ?? null;
  }
  return workspace.roots[0] ?? null;
}

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
};

export const pluginSectionValues = ["installed", "explore"] as const;
export type PluginSection = (typeof pluginSectionValues)[number];
export type PluginRoutePath = "/plugins/installed" | "/plugins/explore";

const validSettingsSections = new Set<SettingsSection>([
  "general",
  "appearance",
  "components",
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
}: {
  isNewRoute: boolean;
  routeThread?: Pick<RoderThread, "cwd" | "workspaceId" | "rootId">;
  selectedWorkspaceCwd: string;
  selectedWorkspaceId: string;
  selectedRootId: string;
  statusCwd?: string;
  workspaces: Workspace[];
}): ActiveWorkspaceContext {
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
  };
}

export function normalizeSettingsSectionParam(section: string | undefined): SettingsSection {
  if (section && validSettingsSections.has(section as SettingsSection)) {
    return section as SettingsSection;
  }
  return "general";
}

export function defaultRouteForHydratedState({ activeThreadId }: { activeThreadId: string }): string {
  return activeThreadId ? `/threads/${encodeURIComponent(activeThreadId)}` : "/new";
}

export function defaultPluginsRoute(): PluginRoutePath {
  return "/plugins/installed";
}

export function pluginsRouteForSection(section: PluginSection): PluginRoutePath {
  return section === "explore" ? "/plugins/explore" : "/plugins/installed";
}

export function isPluginsRoutePath(pathname: string): boolean {
  const normalizedPathname = pathname.replace(/\/+$/u, "") || "/";
  return normalizedPathname === "/plugins" || normalizedPathname.startsWith("/plugins/");
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

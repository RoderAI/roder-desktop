import type { SettingsSection } from "@/stores/theme-store";

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


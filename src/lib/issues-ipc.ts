import { issueStatuses, type Issue, type IssueProject, type IssueStatus } from "@/types/issues";
import { create } from "zustand";

export function groupIssues(
  issues: Issue[],
  filters: { query?: string; projectId?: string; status?: string; assignment?: string } = {},
  collapsedStatuses: readonly IssueStatus[] = ["done", "cancelled"],
): { status: IssueStatus; issues: Issue[]; expanded: boolean }[] {
  const query = (filters.query ?? "").trim().toLowerCase();
  const revealMatches = Boolean(query || filters.projectId || filters.status || filters.assignment);
  const byStatus = new Map<IssueStatus, Issue[]>();
  for (const issue of issues) {
    if (filters.projectId && issue.projectId !== filters.projectId) continue;
    if (filters.status && issue.status !== filters.status) continue;
    if (filters.assignment === "assigned" && issue.owner.type !== "thread") continue;
    if (filters.assignment === "unassigned" && issue.owner.type === "thread") continue;
    if (query && !`${issue.title}\n${issue.description}\n${issue.number}`.toLowerCase().includes(query)) continue;
    const group = byStatus.get(issue.status) ?? [];
    group.push(issue);
    byStatus.set(issue.status, group);
  }
  const groups: { status: IssueStatus; issues: Issue[]; expanded: boolean }[] = [];
  const collapsed = new Set(collapsedStatuses);
  for (const status of issueStatuses) {
    const matches = byStatus.get(status);
    if (matches?.length) groups.push({ status, issues: matches, expanded: revealMatches || !collapsed.has(status) });
  }
  return groups;
}

/** Fields a person can edit on an issue; threads, pull requests and activity change through their own requests. */
export type IssueEdit = Partial<
  Pick<
    Issue,
    "projectId" | "title" | "description" | "status" | "priority" | "owner" | "doneCriteria" | "outOfScope" | "parent"
  >
>;

export const issuesIpc = {
  listProjects: () => window.roderDesktop.request("desktop/projects/list", {}) as Promise<{ projects: IssueProject[] }>,
  createProject: (params: { name: string; description?: string; workspaceId?: string | null }) =>
    window.roderDesktop.request("desktop/projects/create", params) as Promise<{ project: IssueProject }>,
  ensureWorkspaceProject: (params: {
    workspaceId: string;
    name: string;
    description?: string;
    roderThreadId?: string | null;
  }) => window.roderDesktop.request("desktop/projects/ensureWorkspace", params) as Promise<{ project: IssueProject }>,
  updateProject: (params: Partial<IssueProject> & { id: string }) =>
    window.roderDesktop.request("desktop/projects/update", params) as Promise<{ project: IssueProject }>,
  deleteProject: (id: string) => window.roderDesktop.request("desktop/projects/delete", { id }),
  listIssues: () => window.roderDesktop.request("desktop/issues/list", {}) as Promise<{ issues: Issue[] }>,
  createIssue: (params: IssueEdit & { projectId: string; title: string }) =>
    window.roderDesktop.request("desktop/issues/create", params) as Promise<{ issue: Issue }>,
  updateIssue: (params: IssueEdit & { id: string }) =>
    window.roderDesktop.request("desktop/issues/update", params) as Promise<{ issue: Issue }>,
  commentIssue: (id: string, text: string) =>
    window.roderDesktop.request("desktop/issues/comment", { id, text }) as Promise<{ issue: Issue }>,
  deleteIssue: (id: string) => window.roderDesktop.request("desktop/issues/delete", { id }),
  launchIssue: (id: string) =>
    window.roderDesktop.request("desktop/issues/launch", { id }) as Promise<{ issue: Issue; threadId: string }>,
};

type IssuesState = {
  projects: IssueProject[];
  issues: Issue[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

let refreshGeneration = 0;
export const useIssuesStore = create<IssuesState>((set) => ({
  projects: [],
  issues: [],
  loading: false,
  loaded: false,
  error: null,
  refresh: async () => {
    const generation = ++refreshGeneration;
    set({ loading: true, error: null });
    try {
      const [{ projects }, { issues }] = await Promise.all([issuesIpc.listProjects(), issuesIpc.listIssues()]);
      if (generation === refreshGeneration) set({ projects, issues, loading: false, loaded: true });
    } catch (cause) {
      if (generation === refreshGeneration)
        set({ loading: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
  },
}));

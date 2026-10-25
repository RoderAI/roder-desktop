export const issueStatuses = ["backlog", "todo", "in_progress", "blocked", "done", "cancelled"] as const;
export type IssueStatus = (typeof issueStatuses)[number];

export type IssueProject = {
  id: string;
  name: string;
  description: string;
  workspaceId: string | null;
  persistentAgentThreadId?: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Issue = {
  id: string;
  number: number;
  projectId: string;
  title: string;
  description: string;
  status: IssueStatus;
  threadId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IssuesChangedEvent = { method: "desktop/issues/changed"; params: Record<string, never> };

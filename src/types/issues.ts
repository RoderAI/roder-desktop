export const issueStatuses = [
  "backlog",
  "todo",
  "in_progress",
  "needs_you",
  "blocked",
  "in_review",
  "done",
  "cancelled",
] as const;
export type IssueStatus = (typeof issueStatuses)[number];

export const issuePriorities = ["urgent", "high", "normal", "low"] as const;
export type IssuePriority = (typeof issuePriorities)[number];

/** Who holds the issue now: exactly one owner at a time. */
export type IssueOwner = { type: "roder" } | { type: "user" } | { type: "thread"; threadId: string };

/**
 * Who makes a change. The person using the desktop app is `user`; any agent
 * calling the issue tools is `agent` with its thread ID. The lifecycle rules
 * apply to agents only.
 */
export type IssueActor = { type: "user" } | { type: "agent"; threadId: string };

export type IssueOutcome = "merged" | "dropped";

export type IssuePullRequest = { url: string; title: string };

export type IssueChange = { field: string; before: string | null; after: string | null };

export type IssueActivity = {
  id: string;
  createdAt: string;
  /** The actor resolved against the project: its Roder thread reads as `roder`. */
  actor: IssueOwner;
  kind: "created" | "updated" | "comment" | "question" | "pullRequest" | "thread" | "closed";
  text: string;
  /** For a question: the thread that held the issue when it was asked. */
  threadId?: string;
  changes?: IssueChange[];
};

export type IssueProject = {
  id: string;
  name: string;
  description: string;
  workspaceId: string | null;
  roderThreadId?: string | null;
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
  priority: IssuePriority;
  owner: IssueOwner;
  doneCriteria: string;
  outOfScope: string;
  /** Another issue in the same project that this one is a part of. */
  parent: string | null;
  /** Threads that worked on the issue, oldest first. */
  threadIds: string[];
  pullRequests: IssuePullRequest[];
  activity: IssueActivity[];
  createdAt: string;
  updatedAt: string;
};

export type IssuesChangedEvent = { method: "desktop/issues/changed"; params: Record<string, never> };

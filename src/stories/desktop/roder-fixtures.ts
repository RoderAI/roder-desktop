import { handBackTarget } from "@/lib/roder-board";
import type { Issue, IssueActivity, IssueProject } from "@/types/issues";
import {
  roderFilePaths,
  type RoderAgent,
  type RoderFile,
  type RoderFileVersion,
  type RoderWorker,
} from "@/types/roder-agents";
import { workspace } from "./fixtures";

// Invented sample data for Storybook only; nothing here comes from a real board.
const day = (offset: number, hour = 9) => new Date(Date.UTC(2026, 10, 20 + offset, hour)).toISOString();
const at = (offset: number, hour = 9) => Date.parse(day(offset, hour));

export const roderThreadId = "storybook-roder-thread";

export const roderThreads = [
  { id: "worker-shortcuts", name: "Add the keyboard shortcuts panel", preview: "" },
  { id: "worker-sidebar", name: "Fix sidebar overflow", preview: "" },
  { id: "worker-settings", name: "Build the settings tabs", preview: "" },
  { id: "worker-tooling", name: "Upgrade build tooling", preview: "" },
  { id: "worker-onboarding", name: "Write onboarding copy", preview: "" },
  { id: "worker-readme", name: "Refresh README screenshots", preview: "" },
  { id: "worker-theme", name: "Try a warmer theme", preview: "" },
];

const worker = (threadId: string, patch: Partial<RoderWorker>): RoderWorker => ({
  threadId,
  issueId: null,
  objective: roderThreads.find((thread) => thread.id === threadId)?.name ?? "",
  worktreePath: `/storybook/worktrees/${threadId}`,
  branch: `roder/${threadId.replace("worker-", "")}`,
  base: "main",
  state: "idle",
  queuePosition: null,
  followups: 0,
  hold: null,
  delegatedAt: at(0),
  lastError: null,
  ...patch,
});

export const roderFixture: RoderAgent = {
  id: "storybook-roder",
  name: "Release Roder",
  mission: "Keep the desktop app moving toward the next release.",
  workspaceId: workspace.id,
  threadId: roderThreadId,
  previousThreadIds: [],
  enabled: true,
  intervalMinutes: 60,
  eventMethods: [],
  maxRunsPerDay: 12,
  maxRunMinutes: 10,
  runs: [],
  wakes: [],
  active: null,
  lastError: null,
  lastRunAt: at(3),
  sprite: null,
  maxConcurrentWorkers: 2,
  maxFollowups: 3,
  workerPolicyMode: "bypass",
  workers: [
    worker("worker-shortcuts", { state: "running", issueId: "issue-11", delegatedAt: at(3) }),
    worker("worker-sidebar", { state: "running", issueId: "issue-12", delegatedAt: at(2) }),
    worker("worker-onboarding", { state: "queued", queuePosition: 1, issueId: "issue-9", delegatedAt: at(3, 10) }),
    worker("worker-readme", { state: "queued", queuePosition: 2, delegatedAt: at(3, 11) }),
    worker("worker-settings", { issueId: "issue-14", followups: 1, delegatedAt: at(2, 12) }),
    worker("worker-tooling", {
      issueId: "issue-13",
      lastError: "Turn failed: the package registry was unreachable.",
      delegatedAt: at(1),
    }),
    worker("worker-theme", { hold: "user", followups: 3, delegatedAt: at(0) }),
  ],
  outbox: [
    {
      id: "delivery-1",
      threadId: "worker-onboarding",
      kind: "start",
      text: "Write onboarding copy",
      createdAt: at(3, 10),
      phase: "pending",
      turnsBefore: null,
      attempts: 0,
    },
  ],
};

export const roderFileFixtures: RoderFileVersion[] = roderFilePaths.map((path, index) => ({
  path,
  version: index + 1,
  bytes: 120,
  author: index === 1 ? "user" : "roder",
  writtenAt: at(index),
  restoredFrom: null,
}));

const fileText: Record<string, string> = {
  "INSTRUCTIONS.md": "# Release Roder\n\nKeep the desktop app moving toward the next release.\n",
  "AGENTS.md": "- Ask before changing the release date.\n- Keep pull requests small.\n",
  "NOTES.md": "Sidebar fix is in review. Tooling upgrade waits on the registry.\n",
  "WORKERS.md": "Run the tests before you report.\n",
  "DIGEST.md": "Two threads running, two queued, two questions for you.\n",
};

export function roderFileFixture(path: string): RoderFile {
  const version = roderFileFixtures.find((file) => file.path === path) ?? roderFileFixtures[0];
  return { ...version, content: fileText[version.path] ?? "" };
}

export const roderProjectFixture: IssueProject = {
  id: "storybook-board",
  name: "Desktop app",
  description: "Release work for the desktop app.",
  workspaceId: workspace.id,
  roderThreadId,
  archived: false,
  createdAt: day(0),
  updatedAt: day(3),
};

let entryId = 0;
const entry = (
  actor: IssueActivity["actor"],
  kind: IssueActivity["kind"],
  text: string,
  createdAt: string,
  patch: Partial<IssueActivity> = {},
): IssueActivity => ({ id: `entry-${++entryId}`, actor, kind, text, createdAt, ...patch });
const roder = { type: "roder" } as const;
const you = { type: "user" } as const;
const thread = (threadId: string) => ({ type: "thread", threadId }) as const;

const issue = (number: number, patch: Partial<Issue>): Issue => ({
  id: `issue-${number}`,
  number,
  projectId: roderProjectFixture.id,
  title: "",
  description: "",
  status: "todo",
  priority: "normal",
  owner: roder,
  doneCriteria: "",
  outOfScope: "",
  parent: null,
  threadIds: [],
  pullRequests: [],
  activity: [],
  createdAt: day(0),
  updatedAt: day(1),
  ...patch,
});

export const settingsIssue = issue(14, {
  title: "Build the settings tabs",
  description: "Split the settings page into tabs so each section has room to grow.",
  status: "needs_you",
  priority: "high",
  owner: you,
  doneCriteria: "- Each section opens as a tab.\n- The last open tab is remembered.",
  outOfScope: "Redesigning individual settings.",
  threadIds: ["worker-settings"],
  updatedAt: day(3),
  activity: [
    entry(roder, "created", "Created issue", day(2, 10)),
    entry(roder, "updated", "Status changed to Todo", day(2, 10)),
    entry(roder, "thread", "Linked thread", day(2, 12)),
    entry(roder, "updated", "Owner: worker-settings · Status changed to In progress", day(2, 12)),
    entry(
      thread("worker-settings"),
      "comment",
      "The tabs work and the tests pass. One choice is left before I finish.",
      day(3, 8),
    ),
    entry(
      thread("worker-settings"),
      "question",
      "Should the tabs sit on the left as a list, or across the top?\n\nRecommendation: across the top, to match the Roder page.",
      day(3, 8),
      { threadId: "worker-settings" },
    ),
    entry(thread("worker-settings"), "updated", "Owner: You · Status changed to Needs you", day(3, 8), {
      changes: [{ field: "status", before: "in_progress", after: "needs_you" }],
    }),
  ],
});

export const roderIssueFixtures: Issue[] = [
  settingsIssue,
  issue(15, {
    title: "Confirm the release notes tone",
    status: "needs_you",
    owner: you,
    updatedAt: day(3, 9),
    activity: [
      entry(roder, "created", "Created issue", day(3, 7)),
      entry(roder, "question", "Short and plain, or a longer story with screenshots?", day(3, 9)),
    ],
  }),
  issue(11, {
    title: "Add the keyboard shortcuts panel",
    status: "in_progress",
    owner: thread("worker-shortcuts"),
    threadIds: ["worker-shortcuts"],
    updatedAt: day(3, 10),
  }),
  issue(12, {
    title: "Fix sidebar overflow",
    status: "in_review",
    owner: thread("worker-sidebar"),
    threadIds: ["worker-sidebar"],
    pullRequests: [{ url: "https://github.com/example/desktop/pull/101", title: "Fix sidebar overflow" }],
    updatedAt: day(3, 6),
  }),
  issue(13, {
    title: "Upgrade build tooling",
    status: "blocked",
    threadIds: ["worker-tooling"],
    updatedAt: day(2, 15),
  }),
  issue(9, { title: "Write onboarding copy", status: "todo", updatedAt: day(3, 10) }),
  issue(10, { title: "Plan the next theme", status: "backlog" }),
  issue(8, {
    title: "Ship dark mode",
    status: "done",
    threadIds: ["worker-theme"],
    pullRequests: [{ url: "https://github.com/example/desktop/pull/96", title: "Dark mode" }],
  }),
];

/**
 * A story-only stand-in for the service's hand-back rule, so answering in
 * Storybook shows the result. The real rule is tested against the service.
 */
export function answerFixture(issues: Issue[], issueId: string, text: string): Issue[] {
  return issues.map((item) => {
    if (item.id !== issueId) return item;
    const comment = entry(you, "comment", text.trim(), new Date().toISOString());
    if (item.status !== "needs_you") return { ...item, activity: [...item.activity, comment] };
    const owner = handBackTarget(item);
    return {
      ...item,
      owner,
      status: item.threadIds.length ? "in_progress" : "todo",
      activity: [...item.activity, comment],
    };
  });
}

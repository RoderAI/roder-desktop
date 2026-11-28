import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test } from "vitest";
import { IssuesService } from "../electron/issues/service";
import { IssueConversation } from "../src/components/roder-issue-conversation";
import { RoderAgentView } from "../src/components/roder-agent-view";
import {
  answerIssue,
  issueTimeline,
  needsYouItems,
  roderBoard,
  roderNeedsYouCount,
  workerGroups,
} from "../src/lib/roder-board";
import type { Issue, IssueActivity } from "../src/types/issues";
import type { RoderAgent, RoderWorker } from "../src/types/roder-agents";

const user = { type: "user" } as const;
const roderThreadId = "roder-thread";
const roder = { type: "agent", threadId: roderThreadId } as const;

const directories: string[] = [];
const previousWindow = (globalThis as { window?: unknown }).window;
afterEach(async () => {
  (globalThis as { window?: unknown }).window = previousWindow;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/**
 * A real issue service behind the renderer bridge, routed the way the main
 * process routes renderer requests: every UI call acts as the user.
 */
async function board() {
  const directory = await mkdtemp(join(tmpdir(), "roder-board-"));
  directories.push(directory);
  const service = new IssuesService({ storagePath: join(directory, "issues.json") });
  (globalThis as { window?: unknown }).window = {
    roderDesktop: { request: (method: string, params: unknown) => service.request(method, params, user) },
  };
  const { project } = await service.request(
    "desktop/projects/create",
    { name: "Desktop", workspaceId: "ws-1", roderThreadId },
    user,
  );
  const list = async () => ({
    projects: (await service.request("desktop/projects/list", {})).projects,
    issues: (await service.request("desktop/issues/list", {})).issues,
  });
  return { service, project, list };
}

test("answering a needs-you question from the UI hands the issue back to the thread that holds it", async () => {
  const { service, project, list } = await board();
  const { issue } = await service.request(
    "desktop/issues/create",
    { projectId: project.id, title: "Pick the API", doneCriteria: "Chosen and wired" },
    user,
  );
  await service.request(
    "desktop/issues/update",
    { id: issue.id, owner: { type: "thread", threadId: "worker-1" }, status: "in_progress" },
    user,
  );
  await service.request("desktop/issues/askUser", { id: issue.id, question: "Which API?" }, roder);

  const before = await list();
  expect(roderNeedsYouCount({ threadId: roderThreadId }, before.projects, before.issues)).toBe(1);
  expect(needsYouItems(before.issues)[0].question?.text).toBe("Which API?");

  const answered = await answerIssue(issue.id, "  The new one  ");
  expect(answered).toMatchObject({ status: "in_progress", owner: { type: "thread", threadId: "worker-1" } });
  expect(answered.activity.at(-1)).toMatchObject({ kind: "comment", actor: { type: "user" }, text: "The new one" });

  const after = await list();
  expect(roderNeedsYouCount({ threadId: roderThreadId }, after.projects, after.issues)).toBe(0);
  expect(needsYouItems(after.issues)).toEqual([]);
});

test("an answer on an issue no thread worked on hands it back to the Roder", async () => {
  const { service, project } = await board();
  const { issue } = await service.request(
    "desktop/issues/create",
    { projectId: project.id, title: "Scope", doneCriteria: "Agreed" },
    user,
  );
  await service.request("desktop/issues/askUser", { id: issue.id, question: "In or out?" }, roder);
  expect(await answerIssue(issue.id, "In")).toMatchObject({ status: "todo", owner: { type: "roder" } });
  await expect(answerIssue(issue.id, "   ")).rejects.toThrow("Write an answer first");
});

test("a Roder's board and needs-you count cover only the project linked to its thread", () => {
  const projects = [
    { id: "p1", roderThreadId, archived: true },
    { id: "p2", roderThreadId, archived: false },
    { id: "p3", roderThreadId: "other", archived: false },
  ].map((project) => ({
    name: project.id,
    description: "",
    workspaceId: null,
    createdAt: "",
    updatedAt: "",
    ...project,
  }));
  const issues = [
    { id: "a", projectId: "p2", status: "needs_you" },
    { id: "b", projectId: "p1", status: "needs_you" },
    { id: "c", projectId: "p3", status: "needs_you" },
    { id: "d", projectId: "p2", status: "todo" },
  ] as Issue[];
  expect(roderBoard({ threadId: roderThreadId }, projects, issues).issues.map((issue) => issue.id)).toEqual(["a", "d"]);
  expect(roderNeedsYouCount({ threadId: roderThreadId }, projects, issues)).toBe(1);
  expect(roderNeedsYouCount({ threadId: "nobody" }, projects, issues)).toBe(0);
});

const worker = (threadId: string, patch: Partial<RoderWorker>): RoderWorker => ({
  threadId,
  issueId: null,
  objective: "",
  worktreePath: `/tmp/${threadId}`,
  branch: `roder/${threadId}`,
  base: "master",
  state: "idle",
  queuePosition: null,
  followups: 0,
  hold: null,
  delegatedAt: 0,
  lastError: null,
  ...patch,
});

test("threads group into running, the queue in start order, and stopped with a reason", () => {
  const workers = [
    worker("q2", { state: "queued", queuePosition: 2 }),
    worker("run", { state: "running", issueId: "i1" }),
    worker("q1", { state: "queued", queuePosition: 1 }),
    worker("held", { hold: "user", delegatedAt: 4 }),
    worker("failed", { lastError: "Worktree could not be created", delegatedAt: 3 }),
    worker("roder-stop", { hold: "roder", delegatedAt: 2 }),
    worker("done", { delegatedAt: 1 }),
  ];
  const groups = workerGroups(workers, [{ id: "i1", number: 7 } as Issue]);
  expect(groups.running.map((row) => [row.worker.threadId, row.issue?.number])).toEqual([["run", 7]]);
  expect(groups.queued.map((row) => row.worker.threadId)).toEqual(["q1", "q2"]);
  expect(groups.stopped.map((row) => [row.worker.threadId, row.reason, row.attention])).toEqual([
    ["held", "Stopped by you. The Roder needs you before it messages this thread again.", true],
    ["failed", "Worktree could not be created", true],
    ["roder-stop", "Stopped by the Roder", false],
    ["done", "Its last turn ended", false],
  ]);
  // The slice 7 seam: a supervision event explains an otherwise quiet stop.
  const withEvents = workerGroups(
    workers,
    [],
    [
      { id: "e1", threadId: "done", kind: "settled", summary: "", at: 1, acknowledged: false },
      { id: "e2", threadId: "done", kind: "needsInput", summary: "Approve the push", at: 2, acknowledged: false },
    ],
  );
  expect(withEvents.stopped.at(-1)).toMatchObject({ reason: "Waiting for input: Approve the push", attention: true });
});

const entry = (id: string, kind: IssueActivity["kind"], patch: Partial<IssueActivity> = {}): IssueActivity => ({
  id,
  createdAt: "2026-01-01T00:00:00.000Z",
  actor: { type: "roder" },
  kind,
  text: id,
  ...patch,
});

test("issue activity reads as a conversation with quiet runs folded and needs-you changes kept visible", () => {
  const items = issueTimeline([
    entry("created", "created"),
    entry("u1", "updated"),
    entry("u2", "thread"),
    entry("q", "question"),
    entry("u3", "updated"),
    entry("asked", "updated", { changes: [{ field: "status", before: "in_progress", after: "needs_you" }] }),
    entry("c", "comment", { actor: { type: "user" } }),
  ]);
  expect(
    items.map((item) => (item.type === "group" ? item.entries.map((e) => e.id) : `${item.type}:${item.entry.id}`)),
  ).toEqual([["created", "u1", "u2"], "card:q", "event:u3", "event:asked", "card:c"]);
});

const threads = [{ id: "worker-1", name: "Wire the API", preview: "" }];
const needsYouIssue: Issue = {
  id: "issue-1",
  number: 12,
  projectId: "p1",
  title: "Pick the API",
  description: "",
  status: "needs_you",
  priority: "normal",
  owner: { type: "user" },
  doneCriteria: "",
  outOfScope: "",
  parent: null,
  threadIds: ["worker-1"],
  pullRequests: [{ url: "https://github.com/example/repo/pull/55", title: "Wire it" }],
  activity: [entry("q1", "question", { actor: { type: "thread", threadId: "worker-1" }, text: "Which API?" })],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

test("a needs-you issue offers an answer that names who takes it back, with owner, threads and PR badges", () => {
  const html = renderToStaticMarkup(
    createElement(IssueConversation, { issue: needsYouIssue, threads, onComment: async () => {} }),
  );
  expect(html).toContain('aria-label="Owner: You"');
  expect(html).toContain("Needs your answer");
  expect(html).toContain("Answer and hand back");
  expect(html).toContain("Hands the issue back to Wire the API.");
  expect(html).toContain("#55 Wire it");
  expect(html).toContain("Threads 1");
  // Without a comment handler the conversation is read-only.
  expect(renderToStaticMarkup(createElement(IssueConversation, { issue: needsYouIssue, threads }))).not.toContain(
    "Answer and hand back",
  );
});

test("the Overview tab lists what needs you before the board", () => {
  const agent = {
    id: "roder-1",
    name: "Release Roder",
    mission: "Ship the desktop app",
    threadId: roderThreadId,
    enabled: true,
    active: null,
    sprite: null,
    workers: [worker("worker-1", { state: "running", issueId: "issue-1" })],
    outbox: [],
    maxConcurrentWorkers: 2,
    maxFollowups: 3,
  } as unknown as RoderAgent;
  const project = {
    id: "p1",
    name: "Desktop",
    description: "",
    workspaceId: null,
    roderThreadId,
    archived: false,
    createdAt: "",
    updatedAt: "",
  };
  const html = renderToStaticMarkup(
    createElement(RoderAgentView, {
      roder: agent,
      files: [],
      projects: [project],
      issues: [needsYouIssue, { ...needsYouIssue, id: "issue-2", number: 13, status: "todo", activity: [] }],
      threads,
      onComment: async () => {},
      onOpenThread: () => {},
      onOpenPullRequest: () => {},
    }),
  );
  expect(html).toContain('aria-label="1 need you"');
  expect(html).toContain("1 thread working");
  const needsYou = html.indexOf('aria-label="Needs you"');
  expect(needsYou).toBeGreaterThan(-1);
  expect(needsYou).toBeLessThan(html.indexOf('aria-label="Issues by status"'));
  expect(html.indexOf('aria-label="Issues by status"')).toBeLessThan(html.indexOf('aria-label="Threads summary"'));
  expect(html.indexOf('aria-label="Threads summary"')).toBeLessThan(html.indexOf('aria-label="Pull requests"'));
});

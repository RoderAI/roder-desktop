import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { IssuesService } from "../electron/issues/service";
import type { Issue, IssueActor } from "../src/types/issues";

const user = { type: "user" } as const;
const agent = { type: "agent", threadId: "worker-thread" } as const;
const roder = { type: "agent", threadId: "roder-thread" } as const;
const pr = "https://github.com/team/repo/pull/7";

const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "roder-issue-lifecycle-"));
  directories.push(directory);
  const changed = vi.fn<() => void>();
  const service = new IssuesService({
    storagePath: join(directory, "issues.json"),
    onEvent: changed,
    launchIssue: async () => ({ threadId: "launched-thread" }),
  });
  const { project } = await service.request(
    "desktop/projects/create",
    { name: "Desktop", workspaceId: "ws-1", roderThreadId: roder.threadId },
    user,
  );
  const create = async (fields: Record<string, unknown> = {}) =>
    (await service.request("desktop/issues/create", { projectId: project.id, title: "Work", ...fields }, user)).issue;
  return { service, project, create, changed };
}

type Setup = Awaited<ReturnType<typeof setup>>;
type Case = {
  name: string;
  refusal: string;
  call: (s: Setup) => Promise<{ method: string; params: Record<string, unknown> }>;
};

// Each refusal from zuse crates/engine/src/zappers/issues.rs:28-45 (create)
// and :557-595 (transition) applies to agents; the same call by the user
// goes through.
const refusals: Case[] = [
  {
    name: "create in todo without doneCriteria",
    refusal: "add doneCriteria",
    call: async ({ project }) => ({
      method: "desktop/issues/create",
      params: { projectId: project.id, title: "Next", status: "todo" },
    }),
  },
  {
    name: "create for the user",
    refusal: "create the issue for yourself, then hand it over with issues_ask_user",
    call: async ({ project }) => ({
      method: "desktop/issues/create",
      params: { projectId: project.id, title: "Ask", owner: { type: "user" } },
    }),
  },
  {
    name: "create outside backlog or todo",
    refusal: "new issues start in backlog or todo",
    call: async ({ project }) => ({
      method: "desktop/issues/create",
      params: { projectId: project.id, title: "Started", status: "in_progress", doneCriteria: "Tests pass" },
    }),
  },
  {
    name: "move to done without closing",
    refusal: "close issues with issues_close",
    call: async ({ create }) => ({
      method: "desktop/issues/update",
      params: { id: (await create()).id, status: "done" },
    }),
  },
  {
    name: "move to cancelled without closing",
    refusal: "close issues with issues_close",
    call: async ({ create }) => ({
      method: "desktop/issues/update",
      params: { id: (await create()).id, status: "cancelled" },
    }),
  },
  {
    name: "move to in_review without a pull request",
    refusal: "link the pull request with issues_link_pull_request before moving the issue to in_review",
    call: async ({ create }) => ({
      method: "desktop/issues/update",
      params: { id: (await create()).id, status: "in_review" },
    }),
  },
  {
    name: "move to in_progress without a thread",
    refusal: "an issue is in_progress only while a thread works on it",
    call: async ({ create }) => ({
      method: "desktop/issues/update",
      params: { id: (await create()).id, status: "in_progress" },
    }),
  },
  {
    name: "move to needs_you without askUser",
    refusal: "hand the issue to the user with issues_ask_user",
    call: async ({ create }) => ({
      method: "desktop/issues/update",
      params: { id: (await create()).id, status: "needs_you" },
    }),
  },
  {
    name: "make the user the owner without askUser",
    refusal: "hand the issue to the user with issues_ask_user",
    call: async ({ create }) => ({
      method: "desktop/issues/update",
      params: { id: (await create()).id, owner: { type: "user" } },
    }),
  },
  {
    name: "move out of backlog without doneCriteria",
    refusal: "add doneCriteria: what must be true for this issue to be done",
    call: async ({ create }) => ({
      method: "desktop/issues/update",
      params: { id: (await create()).id, status: "todo" },
    }),
  },
  {
    name: "move to blocked without doneCriteria",
    refusal: "add doneCriteria: what must be true for this issue to be done",
    call: async ({ create }) => ({
      method: "desktop/issues/update",
      params: { id: (await create()).id, status: "blocked" },
    }),
  },
  {
    name: "launch a closed issue a thread still owns",
    refusal: "reopen the issue before starting work",
    call: async ({ service, create }) => {
      const issue = await create({ owner: { type: "thread", threadId: "old-thread" } });
      await service.request("desktop/issues/close", { id: issue.id, outcome: "dropped", note: "Moot" }, user);
      return { method: "desktop/issues/launch", params: { id: issue.id } };
    },
  },
  {
    name: "clear doneCriteria",
    refusal: "keep the issue's doneCriteria; edit it rather than clearing it",
    call: async ({ create }) => ({
      method: "desktop/issues/update",
      params: { id: (await create({ doneCriteria: "Tests pass" })).id, doneCriteria: " " },
    }),
  },
];

test.each(refusals)("agents are refused: $name; the user is not", async ({ refusal, call }) => {
  const s = await setup();
  const { method, params } = await call(s);
  await expect(s.service.request(method, params, agent)).rejects.toThrow(refusal);
  await expect(s.service.request(method, params, roder)).rejects.toThrow(refusal);
  await expect(s.service.request(method, params, user)).resolves.toMatchObject({ issue: expect.any(Object) });
});

test("agents move issues forward once the evidence exists", async () => {
  const { service, create } = await setup();
  const issue = await create({ status: "todo", doneCriteria: "Ships" });
  // Taking the issue links the thread, which is the evidence for in_progress.
  const { issue: started } = await service.request(
    "desktop/issues/update",
    { id: issue.id, owner: { type: "thread", threadId: agent.threadId }, status: "in_progress" },
    agent,
  );
  expect(started).toMatchObject({ status: "in_progress", threadIds: [agent.threadId] });
  await service.request("desktop/issues/linkPullRequest", { id: issue.id, url: pr, title: "Fix" }, agent);
  const { issue: review } = await service.request(
    "desktop/issues/update",
    { id: issue.id, status: "in_review" },
    agent,
  );
  expect(review.status).toBe("in_review");
  const { issue: edited } = await service.request(
    "desktop/issues/update",
    { id: issue.id, doneCriteria: "Ships and is documented" },
    agent,
  );
  expect(edited.doneCriteria).toBe("Ships and is documented");
});

test("a parent issue is in_progress while one of its children is", async () => {
  const { service, create } = await setup();
  const parent = await create({ title: "Request", doneCriteria: "Every part ships" });
  const child = await create({ title: "Part", parent: parent.id });
  await expect(
    service.request("desktop/issues/update", { id: parent.id, status: "in_progress" }, agent),
  ).rejects.toThrow("in_progress only while a thread works on it");
  await service.request("desktop/issues/launch", { id: child.id }, agent);
  const { issue } = await service.request("desktop/issues/update", { id: parent.id, status: "in_progress" }, agent);
  expect(issue.status).toBe("in_progress");
});

// Parity with zuse transition(): the evidence is any linked thread, and it is
// asked for only when the status changes into in_progress.
test("a thread that no longer owns the issue still counts as in_progress evidence", async () => {
  const { service, create } = await setup();
  const issue = await create({ owner: { type: "thread", threadId: "old-thread" }, doneCriteria: "Ships" });
  await service.request("desktop/issues/update", { id: issue.id, owner: { type: "roder" } }, user);
  const { issue: moved } = await service.request(
    "desktop/issues/update",
    { id: issue.id, status: "in_progress" },
    agent,
  );
  expect(moved).toMatchObject({ status: "in_progress", owner: { type: "roder" } });
});

test("updates that leave the status in_progress ask for no evidence", async () => {
  const { service, create } = await setup();
  const issue = await create({ status: "in_progress", doneCriteria: "Ships" });
  const { issue: renamed } = await service.request("desktop/issues/update", { id: issue.id, title: "Renamed" }, agent);
  expect(renamed).toMatchObject({ status: "in_progress", title: "Renamed", threadIds: [] });
  await service.request(
    "desktop/issues/update",
    { id: issue.id, owner: { type: "thread", threadId: agent.threadId } },
    agent,
  );
  const { issue: released } = await service.request(
    "desktop/issues/update",
    { id: issue.id, owner: { type: "roder" } },
    agent,
  );
  expect(released).toMatchObject({ status: "in_progress", owner: { type: "roder" } });
});

test("close: merged needs a linked pull request and a note; dropped cancels", async () => {
  const { service, create } = await setup();
  const issue = await create();
  for (const actor of [agent, user] as IssueActor[])
    await expect(
      service.request("desktop/issues/close", { id: issue.id, outcome: "merged", note: "Shipped" }, actor),
    ).rejects.toThrow("link the merged pull request before closing the issue as merged");
  await expect(
    service.request("desktop/issues/close", { id: issue.id, outcome: "dropped", note: " " }, agent),
  ).rejects.toThrow("note must be a non-empty string");
  await expect(
    service.request("desktop/issues/close", { id: issue.id, outcome: "shelved", note: "x" }, agent),
  ).rejects.toThrow("Invalid issue outcome");
  await service.request("desktop/issues/linkPullRequest", { id: issue.id, url: pr }, agent);
  const { issue: merged } = await service.request(
    "desktop/issues/close",
    { id: issue.id, outcome: "merged", note: "Shipped" },
    agent,
  );
  expect(merged.status).toBe("done");
  expect(merged.activity.at(-1)).toMatchObject({ kind: "closed", text: "Merged · Shipped" });
  const other = await create();
  const { issue: dropped } = await service.request(
    "desktop/issues/close",
    { id: other.id, outcome: "dropped", note: "Not needed" },
    agent,
  );
  expect(dropped.status).toBe("cancelled");
});

test.each(["merged", "dropped"])("closing an issue already closed as %s changes nothing", async (outcome) => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-01-01T00:00:00Z") });
  const { service, create, changed } = await setup();
  const issue = await create();
  await service.request("desktop/issues/linkPullRequest", { id: issue.id, url: pr }, agent);
  const { issue: closed } = await service.request(
    "desktop/issues/close",
    { id: issue.id, outcome, note: "First" },
    agent,
  );
  vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
  changed.mockClear();
  for (const actor of [agent, user] as IssueActor[])
    for (const again of ["merged", "dropped"])
      expect(
        await service.request("desktop/issues/close", { id: issue.id, outcome: again, note: "Again" }, actor),
      ).toEqual({ issue: closed });
  expect(changed).not.toHaveBeenCalled();
  expect((await service.request("desktop/issues/read", { id: issue.id })).issue).toEqual(closed);
});

test("deleting a parent records the removal on each child", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-01-01T00:00:00Z") });
  const { service, create } = await setup();
  const parent = await create({ title: "Request" });
  const children = [
    await create({ title: "First", parent: parent.id }),
    await create({ title: "Second", parent: parent.id }),
  ];
  const bystander = await create({ title: "Unrelated" });
  vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
  await service.request("desktop/issues/delete", { id: parent.id }, agent);
  for (const child of children) {
    const { issue } = await service.request("desktop/issues/read", { id: child.id });
    expect(issue).toMatchObject({ parent: null, updatedAt: "2026-01-02T00:00:00.000Z" });
    expect(issue.activity).toHaveLength(child.activity.length + 1);
    expect(issue.activity.at(-1)).toMatchObject({
      kind: "updated",
      text: "Parent issue deleted",
      createdAt: "2026-01-02T00:00:00.000Z",
      actor: { type: "thread", threadId: agent.threadId },
      changes: [{ field: "parent", before: parent.id, after: null }],
    });
  }
  expect((await service.request("desktop/issues/read", { id: bystander.id })).issue).toEqual(bystander);
});

test("askUser makes the user the owner and the issue needs_you, recording the asking thread", async () => {
  const { service, create } = await setup();
  const issue = await create();
  await service.request("desktop/issues/launch", { id: issue.id }, user);
  const { issue: asked } = await service.request(
    "desktop/issues/askUser",
    { id: issue.id, question: "Which API?", recommendation: "The new one" },
    { type: "agent", threadId: "launched-thread" },
  );
  expect(asked).toMatchObject({ owner: { type: "user" }, status: "needs_you" });
  expect(asked.activity.at(-1)).toMatchObject({
    kind: "question",
    actor: { type: "thread", threadId: "launched-thread" },
    threadId: "launched-thread",
    text: "Which API?\n\nRecommendation: The new one",
  });
  await service.request("desktop/issues/close", { id: issue.id, outcome: "dropped", note: "Moot" }, user);
  await expect(service.request("desktop/issues/askUser", { id: issue.id, question: "Still?" }, agent)).rejects.toThrow(
    "reopen the issue before asking about it",
  );
});

test("the user's comment on a needs_you issue hands it back to the newest linked thread", async () => {
  const { service, create } = await setup();
  const issue = await create();
  for (const threadId of ["older-thread", "newer-thread"])
    await service.request("desktop/issues/update", { id: issue.id, owner: { type: "thread", threadId } }, user);
  await service.request("desktop/issues/update", { id: issue.id, owner: { type: "roder" } }, user);
  await service.request("desktop/issues/askUser", { id: issue.id, question: "Go?" }, roder);
  // An agent's comment is not the user's answer.
  const { issue: still } = await service.request("desktop/issues/comment", { id: issue.id, text: "Ping" }, agent);
  expect(still).toMatchObject({ owner: { type: "user" }, status: "needs_you" });
  const { issue: answered } = await service.request("desktop/issues/comment", { id: issue.id, text: "Yes" }, user);
  expect(answered).toMatchObject({
    owner: { type: "thread", threadId: "newer-thread" },
    status: "in_progress",
  });
  expect(answered.activity.at(-1)).toMatchObject({
    kind: "comment",
    actor: { type: "user" },
    text: "Yes",
    changes: [
      { field: "owner", before: "user", after: "newer-thread" },
      { field: "status", before: "needs_you", after: "in_progress" },
    ],
  });
});

test("without a linked thread the user's answer hands the issue to the Roder", async () => {
  const { service, create } = await setup();
  const issue = await create({ status: "todo", doneCriteria: "Done" });
  await service.request("desktop/issues/askUser", { id: issue.id, question: "Scope?" }, roder);
  const { issue: answered } = await service.request("desktop/issues/comment", { id: issue.id, text: "Small" }, user);
  expect(answered).toMatchObject({ owner: { type: "roder" }, status: "todo" });
});

test("activity records creation, status changes, comments, questions and pull requests", async () => {
  const { service, create } = await setup();
  const issue = await create();
  await service.request("desktop/issues/update", { id: issue.id, status: "todo", doneCriteria: "Done" }, roder);
  await service.request("desktop/issues/comment", { id: issue.id, text: "Looking" }, agent);
  await service.request("desktop/issues/linkPullRequest", { id: issue.id, url: `${pr}/`, title: "Fix" }, agent);
  await service.request("desktop/issues/linkPullRequest", { id: issue.id, url: pr, title: "Again" }, agent);
  const { issue: asked } = await service.request("desktop/issues/askUser", { id: issue.id, question: "OK?" }, roder);
  expect(asked.pullRequests).toEqual([{ url: pr, title: "Fix" }]);
  expect(asked.activity.map((entry: Issue["activity"][number]) => [entry.kind, entry.actor.type])).toEqual([
    ["created", "user"],
    ["updated", "roder"],
    ["comment", "thread"],
    ["pullRequest", "thread"],
    ["question", "roder"],
  ]);
  expect(asked.activity[1]).toMatchObject({
    text: "Status changed to Todo",
    changes: [
      { field: "status", before: "backlog", after: "todo" },
      { field: "doneCriteria", before: null, after: null },
    ],
  });
});

test("pull request links must be HTTPS GitHub pull request URLs", async () => {
  const { service, create } = await setup();
  const issue = await create();
  for (const url of [
    "http://github.com/team/repo/pull/1",
    "https://github.com/team/repo/issues/1",
    "https://github.com/team/repo/pull/1?x=1",
    "javascript:alert(1)",
  ])
    await expect(service.request("desktop/issues/linkPullRequest", { id: issue.id, url }, user)).rejects.toThrow(
      /GitHub pull request URL/,
    );
});

test("every change needs an actor; reads do not", async () => {
  const { service, create, project } = await setup();
  const issue = await create();
  await expect(service.request("desktop/issues/update", { id: issue.id, title: "X" })).rejects.toThrow(
    "Issue changes need an actor",
  );
  await expect(service.request("desktop/projects/create", { name: "X" })).rejects.toThrow(
    "Issue changes need an actor",
  );
  await expect(
    service.request("desktop/issues/comment", { id: issue.id, text: "X" }, { type: "agent", threadId: " " }),
  ).rejects.toThrow("actor threadId must be a non-empty string");
  expect((await service.request("desktop/issues/list", { projectId: project.id })).issues).toHaveLength(1);
});

test("parents must be other existing issues in the same project, without cycles", async () => {
  const { service, create } = await setup();
  const { project: other } = await service.request("desktop/projects/create", { name: "Other" }, user);
  const a = await create();
  const b = await create({ parent: a.id });
  await expect(service.request("desktop/issues/update", { id: a.id, parent: a.id }, user)).rejects.toThrow(
    "can't be its own parent",
  );
  await expect(service.request("desktop/issues/update", { id: a.id, parent: "missing" }, user)).rejects.toThrow(
    "doesn't exist",
  );
  await expect(service.request("desktop/issues/update", { id: a.id, parent: b.id }, user)).rejects.toThrow("cycle");
  await expect(service.request("desktop/issues/update", { id: b.id, projectId: other.id }, user)).rejects.toThrow(
    "same project",
  );
  await service.request("desktop/issues/delete", { id: a.id }, user);
  expect((await service.request("desktop/issues/read", { id: b.id })).issue.parent).toBeNull();
});

test("a person moving the status alone moves the owner with it", async () => {
  const { service, create } = await setup();
  const issue = await create();
  const { issue: waiting } = await service.request(
    "desktop/issues/update",
    { id: issue.id, status: "needs_you" },
    user,
  );
  expect(waiting.owner).toEqual({ type: "user" });
  const { issue: back } = await service.request("desktop/issues/update", { id: issue.id, status: "todo" }, user);
  expect(back).toMatchObject({ owner: { type: "roder" }, status: "todo" });
});

test("agents fill in doneCriteria and then move the issue out of backlog", async () => {
  const { service, create } = await setup();
  const issue = await create();
  const { issue: todo } = await service.request(
    "desktop/issues/update",
    { id: issue.id, status: "todo", doneCriteria: "Tests pass" },
    agent,
  );
  expect(todo).toMatchObject({ status: "todo", doneCriteria: "Tests pass" });
});

test("the user's launch of a closed issue a thread owns opens that thread", async () => {
  const { service, create } = await setup();
  const issue = await create({ owner: { type: "thread", threadId: "old-thread" } });
  await service.request("desktop/issues/close", { id: issue.id, outcome: "dropped", note: "Moot" }, user);
  const result = await service.request("desktop/issues/launch", { id: issue.id }, user);
  expect(result).toMatchObject({ threadId: "old-thread", issue: { status: "cancelled" } });
});

test("an issue with children can't move to another project until they are moved or detached", async () => {
  const { service, create } = await setup();
  const { project: other } = await service.request("desktop/projects/create", { name: "Other" }, user);
  const parent = await create({ title: "Request" });
  const child = await create({ title: "Part", parent: parent.id });
  for (const actor of [agent, user] as IssueActor[])
    await expect(
      service.request("desktop/issues/update", { id: parent.id, projectId: other.id }, actor),
    ).rejects.toThrow("move or detach this issue's child issues before moving it to another project");
  expect((await service.request("desktop/issues/read", { id: parent.id })).issue.projectId).not.toBe(other.id);
  await service.request("desktop/issues/update", { id: child.id, parent: null }, user);
  const { issue: moved } = await service.request("desktop/issues/update", { id: parent.id, projectId: other.id }, user);
  expect(moved.projectId).toBe(other.id);
});

test("owners carry a threadId exactly when the owner is a thread", async () => {
  const { service, create } = await setup();
  const issue = await create();
  for (const owner of [{ type: "roder", threadId: "x" }, { type: "user", threadId: "x" }, { type: "thread" }])
    await expect(service.request("desktop/issues/update", { id: issue.id, owner }, user)).rejects.toThrow(
      /owner must be|owner threadId/,
    );
});

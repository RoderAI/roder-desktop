import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, test } from "vitest";
import { IssuesService } from "../electron/issues/service";
import { createRoderAgentService } from "../electron/roder-agents/service";
import { roderWorkerThreadStarter, type StartWorkerThread } from "../electron/roder-agents/workers";
import { DesktopWorktrees } from "../electron/worktrees/desktop-worktrees";
import { GitWorktrees } from "../electron/worktrees/git-worktrees";
import type { Issue } from "../src/types/issues";
import type { RoderAgentDetail, RoderWorker } from "../src/types/roder-agents";
import type { Workspace } from "../src/types/roder";

const directories: string[] = [];
const services: { stop: () => Promise<void> }[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop();
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "commit.gpgSign=false", "-c", "user.name=Test", "-c", "user.email=test@example.com", "-C", cwd, ...args],
    { encoding: "utf8" },
  ).trim();
}

type Call = { method: string; params: Record<string, unknown> };
type Result = { revision: number; summary: string; issue?: Issue; worker?: RoderWorker };

/**
 * A fake engine: one workspace whose default folder is `repo`, threads that
 * are idle until a turn starts and stay busy until the test settles them.
 */
function engine(repo: string) {
  const calls: Call[] = [];
  let workspace: Workspace = {
    id: "ws",
    name: "Project",
    defaultRootId: "root",
    roots: [{ id: "root", path: repo, name: "repo" }],
  } as unknown as Workspace;
  const threads = new Map<string, { busy: boolean; turns: number }>();
  let workers = 0;
  let roderThreads = 0;
  const request = async (method: string, value: unknown): Promise<unknown> => {
    const params = (value ?? {}) as Record<string, unknown>;
    calls.push({ method, params });
    if (method === "workspace/list") return { workspaces: [workspace] };
    if (method === "workspace/update") {
      const roots = params.roots as { path: string; name: string }[];
      workspace = {
        ...workspace,
        roots: roots.map((root, at) => ({ id: at === 0 ? "root" : `root-${at}`, ...root })),
      } as Workspace;
      return { workspace };
    }
    if (method === "thread/start") {
      const id = params.cwd
        ? `worker-${++workers}`
        : ++roderThreads === 1
          ? "roder-thread"
          : `roder-thread-${roderThreads}`;
      threads.set(id, { busy: false, turns: 0 });
      return { thread: { id } };
    }
    if (method === "thread/read") {
      const thread = threads.get(params.threadId as string);
      if (!thread) return { thread: null };
      return {
        thread: {
          id: params.threadId,
          status: { type: thread.busy ? "active" : "idle" },
          turns: Array.from({ length: thread.turns }, (_, at) => ({ id: `turn-${at}` })),
        },
      };
    }
    if (method === "turn/start") {
      const thread = threads.get(params.threadId as string)!;
      thread.busy = true;
      thread.turns++;
      return { turnId: `turn-${thread.turns}` };
    }
    if (method === "turn/interrupt") {
      threads.get(params.threadId as string)!.busy = false;
      return {};
    }
    if (method === "memory/query") return { results: [] };
    return {};
  };
  const turns = (threadId: string) =>
    calls.filter((call) => call.method === "turn/start" && call.params.threadId === threadId);
  const settle = (threadId: string) => {
    threads.get(threadId)!.busy = false;
  };
  return { request, calls, turns, settle };
}

/** A stand-in for the host's worktree + thread step, for tests that don't need git. */
function fakeStarter(request: (method: string, params: unknown) => Promise<unknown>): StartWorkerThread {
  return async (spec) => {
    const started = (await request("thread/start", {
      workspaceId: spec.workspaceId,
      cwd: `/worktrees/${spec.branch}`,
    })) as {
      thread: { id: string };
    };
    return {
      threadId: started.thread.id,
      worktreePath: `/worktrees/${spec.branch}`,
      branch: spec.branch,
      base: spec.base ?? "origin/main",
    };
  };
}

async function setup(options: { repo?: string; git?: boolean } = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "roder-workers-test-")));
  directories.push(directory);
  const repo = options.repo ?? join(directory, "repo");
  const fake = engine(repo);
  const issues: IssuesService = new IssuesService({
    storagePath: join(directory, "issues", "issues.json"),
    launchIssue: async (issue, project) => (await roders.launchIssue(project.roderThreadId!, issue))!,
  });
  const startWorker = options.git
    ? roderWorkerThreadStarter({
        worktrees: new DesktopWorktrees(new GitWorktrees(join(directory, "managed")), fake.request),
        request: fake.request,
      })
    : fakeStarter(fake.request);
  const roders = createRoderAgentService({
    directory: join(directory, "roders"),
    request: fake.request,
    issues,
    startWorker,
  });
  services.push(roders);
  await roders.start();
  const roder = (await roders.handleRequest("desktop/roders/create", {
    name: "Release",
    mission: "Ship releases",
    workspaceId: "ws",
  })) as RoderAgentDetail;
  await issues.request(
    "desktop/projects/ensureWorkspace",
    { workspaceId: "ws", name: "Release", roderThreadId: roder.threadId },
    { type: "user" },
  );
  const command = (action: unknown, threadId = roder.threadId) =>
    roders.handleTool(
      "roder_command",
      { commandId: randomUUID(), roderId: roder.id, action },
      { threadId },
    ) as Promise<Result>;
  const createIssue = async (title: string) =>
    (await command({ type: "createIssue", details: { title, status: "todo", doneCriteria: `${title} works` } })).issue!;
  const delegate = (issue: Issue, extra: Record<string, unknown> = {}) =>
    command({ type: "delegate", issueId: issue.id, worker: { objective: `Do ${issue.title}` }, ...extra });
  const read = async () => (await roders.handleRequest("desktop/roders/read", { id: roder.id })) as RoderAgentDetail;
  const worker = async (threadId: string) => (await read()).workers.find((entry) => entry.threadId === threadId);
  const issue = async (id: string) => (await issues.request("desktop/issues/read", { id })).issue;
  /** The engine finished a worker's turn and said so. */
  const finish = async (threadId: string) => {
    fake.settle(threadId);
    await roders.onNotification("turn/completed", { threadId, turn: { id: "t" } });
  };
  return { directory, repo, fake, issues, roders, roder, command, createIssue, delegate, read, worker, issue, finish };
}

async function makeRepo(path: string) {
  await mkdir(path, { recursive: true });
  git(path, "init", "-b", "main");
  await writeFile(join(path, "app.txt"), "v1\n");
  git(path, "add", "app.txt");
  git(path, "commit", "-m", "v1");
}

test("a delegated worker runs in a new worktree on its own branch from the requested base; the primary checkout is untouched", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "roder-workers-repo-")));
  directories.push(directory);
  const repo = join(directory, "repo");
  await makeRepo(repo);
  const release = git(repo, "rev-parse", "HEAD");
  git(repo, "branch", "release");
  await writeFile(join(repo, "app.txt"), "v2\n");
  git(repo, "commit", "-am", "v2");
  const mainHead = git(repo, "rev-parse", "HEAD");
  // Uncommitted and untracked work in the primary checkout must survive.
  await writeFile(join(repo, "app.txt"), "local edits\n");
  await writeFile(join(repo, "notes.txt"), "untracked\n");
  const status = git(repo, "status", "--porcelain");

  const { fake, createIssue, delegate, issue, worker } = await setup({ repo, git: true });
  const work = await createIssue("Fix the release");
  const result = await delegate(work, { base: "release" });

  const delegated = result.worker!;
  const start = fake.calls.find((call) => call.method === "thread/start" && call.params.cwd)!;
  expect(start.params.cwd).toBe(delegated.worktreePath);
  expect(delegated.worktreePath).not.toBe(repo);
  expect(delegated.base).toBe("release");
  expect(delegated.branch).toMatch(/^roder\/issue-1-[0-9a-f]{8}$/);
  expect(git(delegated.worktreePath, "branch", "--show-current")).toBe(delegated.branch);
  expect(git(delegated.worktreePath, "rev-parse", "HEAD")).toBe(release);
  expect(await readFile(join(delegated.worktreePath, "app.txt"), "utf8")).toBe("v1\n");

  // The primary checkout: same branch, same commit, same local changes.
  expect(git(repo, "branch", "--show-current")).toBe("main");
  expect(git(repo, "rev-parse", "HEAD")).toBe(mainHead);
  expect(git(repo, "status", "--porcelain")).toBe(status);
  expect(await readFile(join(repo, "app.txt"), "utf8")).toBe("local edits\n");

  // The worktree became a workspace folder and the thread started there.
  const update = fake.calls.find((call) => call.method === "workspace/update")!;
  expect((update.params.roots as { path: string }[]).map((root) => root.path)).toEqual([repo, delegated.worktreePath]);

  // The issue: linked to the thread, owned by it, in progress.
  expect(await issue(work.id)).toMatchObject({
    status: "in_progress",
    owner: { type: "thread", threadId: delegated.threadId },
    threadIds: [delegated.threadId],
  });

  // The objective went out with the worker brief, WORKERS.md and the linked issue.
  const [turn] = fake.turns(delegated.threadId);
  expect(JSON.stringify(turn.params.input)).toContain("Do Fix the release");
  const context = turn.params.developerContext as string;
  expect(context).toContain('You are a thread working for the Roder "Release"');
  expect(context).toContain('"Status: done" or "Status: blocked"');
  expect(context).toContain(delegated.worktreePath);
  expect(context).toContain(`"issueId":"${work.id}"`);
  expect(await worker(delegated.threadId)).toMatchObject({ state: "running", queuePosition: null });
});

test("with no base, a worker branches from the repository's default branch at origin, not the local HEAD", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "roder-workers-origin-")));
  directories.push(directory);
  const upstream = join(directory, "upstream");
  await makeRepo(upstream);
  const repo = join(directory, "clone");
  execFileSync("git", ["clone", "--quiet", upstream, repo]);
  // Upstream moves on after the clone: the worker should start from the fetched tip.
  await writeFile(join(upstream, "app.txt"), "upstream v2\n");
  git(upstream, "commit", "-am", "upstream v2");
  const originMain = git(upstream, "rev-parse", "HEAD");
  await writeFile(join(repo, "app.txt"), "local commit\n");
  git(repo, "commit", "-am", "local only");
  const localHead = git(repo, "rev-parse", "HEAD");

  const { createIssue, delegate } = await setup({ repo, git: true });
  const { worker } = await delegate(await createIssue("Default base"));

  expect(worker!.base).toBe("origin/main");
  expect(git(worker!.worktreePath, "rev-parse", "HEAD")).toBe(originMain);
  expect(git(repo, "rev-parse", "HEAD")).toBe(localHead);
  expect(git(repo, "branch", "--show-current")).toBe("main");
});

test("a base that isn't a commit is refused before any worktree or thread is made", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "roder-workers-bad-base-")));
  directories.push(directory);
  const repo = join(directory, "repo");
  await makeRepo(repo);
  const { fake, createIssue, delegate, issue, read } = await setup({ repo, git: true });
  const work = await createIssue("Bad base");
  await expect(delegate(work, { base: "no-such-branch" })).rejects.toThrow(/not a Git branch, tag or commit/);
  await expect(delegate(work, { base: "--upload-pack=evil" })).rejects.toThrow(/not a Git branch/);
  expect(fake.calls.some((call) => call.method === "thread/start" && call.params.cwd)).toBe(false);
  expect(git(repo, "worktree", "list").split("\n")).toHaveLength(1);
  expect((await issue(work.id)).status).toBe("todo");
  expect((await read()).workers).toEqual([]);
});

test("with the limit at 1, a second delegate is queued at position 1 and starts when the first worker goes idle", async () => {
  const { fake, roders, roder, createIssue, delegate, worker, finish, issue } = await setup();
  await roders.handleRequest("desktop/roders/update", { id: roder.id, maxConcurrentWorkers: 1 });
  const first = (await delegate(await createIssue("First"))).worker!;
  expect(await worker(first.threadId)).toMatchObject({ state: "running", queuePosition: null });

  const secondIssue = await createIssue("Second");
  const second = await delegate(secondIssue);
  expect(second.worker).toMatchObject({ state: "queued", queuePosition: 1 });
  expect(second.summary).toContain("queued at position 1");
  const third = (await delegate(await createIssue("Third"))).worker!;
  expect(third.queuePosition).toBe(2);
  // Queued workers already own their issues; their objectives haven't gone out.
  expect(await issue(secondIssue.id)).toMatchObject({
    status: "in_progress",
    owner: { type: "thread", threadId: second.worker!.threadId },
  });
  expect(fake.turns(second.worker!.threadId)).toHaveLength(0);

  await finish(first.threadId);
  expect(await worker(first.threadId)).toMatchObject({ state: "idle" });
  expect(await worker(second.worker!.threadId)).toMatchObject({ state: "running", queuePosition: null });
  expect(fake.turns(second.worker!.threadId)).toHaveLength(1);
  expect(await worker(third.threadId)).toMatchObject({ state: "queued", queuePosition: 1 });
  expect(fake.turns(third.threadId)).toHaveLength(0);

  // A missed notification is caught up on the next tick.
  fake.settle(second.worker!.threadId);
  await roders.tick();
  expect(await worker(third.threadId)).toMatchObject({ state: "running", queuePosition: null });
});

test("raising the limit starts queued workers", async () => {
  const { roders, roder, createIssue, delegate, worker } = await setup();
  await roders.handleRequest("desktop/roders/update", { id: roder.id, maxConcurrentWorkers: 1 });
  await delegate(await createIssue("First"));
  const second = (await delegate(await createIssue("Second"))).worker!;
  expect(second.queuePosition).toBe(1);
  await roders.handleRequest("desktop/roders/update", { id: roder.id, maxConcurrentWorkers: 2 });
  expect(await worker(second.threadId)).toMatchObject({ state: "running", queuePosition: null });
});

test("the follow-up limit refuses automatic messages past it, and a user message resets it", async () => {
  const { fake, roders, roder, command, createIssue, delegate, worker, finish } = await setup();
  await roders.handleRequest("desktop/roders/update", { id: roder.id, maxFollowups: 2 });
  const { threadId } = (await delegate(await createIssue("Follow ups"))).worker!;
  const followUp = (text: string) => command({ type: "messageWorker", threadId, text, automatic: true });

  await finish(threadId);
  expect((await followUp("Also add a test")).summary).toContain("1 of 2");
  await finish(threadId);
  expect((await followUp("And the docs")).summary).toContain("2 of 2");
  await finish(threadId);
  await expect(followUp("One more")).rejects.toThrow(
    "automatic follow-up limit reached (2 of 2); askUser before sending this thread more work",
  );
  expect(fake.turns(threadId)).toHaveLength(3);

  // The user's own message, from the Roder page, resets the count.
  await roders.handleRequest("desktop/roders/workers/message", { id: roder.id, threadId, text: "Keep going" });
  expect(await worker(threadId)).toMatchObject({ followups: 0 });
  expect(JSON.stringify(fake.turns(threadId).at(-1)!.params.input)).toContain("Keep going");
  await finish(threadId);
  expect((await followUp("Now the changelog")).summary).toContain("1 of 2");

  // So does the user typing in the worker's own thread.
  await finish(threadId);
  await followUp("Last one");
  const params = (await roders.turnStartParams({ threadId, input: [] })) as { developerContext: string };
  expect(params.developerContext).toContain("You are a thread working for the Roder");
  expect(await worker(threadId)).toMatchObject({ followups: 0 });

  // A message relayed for the user (automatic: false) resets it too.
  await roders.handleRequest("desktop/roders/update", { id: roder.id, maxFollowups: 0 });
  await finish(threadId);
  await expect(followUp("Refused")).rejects.toThrow("(0 of 0)");
  await command({ type: "messageWorker", threadId, text: "The user says: ship it", automatic: false });
  expect(await worker(threadId)).toMatchObject({ followups: 0 });
});

test("a worker may only comment on and link pull requests to its own issues", async () => {
  const { roders, roder, createIssue, delegate, issue } = await setup();
  const own = await createIssue("Own");
  const other = await createIssue("Other");
  const { threadId } = (await delegate(own)).worker!;
  const asWorker = (action: unknown) =>
    roders.handleTool("roder_command", { commandId: randomUUID(), roderId: roder.id, action }, { threadId });

  await expect(asWorker({ type: "editIssue", issueId: own.id, details: { status: "in_review" } })).rejects.toThrow(
    /A worker thread may use roder_command only for commentIssue and linkIssuePullRequest/,
  );
  await expect(asWorker({ type: "commentIssue", issueId: other.id, text: "Not mine" })).rejects.toThrow(
    "Issue #2 is not linked to this thread",
  );
  await expect(
    asWorker({ type: "linkIssuePullRequest", issueId: other.id, url: "https://github.com/o/r/pull/1" }),
  ).rejects.toThrow("Issue #2 is not linked to this thread");
  for (const action of [
    { type: "delegate", issueId: own.id, worker: { objective: "x" } },
    { type: "closeIssue", issueId: own.id, outcome: "dropped", note: "x" },
    { type: "writeFile", path: "NOTES.md", content: "x", expectedVersion: 1 },
    { type: "setStatus", status: "paused" },
  ])
    await expect(asWorker(action)).rejects.toThrow(/only for commentIssue and linkIssuePullRequest/);
  await expect(roders.handleTool("roder_issue", { roderId: roder.id }, { threadId })).rejects.toThrow(
    /A worker thread may use only roder_command/,
  );
  expect((await issue(other.id)).activity.map((entry) => entry.kind)).toEqual(["created"]);

  await asWorker({ type: "commentIssue", issueId: own.number, text: "Tests pass" });
  await asWorker({ type: "linkIssuePullRequest", issueId: own.id, url: "https://github.com/o/r/pull/7", title: "Fix" });
  const after = await issue(own.id);
  expect(after.activity.at(-2)).toMatchObject({
    kind: "comment",
    text: "Tests pass",
    actor: { type: "thread", threadId },
  });
  expect(after.pullRequests).toEqual([{ url: "https://github.com/o/r/pull/7", title: "Fix" }]);
  expect(after.status).toBe("in_progress");
});

test("stopWorker interrupts a running worker; a user stop needs the user before automatic messages resume", async () => {
  const { fake, roders, roder, command, createIssue, delegate, worker, finish } = await setup();
  const { threadId } = (await delegate(await createIssue("Stop me"))).worker!;
  await command({ type: "stopWorker", threadId });
  expect(fake.calls.filter((call) => call.method === "turn/interrupt")).toEqual([
    { method: "turn/interrupt", params: { threadId } },
  ]);
  await finish(threadId);
  expect(await worker(threadId)).toMatchObject({ state: "idle", hold: "roder" });
  // The Roder may resume a worker it stopped.
  await command({ type: "messageWorker", threadId, text: "Resume", automatic: true });
  await finish(threadId);

  await roders.handleRequest("desktop/roders/workers/stop", { id: roder.id, threadId });
  expect(await worker(threadId)).toMatchObject({ hold: "user" });
  await expect(command({ type: "messageWorker", threadId, text: "Resume", automatic: true })).rejects.toThrow(
    /The user stopped this worker/,
  );
  await roders.handleRequest("desktop/roders/workers/message", { id: roder.id, threadId, text: "Go on" });
  expect(await worker(threadId)).toMatchObject({ hold: null, state: "running" });
});

test("stopping a queued worker cancels its start and frees its place in the queue", async () => {
  const { fake, roders, roder, command, createIssue, delegate, worker, finish } = await setup();
  await roders.handleRequest("desktop/roders/update", { id: roder.id, maxConcurrentWorkers: 1 });
  const first = (await delegate(await createIssue("First"))).worker!;
  const second = (await delegate(await createIssue("Second"))).worker!;
  const third = (await delegate(await createIssue("Third"))).worker!;
  await command({ type: "stopWorker", threadId: second.threadId });
  expect(await worker(second.threadId)).toMatchObject({ state: "idle", queuePosition: null });
  expect(await worker(third.threadId)).toMatchObject({ queuePosition: 1 });
  await finish(first.threadId);
  expect(fake.turns(second.threadId)).toHaveLength(0);
  expect(await worker(third.threadId)).toMatchObject({ state: "running" });
});

test("releaseWorker forgets the worker and keeps its thread, worktree and issue links", async () => {
  const { roders, roder, command, createIssue, delegate, read, issue } = await setup();
  const work = await createIssue("Release me");
  const { threadId } = (await delegate(work)).worker!;
  const result = await command({ type: "releaseWorker", threadId });
  expect(result.summary).toContain("its thread and worktree are kept");
  expect((await read()).workers).toEqual([]);
  expect((await issue(work.id)).threadIds).toEqual([threadId]);
  await expect(
    roders.handleTool(
      "roder_command",
      { commandId: "c", roderId: roder.id, action: { type: "commentIssue", issueId: work.id, text: "x" } },
      { threadId },
    ),
  ).rejects.toThrow(/owning Roder thread/);
  expect(roders.policyModeForThread(threadId)).toBeUndefined();
  await expect(command({ type: "messageWorker", threadId, text: "x", automatic: true })).rejects.toThrow(
    /not one of this Roder's workers/,
  );
});

test("delegate refuses closed issues, issues waiting on the user and issues without doneCriteria, making nothing", async () => {
  const { fake, issues, command, createIssue, delegate, read } = await setup();
  const closed = await createIssue("Closed");
  await command({ type: "closeIssue", issueId: closed.id, outcome: "dropped", note: "No" });
  await expect(delegate(closed)).rejects.toThrow("Issue #1 is closed");
  const asked = await createIssue("Asked");
  await command({ type: "askUser", issueId: asked.id, question: "Which?" });
  await expect(delegate(asked)).rejects.toThrow("waits on the user");
  const backlog = (await command({ type: "createIssue", details: { title: "Vague" } })).issue!;
  await expect(delegate(backlog)).rejects.toThrow("has no doneCriteria");
  await expect(delegate(await createIssue("Empty"), { worker: { objective: " " } })).rejects.toThrow(
    "Invalid worker objective",
  );
  expect(fake.calls.filter((call) => call.method === "thread/start" && call.params.cwd)).toHaveLength(0);
  expect((await read()).workers).toEqual([]);
  expect((await issues.request("desktop/issues/list", {})).issues.every((entry) => !entry.threadIds.length)).toBe(true);
});

test("issues_launch on a Roder's project goes through the delegate path", async () => {
  const { fake, roders, roder, issues, createIssue, read, issue } = await setup();
  const work = await createIssue("Launched");
  const launched = await issues.request("desktop/issues/launch", { id: work.id }, { type: "user" });
  const [registered] = (await read()).workers;
  expect(registered).toMatchObject({
    threadId: launched.threadId,
    issueId: work.id,
    branch: expect.stringMatching(/^roder\/issue-1-/),
  });
  expect(await issue(work.id)).toMatchObject({
    status: "in_progress",
    owner: { type: "thread", threadId: launched.threadId },
  });
  // The objective goes out once the issue service has linked the thread.
  await roders.handleRequest("desktop/roders/read", { id: roder.id });
  const [turn] = fake.turns(launched.threadId);
  expect(JSON.stringify(turn.params.input)).toContain("Work on issue #1: Launched");
  expect(turn.params.developerContext).toContain(`"issueId":"${work.id}"`);
});

test("worker turns use the Roder's worker permission mode, bypass by default", async () => {
  const { roders, roder, createIssue, delegate } = await setup();
  const { threadId } = (await delegate(await createIssue("Mode"))).worker!;
  expect(roders.policyModeForThread(threadId)).toBe("bypass");
  expect(roders.policyModeForThread(roder.threadId)).toBeUndefined();
  await roders.handleRequest("desktop/roders/update", { id: roder.id, workerPolicyMode: "accept_all" });
  expect(roders.policyModeForThread(threadId)).toBe("accept_all");
  await expect(
    roders.handleRequest("desktop/roders/update", { id: roder.id, workerPolicyMode: "plan" }),
  ).rejects.toThrow(/workerPolicyMode must be one of/);
  await expect(
    roders.handleRequest("desktop/roders/update", { id: roder.id, maxConcurrentWorkers: 0 }),
  ).rejects.toThrow(/worker concurrency/);
  await expect(roders.handleRequest("desktop/roders/update", { id: roder.id, maxFollowups: 33 })).rejects.toThrow(
    /follow-up limit/,
  );
});

test("workers, queue and limits survive a restart; older records get the defaults", async () => {
  const { directory, fake, roders, roder, createIssue, delegate } = await setup();
  await roders.handleRequest("desktop/roders/update", { id: roder.id, maxConcurrentWorkers: 1 });
  await delegate(await createIssue("First"));
  const second = (await delegate(await createIssue("Second"))).worker!;
  await roders.stop();
  services.splice(0);

  const again = createRoderAgentService({ directory: join(directory, "roders"), request: fake.request });
  services.push(again);
  await again.start();
  const [restored] = ((await again.handleRequest("desktop/roders/list", {})) as { roders: RoderAgentDetail[] }).roders;
  expect(restored.maxConcurrentWorkers).toBe(1);
  expect(restored.workers.find((entry) => entry.threadId === second.threadId)).toMatchObject({
    state: "queued",
    queuePosition: 1,
  });
  expect(restored.outbox).toHaveLength(1);
  await again.stop();
  services.splice(0);

  // A record from before workers existed.
  const path = join(directory, "roders", "roders.json");
  const saved = JSON.parse(await readFile(path, "utf8"));
  for (const field of ["maxConcurrentWorkers", "maxFollowups", "workerPolicyMode", "workers", "outbox"])
    delete saved.roders[0][field];
  await writeFile(path, JSON.stringify(saved));
  const old = createRoderAgentService({ directory: join(directory, "roders"), request: fake.request });
  services.push(old);
  await old.start();
  const [loaded] = ((await old.handleRequest("desktop/roders/list", {})) as { roders: RoderAgentDetail[] }).roders;
  expect(loaded).toMatchObject({
    maxConcurrentWorkers: 2,
    maxFollowups: 3,
    workerPolicyMode: "bypass",
    workers: [],
    outbox: [],
  });
});

test("the worker context rides on every worker turn, not only the first", async () => {
  const { fake, roders, roder, command, createIssue, delegate, finish } = await setup();
  await roders.handleRequest("desktop/roders/files/write", {
    id: roder.id,
    path: "WORKERS.md",
    content: "Run pnpm test before reporting.",
    expectedVersion: 1,
  });
  const work = await createIssue("Two turns");
  const { threadId } = (await delegate(work)).worker!;
  await finish(threadId);
  await command({ type: "messageWorker", threadId, text: "Now the docs", automatic: true });
  await finish(threadId);
  // A turn the user starts in the worker's thread goes through the host's turnStartParams.
  const typed = (await roders.turnStartParams({
    threadId,
    input: [{ type: "text", text: "and the changelog" }],
  })) as { developerContext: string; input: { text: string }[] };

  const contexts = [
    ...fake.turns(threadId).map((turn) => turn.params.developerContext as string),
    typed.developerContext,
  ];
  expect(contexts).toHaveLength(3);
  for (const context of contexts) {
    expect(context).toContain('You are a thread working for the Roder "Release"');
    expect(context).toContain("Rules from your Roder (WORKERS.md):\nRun pnpm test before reporting.");
    expect(context).toContain(`"issueId":"${work.id}"`);
  }
  // The worker's own messages stay as they were: the Roder's turn wrapping is for the Roder's thread only.
  expect(typed.input).toEqual([{ type: "text", text: "and the changelog" }]);
  expect(JSON.stringify(fake.turns(threadId)[1].params.input)).not.toContain("Roder turn context");
});

test("a fresh conversation keeps the worker registry, queue and outbox", async () => {
  const { fake, roders, roder, createIssue, delegate, read, worker, finish } = await setup();
  await roders.handleRequest("desktop/roders/update", { id: roder.id, maxConcurrentWorkers: 1 });
  const ownIssue = await createIssue("First");
  const first = (await delegate(ownIssue)).worker!;
  const second = (await delegate(await createIssue("Second"))).worker!;
  const before = await read();

  const fresh = (await roders.handleRequest("desktop/roders/freshConversation", { id: roder.id })) as RoderAgentDetail;
  expect(fresh.threadId).not.toBe(roder.threadId);
  expect(fresh.previousThreadIds).toEqual([roder.threadId]);
  expect(fresh.workers).toEqual(before.workers);
  expect(fresh.outbox).toEqual(before.outbox);
  expect(fresh).toMatchObject({ maxConcurrentWorkers: 1, maxFollowups: 3, workerPolicyMode: "bypass" });

  // The workers keep working for the Roder: the queue moves, their tools still work, and
  // the Roder manages them from its new thread.
  await finish(first.threadId);
  expect(await worker(second.threadId)).toMatchObject({ state: "running", queuePosition: null });
  await roders.handleTool(
    "roder_command",
    {
      commandId: randomUUID(),
      roderId: roder.id,
      action: { type: "commentIssue", issueId: ownIssue.id, text: "Done" },
    },
    { threadId: first.threadId },
  );
  await roders.handleTool(
    "roder_command",
    {
      commandId: randomUUID(),
      roderId: roder.id,
      action: { type: "messageWorker", threadId: first.threadId, text: "Add a test", automatic: true },
    },
    { threadId: fresh.threadId },
  );
  expect(await worker(first.threadId)).toMatchObject({ followups: 1 });
  expect(fake.turns(first.threadId)).toHaveLength(1); // waits: the one slot is taken by the second worker
  expect(roders.policyModeForThread(first.threadId)).toBe("bypass");
});

test("the brief and guides tell the Roder to delegate, and list the worker actions", async () => {
  const { roders, roder } = await setup();
  const thread = { threadId: roder.threadId };
  const guide = async (path: string) =>
    ((await roders.handleTool("roder_files", { path }, thread)) as { content: string }).content;
  const commands = await guide("guide/commands.md");
  for (const signature of [
    "delegate {issueId, worker, model?, base?}",
    "messageWorker {threadId, text, automatic}",
    "stopWorker {threadId}",
    "releaseWorker {threadId}",
  ])
    expect(commands).toContain(signature);
  expect(await guide("guide/lifecycle.md")).toContain(
    "links the thread to the issue, makes it the owner and moves the issue to in_progress",
  );
  const turn = (await roders.turnStartParams({ threadId: roder.threadId, input: [{ type: "text", text: "Hi" }] })) as {
    input: { text: string }[];
  };
  const brief = turn.input[0].text;
  expect(brief).toContain("Delegate it with the roder_command delegate action");
  expect(brief).not.toContain("Issues page");
  expect(brief).not.toMatch(/share (a|the) worktree/);
});

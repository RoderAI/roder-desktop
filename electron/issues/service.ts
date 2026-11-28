import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  issuePriorities,
  issueStatuses,
  type Issue,
  type IssueActivity,
  type IssueActor,
  type IssueChange,
  type IssueOwner,
  type IssueProject,
  type IssueStatus,
  type IssuesChangedEvent,
} from "../../src/types/issues";

export type IssuesResults = {
  "desktop/projects/list": { projects: IssueProject[] };
  "desktop/projects/read": { project: IssueProject };
  "desktop/projects/create": { project: IssueProject };
  "desktop/projects/ensureWorkspace": { project: IssueProject };
  "desktop/projects/update": { project: IssueProject };
  "desktop/projects/delete": { deleted: true };
  "desktop/issues/list": { issues: Issue[] };
  "desktop/issues/read": { issue: Issue };
  "desktop/issues/create": { issue: Issue };
  "desktop/issues/update": { issue: Issue };
  "desktop/issues/comment": { issue: Issue };
  "desktop/issues/linkPullRequest": { issue: Issue };
  "desktop/issues/unlinkPullRequest": { issue: Issue };
  "desktop/issues/askUser": { issue: Issue };
  "desktop/issues/close": { issue: Issue };
  "desktop/issues/delete": { deleted: true };
  "desktop/issues/launch": { issue: Issue; threadId: string };
};

const readMethods = new Set([
  "desktop/projects/list",
  "desktop/projects/read",
  "desktop/issues/list",
  "desktop/issues/read",
]);

/**
 * Runs inside the service's queue, after the store is read and before the
 * change applies, so a precondition can't be overtaken by another change.
 * Throw to refuse; nothing is written.
 */
export type IssuesGuard = (issues: readonly Issue[]) => void;

type Database = { version: 2; nextNumber: number; projects: IssueProject[]; issues: Issue[] };
type Options = {
  storagePath: string;
  onEvent?: (event: IssuesChangedEvent) => void;
  launchIssue?: (issue: Issue, project: IssueProject) => Promise<{ threadId: string }>;
};

function text(
  value: unknown,
  field: string,
  required = false,
  max = field === "description" ? 100_000 : 1_000,
): string {
  if (typeof value !== "string" || (required && !value.trim()))
    throw new Error(`${field} must be ${required ? "a non-empty" : "a"} string`);
  if (value.length > max) throw new Error(`${field} is too long`);
  return required ? value.trim() : value;
}

function nullableText(value: unknown, field: string): string | null {
  return value === null ? null : text(value, field, true);
}

function oneOf<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (!values.includes(value as T)) throw new Error(`Invalid issue ${field}`);
  return value as T;
}

function owner(value: unknown): IssueOwner {
  const input = value as Record<string, unknown> | null;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    if ((input.type === "roder" || input.type === "user") && input.threadId === undefined) return { type: input.type };
    if (input.type === "thread") return { type: "thread", threadId: text(input.threadId, "owner threadId", true) };
  }
  throw new Error('owner must be {type: "roder"}, {type: "user"} or {type: "thread", threadId}');
}

function actorOf(value: unknown): IssueActor {
  const input = value as Record<string, unknown> | null;
  if (input?.type === "user") return { type: "user" };
  if (input?.type === "agent") return { type: "agent", threadId: text(input.threadId, "actor threadId", true) };
  throw new Error("Issue changes need an actor");
}

const terminal = (status: IssueStatus) => status === "done" || status === "cancelled";
const ownerValue = (value: IssueOwner) => (value.type === "thread" ? value.threadId : value.type);
const ownerLabel = (value: IssueOwner) =>
  value.type === "thread" ? value.threadId : value.type === "user" ? "You" : "Roder";
const statusLabel = (status: IssueStatus) => status.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
const sameOwner = (a: IssueOwner, b: IssueOwner) => ownerValue(a) === ownerValue(b) && a.type === b.type;

/**
 * Keep the status in step with the owner: the user owning an open issue means
 * it needs them, and an issue that no longer needs them goes back to work.
 */
function normalize(issue: Issue): void {
  if (terminal(issue.status)) return;
  if (issue.owner.type === "user") issue.status = "needs_you";
  else if (issue.status === "needs_you") issue.status = issue.threadIds.length ? "in_progress" : "todo";
}

/** The user answered: the newest linked thread takes the issue back, else the Roder. */
function handBack(issue: Issue): IssueOwner {
  const threadId = issue.threadIds.at(-1);
  return threadId ? { type: "thread", threadId } : { type: "roder" };
}

/** An owning thread is a linked thread. */
function linkOwner(issue: Issue): void {
  if (issue.owner.type === "thread" && !issue.threadIds.includes(issue.owner.threadId))
    issue.threadIds.push(issue.owner.threadId);
}

/**
 * Status moves an agent may make itself. Each needs the evidence that makes it
 * true, so the board can't drift ahead of the work. A parent issue is in
 * progress while one of its children is.
 */
function transition(before: Issue, next: Issue, childInProgress: boolean): void {
  if (next.status !== before.status) {
    if (terminal(next.status))
      throw new Error("close issues with issues_close (outcome merged or dropped, plus a note)");
    if (next.status === "in_review" && !next.pullRequests.length)
      throw new Error("link the pull request with issues_link_pull_request before moving the issue to in_review");
    if (next.status === "in_progress" && !next.threadIds.length && !childInProgress)
      throw new Error(
        `an issue is in_progress only while a thread works on it: launch it with issues_launch, set its owner to the working thread, or, for a parent issue, start work on one of its child issues (parent: "${before.id}") first`,
      );
    if (next.status === "needs_you") throw new Error("hand the issue to the user with issues_ask_user");
    // Creating outside backlog needs doneCriteria; so does moving out of it.
    if (next.status !== "backlog" && !next.doneCriteria.trim())
      throw new Error("add doneCriteria: what must be true for this issue to be done");
  }
  if (!sameOwner(next.owner, before.owner) && next.owner.type === "user")
    throw new Error("hand the issue to the user with issues_ask_user");
  if (before.doneCriteria.trim() && !next.doneCriteria.trim())
    throw new Error("keep the issue's doneCriteria; edit it rather than clearing it");
}

function validIssue(issue: Issue, projectIds: Set<string>): boolean {
  text(issue.id, "id", true);
  text(issue.title, "title", true);
  text(issue.description, "description");
  text(issue.doneCriteria, "doneCriteria", false, 100_000);
  text(issue.outOfScope, "outOfScope", false, 100_000);
  nullableText(issue.parent, "parent");
  owner(issue.owner);
  return (
    issueStatuses.includes(issue.status) &&
    issuePriorities.includes(issue.priority) &&
    projectIds.has(issue.projectId) &&
    Number.isSafeInteger(issue.number) &&
    Array.isArray(issue.threadIds) &&
    issue.threadIds.every((id) => typeof id === "string" && id) &&
    Array.isArray(issue.pullRequests) &&
    issue.pullRequests.every((pr) => typeof pr?.url === "string" && typeof pr.title === "string") &&
    Array.isArray(issue.activity)
  );
}

/** Only HTTPS GitHub pull request links: no other schemes, credentials, queries or fragments. */
function pullRequestUrl(value: unknown): string {
  const prefix = "https://github.com/";
  const url = text(value, "url", true);
  if (!url.startsWith(prefix)) throw new Error("use an HTTPS GitHub pull request URL");
  const parts = url.slice(prefix.length).replace(/\/+$/, "").split("/");
  const segment = (s: string) => /^[A-Za-z0-9._-]+$/.test(s) && s !== "." && s !== "..";
  if (
    parts.length !== 4 ||
    parts[2] !== "pull" ||
    !/^[1-9]\d*$/.test(parts[3]) ||
    !segment(parts[0]) ||
    !segment(parts[1])
  )
    throw new Error("invalid GitHub pull request URL");
  return `https://github.com/${parts.join("/")}`;
}

export class IssuesService {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: Options) {}

  /**
   * Every change takes an actor: `{type: "user"}` for the person using the
   * app, `{type: "agent", threadId}` for an agent's tool call. Reads don't.
   */
  request<M extends keyof IssuesResults>(
    method: M,
    params?: unknown,
    actor?: IssueActor,
    guard?: IssuesGuard,
  ): Promise<IssuesResults[M]>;
  request(method: string, params?: unknown, actor?: IssueActor, guard?: IssuesGuard): Promise<unknown>;
  request(method: string, params: unknown = {}, actor?: IssueActor, guard?: IssuesGuard): Promise<unknown> {
    const result = this.queue.then(() => this.execute(method, params, actor, guard));
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async load(): Promise<Database> {
    let contents: string;
    try {
      contents = await readFile(this.options.storagePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { version: 2, nextNumber: 1, projects: [], issues: [] };
      throw error;
    }
    const db = JSON.parse(contents) as Database;
    if ((db as { version?: unknown } | null)?.version === 1) {
      // Version 1 records are not carried over. Move the file aside, never
      // delete or overwrite it, and start a fresh store.
      const aside = `${this.options.storagePath}.v1-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}.bak`;
      await rename(this.options.storagePath, aside);
      return { version: 2, nextNumber: 1, projects: [], issues: [] };
    }
    if (db?.version !== 2) throw new Error("Unsupported issues database version");
    if (
      !Array.isArray(db.projects) ||
      !Array.isArray(db.issues) ||
      !Number.isSafeInteger(db.nextNumber) ||
      db.nextNumber < 1
    )
      throw new Error("Invalid issues database");
    for (const project of db.projects) {
      text(project.id, "id", true);
      text(project.name, "name", true);
      text(project.description, "description");
      nullableText(project.workspaceId, "workspaceId");
      project.roderThreadId =
        project.roderThreadId === undefined ? null : nullableText(project.roderThreadId, "roderThreadId");
      if (typeof project.archived !== "boolean") throw new Error("Invalid project archive state");
    }
    const projectIds = new Set(db.projects.map((project) => project.id));
    for (const issue of db.issues) if (!validIssue(issue, projectIds)) throw new Error("Invalid issue record");
    return db;
  }

  private async save(db: Database): Promise<void> {
    await mkdir(dirname(this.options.storagePath), { recursive: true });
    const temporary = `${this.options.storagePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(db, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.options.storagePath);
    } finally {
      await rm(temporary, { force: true });
    }
    try {
      this.options.onEvent?.({ method: "desktop/issues/changed", params: {} });
    } catch {
      return;
    }
  }

  private async execute(
    method: string,
    params: unknown,
    rawActor: IssueActor | undefined,
    guard: IssuesGuard | undefined,
  ): Promise<unknown> {
    if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("Expected an object");
    const p = params as Record<string, unknown>;
    const actor = readMethods.has(method) ? null : actorOf(rawActor);
    const agent = actor?.type === "agent";
    const db = await this.load();
    guard?.(db.issues);
    const now = new Date().toISOString();
    const projectById = (id: unknown) => {
      const project = db.projects.find((item) => item.id === text(id, "project id", true));
      if (!project) throw new Error("Project not found");
      return project;
    };
    const issueById = () => {
      const issue = db.issues.find((item) => item.id === text(p.id, "issue id", true));
      if (!issue) throw new Error("Issue not found");
      return issue;
    };
    // The project's Roder thread reads as `roder`; any other agent as its thread.
    const author = (issue: Issue): IssueOwner => {
      if (!actor || actor.type === "user") return { type: "user" };
      return db.projects.find((project) => project.id === issue.projectId)?.roderThreadId === actor.threadId
        ? { type: "roder" }
        : { type: "thread", threadId: actor.threadId };
    };
    const record = (issue: Issue, entry: Omit<IssueActivity, "id" | "createdAt" | "actor">) => {
      issue.activity.push({ id: randomUUID(), createdAt: now, actor: author(issue), ...entry });
      issue.updatedAt = now;
    };
    const lifecycleChanges = (before: Issue, after: Issue): IssueChange[] => {
      const changes: IssueChange[] = [];
      for (const id of after.threadIds)
        if (!before.threadIds.includes(id)) changes.push({ field: "thread", before: null, after: id });
      if (!sameOwner(before.owner, after.owner))
        changes.push({ field: "owner", before: ownerValue(before.owner), after: ownerValue(after.owner) });
      if (before.status !== after.status) changes.push({ field: "status", before: before.status, after: after.status });
      return changes;
    };
    const validParent = (issue: Issue) => {
      if (issue.parent === null) return;
      if (issue.parent === issue.id) throw new Error("an issue can't be its own parent");
      let parent = db.issues.find((item) => item.id === issue.parent);
      if (!parent) throw new Error(`parent issue ${issue.parent} doesn't exist`);
      if (parent.projectId !== issue.projectId) throw new Error("a parent issue must be in the same project");
      for (const seen = new Set([issue.id]); parent; parent = db.issues.find((item) => item.id === parent?.parent)) {
        if (seen.has(parent.id)) throw new Error("parent issues can't form a cycle");
        seen.add(parent.id);
      }
    };
    const issueResult = async (issue: Issue) => {
      await this.save(db);
      return { issue };
    };

    if (method === "desktop/projects/list") {
      return {
        projects: db.projects.filter(
          (project) =>
            (p.archived === undefined || project.archived === p.archived) &&
            (p.workspaceId === undefined || project.workspaceId === p.workspaceId),
        ),
      };
    }
    if (method === "desktop/projects/read") return { project: projectById(p.id) };
    if (method === "desktop/projects/create" || method === "desktop/projects/ensureWorkspace") {
      const name = text(p.name, "name", true);
      const description = p.description === undefined ? "" : text(p.description, "description");
      const workspaceId =
        method === "desktop/projects/ensureWorkspace"
          ? text(p.workspaceId, "workspaceId", true)
          : p.workspaceId === undefined
            ? null
            : nullableText(p.workspaceId, "workspaceId");
      const roderThreadId = p.roderThreadId === undefined ? null : nullableText(p.roderThreadId, "roderThreadId");
      if (method === "desktop/projects/ensureWorkspace") {
        const existing =
          db.projects.find((project) => project.workspaceId === workspaceId && !project.archived) ??
          db.projects.find((project) => project.workspaceId === workspaceId);
        if (existing) {
          if (p.roderThreadId !== undefined && existing.roderThreadId !== roderThreadId) {
            existing.roderThreadId = roderThreadId;
            existing.updatedAt = now;
            await this.save(db);
          }
          return { project: existing };
        }
      }
      const project: IssueProject = {
        id: randomUUID(),
        name,
        description,
        workspaceId,
        roderThreadId,
        archived: false,
        createdAt: now,
        updatedAt: now,
      };
      db.projects.push(project);
      await this.save(db);
      return { project };
    }
    if (method === "desktop/projects/update") {
      const project = projectById(p.id);
      if (p.name !== undefined) project.name = text(p.name, "name", true);
      if (p.description !== undefined) project.description = text(p.description, "description");
      if (p.workspaceId !== undefined) project.workspaceId = nullableText(p.workspaceId, "workspaceId");
      if (p.roderThreadId !== undefined) project.roderThreadId = nullableText(p.roderThreadId, "roderThreadId");
      if (p.archived !== undefined) {
        if (typeof p.archived !== "boolean") throw new Error("archived must be a boolean");
        project.archived = p.archived;
      }
      project.updatedAt = now;
      await this.save(db);
      return { project };
    }
    if (method === "desktop/projects/delete") {
      const project = projectById(p.id);
      if (db.issues.some((issue) => issue.projectId === project.id))
        throw new Error("Delete the project's issues before deleting the project; archive it to preserve history");
      db.projects = db.projects.filter((item) => item.id !== project.id);
      await this.save(db);
      return { deleted: true };
    }
    if (method === "desktop/issues/list") {
      const query = p.query === undefined ? "" : text(p.query, "query").toLowerCase();
      const threadId = p.threadId === undefined ? undefined : nullableText(p.threadId, "threadId");
      return {
        issues: db.issues
          .filter(
            (issue) =>
              (p.projectId === undefined || issue.projectId === p.projectId) &&
              (p.status === undefined || issue.status === p.status) &&
              (threadId === undefined ||
                (threadId === null ? !issue.threadIds.length : issue.threadIds.includes(threadId))) &&
              `${issue.title}\n${issue.description}\n${issue.number}`.toLowerCase().includes(query),
          )
          .sort((a, b) => b.number - a.number),
      };
    }
    if (method === "desktop/issues/read") return { issue: issueById() };
    if (method === "desktop/issues/create") {
      const project = projectById(p.projectId);
      if (project.archived) throw new Error("Unarchive the project before creating issues");
      const status = p.status === undefined ? "backlog" : oneOf(p.status, issueStatuses, "status");
      const issue: Issue = {
        id: randomUUID(),
        number: db.nextNumber,
        projectId: project.id,
        title: text(p.title, "title", true),
        description: p.description === undefined ? "" : text(p.description, "description"),
        status,
        priority: p.priority === undefined ? "normal" : oneOf(p.priority, issuePriorities, "priority"),
        owner: p.owner === undefined ? { type: status === "needs_you" ? "user" : "roder" } : owner(p.owner),
        doneCriteria: p.doneCriteria === undefined ? "" : text(p.doneCriteria, "doneCriteria", false, 100_000),
        outOfScope: p.outOfScope === undefined ? "" : text(p.outOfScope, "outOfScope", false, 100_000),
        parent: p.parent === undefined ? null : nullableText(p.parent, "parent"),
        threadIds: [],
        pullRequests: [],
        activity: [],
        createdAt: now,
        updatedAt: now,
      };
      if (agent) {
        if (issue.status !== "backlog" && !issue.doneCriteria.trim())
          throw new Error("add doneCriteria: what must be true for this issue to be done");
        if (issue.owner.type === "user")
          throw new Error("create the issue for yourself, then hand it over with issues_ask_user");
        if (issue.status !== "backlog" && issue.status !== "todo")
          throw new Error("new issues start in backlog or todo; issues_launch moves one to in_progress");
      }
      validParent(issue);
      linkOwner(issue);
      normalize(issue);
      record(issue, { kind: "created", text: "Created the issue" });
      db.nextNumber++;
      db.issues.push(issue);
      return issueResult(issue);
    }
    if (method === "desktop/issues/update") {
      const issue = issueById();
      const next: Issue = structuredClone(issue);
      if (p.title !== undefined) next.title = text(p.title, "title", true);
      if (p.description !== undefined) next.description = text(p.description, "description");
      if (p.projectId !== undefined) next.projectId = projectById(p.projectId).id;
      if (p.status !== undefined) next.status = oneOf(p.status, issueStatuses, "status");
      if (p.priority !== undefined) next.priority = oneOf(p.priority, issuePriorities, "priority");
      if (p.owner !== undefined) next.owner = owner(p.owner);
      if (p.doneCriteria !== undefined) next.doneCriteria = text(p.doneCriteria, "doneCriteria", false, 100_000);
      if (p.outOfScope !== undefined) next.outOfScope = text(p.outOfScope, "outOfScope", false, 100_000);
      if (p.parent !== undefined) next.parent = nullableText(p.parent, "parent");
      linkOwner(next);
      if (agent)
        transition(
          issue,
          next,
          db.issues.some((child) => child.parent === issue.id && child.status === "in_progress"),
        );
      // A person moving the status alone moves the owner with it: into
      // needs_you takes the issue themselves, out of it hands it back.
      if (!agent && next.status !== issue.status && sameOwner(next.owner, issue.owner)) {
        if (next.status === "needs_you") next.owner = { type: "user" };
        else if (issue.owner.type === "user") next.owner = handBack(next);
      }
      validParent(next);
      if (next.projectId !== issue.projectId && db.issues.some((child) => child.parent === issue.id))
        throw new Error("move or detach this issue's child issues before moving it to another project");
      normalize(next);
      const changes = lifecycleChanges(issue, next);
      if (issue.priority !== next.priority)
        changes.push({ field: "priority", before: issue.priority, after: next.priority });
      if (issue.parent !== next.parent) changes.push({ field: "parent", before: issue.parent, after: next.parent });
      for (const field of ["title", "projectId", "description", "doneCriteria", "outOfScope"] as const)
        if (issue[field] !== next[field]) changes.push({ field, before: null, after: null });
      if (!changes.length) return { issue };
      const summary = [
        ...(sameOwner(issue.owner, next.owner) ? [] : [`Owner: ${ownerLabel(next.owner)}`]),
        ...(issue.status === next.status ? [] : [`Status changed to ${statusLabel(next.status)}`]),
        ...(issue.priority === next.priority ? [] : [`Priority changed to ${next.priority}`]),
      ];
      Object.assign(issue, next);
      record(issue, { kind: "updated", text: summary.join(" · ") || "Updated issue details", changes });
      return issueResult(issue);
    }
    if (method === "desktop/issues/comment") {
      const issue = issueById();
      const body = text(p.text, "text", true, 65_536);
      const before = structuredClone(issue);
      // A person answering an issue that waits on them hands it back: to the
      // newest linked thread, else to the Roder.
      if (!agent && issue.status === "needs_you") {
        issue.owner = handBack(issue);
        normalize(issue);
      }
      const changes = lifecycleChanges(before, issue);
      record(issue, { kind: "comment", text: body, ...(changes.length ? { changes } : {}) });
      return issueResult(issue);
    }
    if (method === "desktop/issues/linkPullRequest") {
      const issue = issueById();
      const url = pullRequestUrl(p.url);
      const title = p.title === undefined ? "" : text(p.title, "title", false, 500).trim();
      if (issue.pullRequests.some((pr) => pr.url === url)) return { issue };
      issue.pullRequests.push({ url, title });
      record(issue, {
        kind: "pullRequest",
        text: `Linked pull request ${url}`,
        changes: [{ field: "pullRequest", before: null, after: url }],
      });
      return issueResult(issue);
    }
    if (method === "desktop/issues/unlinkPullRequest") {
      const issue = issueById();
      const url = pullRequestUrl(p.url);
      if (!issue.pullRequests.some((pr) => pr.url === url)) return { issue };
      if (agent && issue.status === "in_review" && issue.pullRequests.length === 1)
        throw new Error(
          "an issue in_review needs a linked pull request: move it out of in_review before unlinking its last one",
        );
      issue.pullRequests = issue.pullRequests.filter((pr) => pr.url !== url);
      record(issue, {
        kind: "pullRequest",
        text: `Unlinked pull request ${url}`,
        changes: [{ field: "pullRequest", before: url, after: null }],
      });
      return issueResult(issue);
    }
    if (method === "desktop/issues/askUser") {
      const issue = issueById();
      const question = text(p.question, "question", true, 8_192);
      const recommendation =
        p.recommendation === undefined ? "" : text(p.recommendation, "recommendation", false, 8_192);
      if (terminal(issue.status)) throw new Error("reopen the issue before asking about it");
      const before = structuredClone(issue);
      issue.owner = { type: "user" };
      normalize(issue);
      const changes = lifecycleChanges(before, issue);
      record(issue, {
        kind: "question",
        text: recommendation.trim() ? `${question}\n\nRecommendation: ${recommendation.trim()}` : question,
        ...(before.owner.type === "thread" ? { threadId: before.owner.threadId } : {}),
        ...(changes.length ? { changes } : {}),
      });
      return issueResult(issue);
    }
    if (method === "desktop/issues/close") {
      const issue = issueById();
      const outcome = oneOf(p.outcome, ["merged", "dropped"] as const, "outcome");
      const note = text(p.note, "note", true, 8_192);
      if (outcome === "merged" && !issue.pullRequests.length)
        throw new Error("link the merged pull request before closing the issue as merged");
      const status = outcome === "merged" ? "done" : "cancelled";
      const changes: IssueChange[] =
        issue.status === status ? [] : [{ field: "status", before: issue.status, after: status }];
      issue.status = status;
      record(issue, {
        kind: "closed",
        text: `${outcome === "merged" ? "Merged" : "Dropped"} · ${note}`,
        ...(changes.length ? { changes } : {}),
      });
      return issueResult(issue);
    }
    if (method === "desktop/issues/delete") {
      const issue = issueById();
      db.issues = db.issues.filter((item) => item.id !== issue.id);
      for (const child of db.issues) if (child.parent === issue.id) child.parent = null;
      await this.save(db);
      return { deleted: true };
    }
    if (method === "desktop/issues/launch") {
      const issue = issueById();
      if (agent && terminal(issue.status)) throw new Error("reopen the issue before starting work");
      if (issue.owner.type === "thread") return { issue, threadId: issue.owner.threadId };
      const project = projectById(issue.projectId);
      if (project.archived) throw new Error("Unarchive the project before launching work");
      if (!project.workspaceId) throw new Error("Link the project to a workspace before launching work");
      if (!this.options.launchIssue) throw new Error("Issue launch is not connected to the thread service");
      const result = await this.options.launchIssue(structuredClone(issue), structuredClone(project));
      const threadId = text(result.threadId, "threadId", true);
      const before = structuredClone(issue);
      issue.owner = { type: "thread", threadId };
      issue.status = "in_progress";
      linkOwner(issue);
      record(issue, {
        kind: "thread",
        text: `Started thread ${threadId} · In progress`,
        changes: lifecycleChanges(before, issue),
      });
      await this.save(db);
      return { issue, threadId };
    }
    throw new Error(`Unknown issues method: ${method}`);
  }
}

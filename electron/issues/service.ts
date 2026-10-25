import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { issueStatuses, type Issue, type IssueProject, type IssuesChangedEvent } from "../../src/types/issues";

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
  "desktop/issues/delete": { deleted: true };
  "desktop/issues/launch": { issue: Issue; threadId: string };
};

type Database = { version: 1; nextNumber: number; projects: IssueProject[]; issues: Issue[] };
type Options = {
  storagePath: string;
  onEvent?: (event: IssuesChangedEvent) => void;
  launchIssue?: (issue: Issue, project: IssueProject) => Promise<{ threadId: string }>;
};

function text(value: unknown, field: string, required = false): string {
  if (typeof value !== "string" || (required && !value.trim()))
    throw new Error(`${field} must be ${required ? "a non-empty" : "a"} string`);
  if (value.length > (field === "description" ? 100_000 : 1_000)) throw new Error(`${field} is too long`);
  return required ? value.trim() : value;
}

function nullableText(value: unknown, field: string): string | null {
  return value === null ? null : text(value, field, true);
}

export class IssuesService {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: Options) {}

  request<M extends keyof IssuesResults>(method: M, params?: unknown): Promise<IssuesResults[M]>;
  request(method: string, params?: unknown): Promise<unknown>;
  request(method: string, params: unknown = {}): Promise<unknown> {
    const result = this.queue.then(() => this.execute(method, params));
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async load(): Promise<Database> {
    let contents: string;
    try {
      contents = await readFile(this.options.storagePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { version: 1, nextNumber: 1, projects: [], issues: [] };
      throw error;
    }
    const db = JSON.parse(contents) as Database;
    if (
      db.version !== 1 ||
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
      project.persistentAgentThreadId =
        project.persistentAgentThreadId === undefined
          ? null
          : nullableText(project.persistentAgentThreadId, "persistentAgentThreadId");
      if (typeof project.archived !== "boolean") throw new Error("Invalid project archive state");
    }
    const projectIds = new Set(db.projects.map((project) => project.id));
    const statuses = new Set<string>(issueStatuses);
    for (const issue of db.issues) {
      text(issue.id, "id", true);
      text(issue.title, "title", true);
      text(issue.description, "description");
      nullableText(issue.threadId, "threadId");
      if (!statuses.has(issue.status) || !projectIds.has(issue.projectId) || !Number.isSafeInteger(issue.number))
        throw new Error("Invalid issue record");
    }
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

  private async execute(method: string, params: unknown): Promise<unknown> {
    if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("Expected an object");
    const p = params as Record<string, unknown>;
    const db = await this.load();
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
      const persistentAgentThreadId =
        p.persistentAgentThreadId === undefined
          ? null
          : nullableText(p.persistentAgentThreadId, "persistentAgentThreadId");
      if (method === "desktop/projects/ensureWorkspace") {
        const existing =
          db.projects.find((project) => project.workspaceId === workspaceId && !project.archived) ??
          db.projects.find((project) => project.workspaceId === workspaceId);
        if (existing) {
          if (p.persistentAgentThreadId !== undefined && existing.persistentAgentThreadId !== persistentAgentThreadId) {
            existing.persistentAgentThreadId = persistentAgentThreadId;
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
        persistentAgentThreadId,
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
      if (p.persistentAgentThreadId !== undefined)
        project.persistentAgentThreadId = nullableText(p.persistentAgentThreadId, "persistentAgentThreadId");
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
      return {
        issues: db.issues
          .filter(
            (issue) =>
              (p.projectId === undefined || issue.projectId === p.projectId) &&
              (p.status === undefined || issue.status === p.status) &&
              (p.threadId === undefined || issue.threadId === p.threadId) &&
              `${issue.title}\n${issue.description}\n${issue.number}`.toLowerCase().includes(query),
          )
          .sort((a, b) => b.number - a.number),
      };
    }
    if (method === "desktop/issues/read") return { issue: issueById() };
    if (method === "desktop/issues/create") {
      const project = projectById(p.projectId);
      if (project.archived) throw new Error("Unarchive the project before creating issues");
      const status = p.status ?? "backlog";
      if (!issueStatuses.includes(status as Issue["status"])) throw new Error("Invalid issue status");
      const issue: Issue = {
        id: randomUUID(),
        number: db.nextNumber++,
        projectId: project.id,
        title: text(p.title, "title", true),
        description: p.description === undefined ? "" : text(p.description, "description"),
        status: status as Issue["status"],
        threadId: p.threadId === undefined ? null : nullableText(p.threadId, "threadId"),
        createdAt: now,
        updatedAt: now,
      };
      db.issues.push(issue);
      await this.save(db);
      return { issue };
    }
    if (method === "desktop/issues/update") {
      const issue = issueById();
      if (p.title !== undefined) issue.title = text(p.title, "title", true);
      if (p.description !== undefined) issue.description = text(p.description, "description");
      if (p.projectId !== undefined) issue.projectId = projectById(p.projectId).id;
      if (p.status !== undefined) {
        if (!issueStatuses.includes(p.status as Issue["status"])) throw new Error("Invalid issue status");
        issue.status = p.status as Issue["status"];
      }
      if (p.threadId !== undefined) issue.threadId = nullableText(p.threadId, "threadId");
      issue.updatedAt = now;
      await this.save(db);
      return { issue };
    }
    if (method === "desktop/issues/delete") {
      const issue = issueById();
      db.issues = db.issues.filter((item) => item.id !== issue.id);
      await this.save(db);
      return { deleted: true };
    }
    if (method === "desktop/issues/launch") {
      const issue = issueById();
      if (issue.threadId) return { issue, threadId: issue.threadId };
      const project = projectById(issue.projectId);
      if (project.archived) throw new Error("Unarchive the project before launching work");
      if (!project.workspaceId) throw new Error("Link the project to a workspace before launching work");
      if (!this.options.launchIssue) throw new Error("Issue launch is not connected to the thread service");
      const result = await this.options.launchIssue(structuredClone(issue), structuredClone(project));
      issue.threadId = text(result.threadId, "threadId", true);
      issue.status = "in_progress";
      issue.updatedAt = new Date().toISOString();
      await this.save(db);
      return { issue, threadId: issue.threadId };
    }
    throw new Error(`Unknown issues method: ${method}`);
  }
}

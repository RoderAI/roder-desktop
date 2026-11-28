import { mkdtemp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { IssuesService } from "../electron/issues/service";

const user = { type: "user" } as const;

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function setup(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "roder-issues-"));
  directories.push(directory);
  const storagePath = join(directory, "issues.json");
  const service = new IssuesService({ storagePath, ...options });
  const { project } = await service.request("desktop/projects/create", { name: "Desktop", workspaceId: "ws-1" }, user);
  return { service, storagePath, project };
}

test("persists projects, concurrent issue creation, assignment and filters across restart", async () => {
  const { service, storagePath, project } = await setup();
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      service.request("desktop/issues/create", { projectId: project.id, title: `Issue ${i}` }, user),
    ),
  );
  expect(new Set(results.map(({ issue }) => issue.number)).size).toBe(20);
  await service.request(
    "desktop/issues/update",
    {
      id: results[0].issue.id,
      status: "in_progress",
      owner: { type: "thread", threadId: "thread-1" },
    },
    user,
  );
  const restarted = new IssuesService({ storagePath });
  const { issues } = await restarted.request("desktop/issues/list", {
    projectId: project.id,
    status: "in_progress",
    threadId: "thread-1",
    query: "Issue 0",
  });
  expect(issues).toHaveLength(1);
  expect(issues[0]).toMatchObject({ threadIds: ["thread-1"], owner: { type: "thread", threadId: "thread-1" } });
  expect(JSON.parse(await readFile(storagePath, "utf8")).issues).toHaveLength(20);
  expect((await restarted.request("desktop/projects/read", { id: project.id })).project.workspaceId).toBe("ws-1");
});

test("rejects invalid writes without poisoning queue or cascading project deletion", async () => {
  const { service, project } = await setup();
  await expect(service.request("desktop/issues/create", { projectId: "missing", title: "Bad" }, user)).rejects.toThrow(
    "Project not found",
  );
  const { issue } = await service.request("desktop/issues/create", { projectId: project.id, title: "Good" }, user);
  await expect(service.request("desktop/issues/update", { id: issue.id, status: "bogus" }, user)).rejects.toThrow(
    "Invalid issue status",
  );
  await expect(service.request("desktop/issues/update", { id: issue.id, title: " " }, user)).rejects.toThrow(
    "title must be a non-empty string",
  );
  await expect(service.request("desktop/projects/delete", { id: project.id }, user)).rejects.toThrow(
    "Delete the project's issues",
  );
  expect((await service.request("desktop/issues/read", { id: issue.id })).issue.title).toBe("Good");
  await service.request("desktop/issues/delete", { id: issue.id }, user);
  await service.request("desktop/projects/delete", { id: project.id }, user);
  expect((await service.request("desktop/projects/list", {})).projects).toEqual([]);
});

test("launches a real thread once, links it, and leaves failed launches unchanged", async () => {
  const launchIssue = vi.fn<() => Promise<{ threadId: string }>>(async () => ({ threadId: "thread-new" }));
  const onEvent = vi.fn<() => void>();
  const { service, project } = await setup({ launchIssue, onEvent });
  const { issue } = await service.request("desktop/issues/create", { projectId: project.id, title: "Ship" }, user);
  const [a, b] = await Promise.all([
    service.request("desktop/issues/launch", { id: issue.id }, user),
    service.request("desktop/issues/launch", { id: issue.id }, user),
  ]);
  expect(a.threadId).toBe("thread-new");
  expect(b.threadId).toBe("thread-new");
  expect(launchIssue).toHaveBeenCalledTimes(1);
  expect(a.issue.status).toBe("in_progress");
  expect(onEvent).toHaveBeenCalledWith({ method: "desktop/issues/changed", params: {} });
  const { issue: other } = await service.request(
    "desktop/issues/create",
    { projectId: project.id, title: "Retry" },
    user,
  );
  launchIssue.mockRejectedValueOnce(new Error("offline"));
  await expect(service.request("desktop/issues/launch", { id: other.id }, user)).rejects.toThrow("offline");
  expect((await service.request("desktop/issues/read", { id: other.id })).issue).toMatchObject({
    threadIds: [],
    owner: { type: "roder" },
  });
});

test("never replaces corrupt storage with an empty database", async () => {
  const { storagePath } = await setup();
  await writeFile(storagePath, "not json");
  const service = new IssuesService({ storagePath });
  await expect(service.request("desktop/projects/create", { name: "Lost" }, user)).rejects.toThrow(/JSON/);
  expect(await readFile(storagePath, "utf8")).toBe("not json");
});

test("archives projects without losing issues and supports project and issue edits", async () => {
  const { service, project } = await setup();
  const { issue } = await service.request(
    "desktop/issues/create",
    {
      projectId: project.id,
      title: "Original",
      status: "todo",
    },
    user,
  );
  await service.request(
    "desktop/projects/update",
    {
      id: project.id,
      name: "Renamed",
      description: "Local work",
      archived: true,
    },
    user,
  );
  expect((await service.request("desktop/projects/list", { archived: true })).projects[0].name).toBe("Renamed");
  await expect(service.request("desktop/issues/create", { projectId: project.id, title: "New" }, user)).rejects.toThrow(
    "Unarchive",
  );
  await expect(service.request("desktop/issues/launch", { id: issue.id }, user)).rejects.toThrow("Unarchive");
  const updated = await service.request(
    "desktop/issues/update",
    {
      id: issue.id,
      title: "Resolved",
      description: "Proof",
      status: "done",
    },
    user,
  );
  expect(updated.issue).toMatchObject({ title: "Resolved", description: "Proof", status: "done" });
  await service.request("desktop/projects/update", { id: project.id, archived: false, workspaceId: null }, user);
  await expect(service.request("desktop/issues/launch", { id: issue.id }, user)).rejects.toThrow("Link the project");
});

test("notification failures do not report persisted writes as failed", async () => {
  const { service, storagePath, project } = await setup({
    onEvent: () => {
      throw new Error("Observer unavailable");
    },
  });
  await service.request("desktop/issues/create", { projectId: project.id, title: "Committed" }, user);
  expect((await new IssuesService({ storagePath }).request("desktop/issues/list")).issues).toHaveLength(1);
});

test("ensures one project per workspace across concurrent registration and restart", async () => {
  const { service, storagePath } = await setup();
  const params = {
    workspaceId: "roderAgent-workspace",
    name: "RoderAgent project",
    description: "Ship it",
    roderThreadId: "roderAgent-thread",
  };
  const results = await Promise.all(
    Array.from({ length: 20 }, () => service.request("desktop/projects/ensureWorkspace", params, user)),
  );
  expect(new Set(results.map(({ project }) => project.id)).size).toBe(1);
  expect(results[0].project).toMatchObject(params);
  const restarted = new IssuesService({ storagePath });
  const again = await restarted.request("desktop/projects/ensureWorkspace", params, user);
  expect(again.project.id).toBe(results[0].project.id);
  expect((await restarted.request("desktop/projects/list", { workspaceId: params.workspaceId })).projects).toHaveLength(
    1,
  );
});

test("workspace registration preserves existing project edits and archive state while linking its Roder", async () => {
  const { service, project } = await setup();
  await service.request(
    "desktop/projects/update",
    { id: project.id, archived: true, description: "Keep my notes" },
    user,
  );
  const { project: registered } = await service.request(
    "desktop/projects/ensureWorkspace",
    {
      workspaceId: "ws-1",
      name: "New workspace name",
      description: "New mission",
      roderThreadId: "roderAgent-1",
    },
    user,
  );
  expect(registered).toMatchObject({
    id: project.id,
    name: "Desktop",
    archived: true,
    description: "Keep my notes",
    roderThreadId: "roderAgent-1",
  });
  const { project: unchanged } = await service.request(
    "desktop/projects/ensureWorkspace",
    {
      workspaceId: "ws-1",
      name: "Ignored",
    },
    user,
  );
  expect(unchanged.roderThreadId).toBe("roderAgent-1");
  const { project: cleared } = await service.request(
    "desktop/projects/update",
    {
      id: project.id,
      roderThreadId: null,
    },
    user,
  );
  expect(cleared.roderThreadId).toBeNull();
  await expect(
    service.request("desktop/projects/ensureWorkspace", { workspaceId: " ", name: "Invalid" }, user),
  ).rejects.toThrow("workspaceId must be a non-empty string");
});

test("a version 1 store is moved aside, never deleted or overwritten, and the store starts fresh", async () => {
  const { storagePath } = await setup();
  const legacy = JSON.stringify({ version: 1, nextNumber: 2, projects: [], issues: [] });
  await writeFile(storagePath, legacy);
  const service = new IssuesService({ storagePath });
  expect((await service.request("desktop/projects/list", {})).projects).toEqual([]);
  await service.request("desktop/projects/create", { name: "Fresh" }, user);
  const backups = (await readdir(dirname(storagePath))).filter((name) => name.includes(".v1-"));
  expect(backups).toHaveLength(1);
  expect(await readFile(join(dirname(storagePath), backups[0]), "utf8")).toBe(legacy);
  expect(JSON.parse(await readFile(storagePath, "utf8"))).toMatchObject({ version: 2, projects: [{ name: "Fresh" }] });
});

test("unsupported store versions are reported, not replaced", async () => {
  const { storagePath } = await setup();
  await writeFile(storagePath, JSON.stringify({ version: 3 }));
  await expect(new IssuesService({ storagePath }).request("desktop/issues/list", {})).rejects.toThrow(
    "Unsupported issues database version",
  );
  expect(JSON.parse(await readFile(storagePath, "utf8"))).toEqual({ version: 3 });
});

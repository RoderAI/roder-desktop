import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { IssuesService } from "../electron/issues/service";
import { issueSaveFields } from "../src/lib/issues-ipc";

const user = { type: "user" } as const;
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "roder-issue-editor-"));
  directories.push(directory);
  const service = new IssuesService({ storagePath: join(directory, "issues.json") });
  const { project } = await service.request("desktop/projects/create", { name: "One" }, user);
  const { project: other } = await service.request("desktop/projects/create", { name: "Two" }, user);
  return { service, project, other };
}

const form = {
  title: "Work",
  description: "",
  status: "backlog" as const,
  priority: "normal" as const,
  owner: "roder",
  doneCriteria: "",
  outOfScope: "",
  parent: "",
};

test("a new issue created in needs_you is saved waiting on the user", async () => {
  const { service, project } = await setup();
  const fields = issueSaveFields({ ...form, projectId: project.id, status: "needs_you" }, { isNew: true, issues: [] });
  const { issue } = await service.request("desktop/issues/create", fields, user);
  expect(issue).toMatchObject({ status: "needs_you", owner: { type: "user" } });
});

test("editing an existing issue keeps the chosen owner", async () => {
  const { project } = await setup();
  const fields = issueSaveFields(
    { ...form, projectId: project.id, status: "needs_you", owner: "thread:t1" },
    { isNew: false, issues: [] },
  );
  expect(fields.owner).toEqual({ type: "thread", threadId: "t1" });
});

test("moving an issue to another project drops a parent left in the old one", async () => {
  const { service, project, other } = await setup();
  const { issue: parent } = await service.request("desktop/issues/create", { projectId: project.id, title: "P" }, user);
  const { issue: child } = await service.request(
    "desktop/issues/create",
    { projectId: project.id, title: "C", parent: parent.id },
    user,
  );
  const { issues } = await service.request("desktop/issues/list", {});
  const fields = issueSaveFields(
    { ...form, title: "C", projectId: other.id, parent: parent.id },
    { isNew: false, issues },
  );
  const { issue } = await service.request("desktop/issues/update", { id: child.id, ...fields }, user);
  expect(issue).toMatchObject({ projectId: other.id, parent: null });
  expect(issueSaveFields({ ...form, projectId: project.id, parent: parent.id }, { isNew: false, issues }).parent).toBe(
    parent.id,
  );
});

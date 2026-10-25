import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { IssuesService } from "../electron/issues/service";
import { handleIssueToolCall, issueToolDefinitions } from "../electron/issues/tools";

test("discoverable agent tools share the same records as desktop requests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "roder-issue-tools-"));
  try {
    const service = new IssuesService({ storagePath: join(directory, "db.json") });
    expect(new Set(issueToolDefinitions.map((tool) => tool.name)).size).toBe(11);
    const { project } = await service.request("desktop/projects/create", { name: "Shared" });
    await handleIssueToolCall(service, "projects_update", {
      id: project.id,
      persistentAgentThreadId: "persistentAgent-thread",
    });
    expect(await handleIssueToolCall(service, "projects_read", { id: project.id })).toMatchObject({
      project: { persistentAgentThreadId: "persistentAgent-thread" },
    });
    const created = (await handleIssueToolCall(service, "issues_create", {
      projectId: project.id,
      title: "Agent report",
      threadId: "origin-thread",
    })) as { issue: { id: string } };
    expect((await service.request("desktop/issues/read", { id: created.issue.id })).issue.threadId).toBe(
      "origin-thread",
    );
    await handleIssueToolCall(service, "issues_update", {
      id: created.issue.id,
      status: "done",
      description: "Resolved",
      threadId: null,
    });
    const { issues } = await service.request("desktop/issues/list", { status: "done", threadId: null });
    expect(issues).toHaveLength(1);
    expect(issues[0].description).toBe("Resolved");
    await expect(handleIssueToolCall(service, "unknown", {})).rejects.toThrow("Unknown issue tool");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

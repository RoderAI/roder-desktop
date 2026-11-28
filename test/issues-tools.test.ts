import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { IssuesService } from "../electron/issues/service";
import { handleIssueToolCall, issueToolDefinitions } from "../electron/issues/tools";

const user = { type: "user" } as const;
const caller = { threadId: "origin-thread" };

test("discoverable agent tools share the same records as desktop requests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "roder-issue-tools-"));
  try {
    const service = new IssuesService({ storagePath: join(directory, "db.json") });
    expect(new Set(issueToolDefinitions.map((tool) => tool.name)).size).toBe(15);
    const { project } = await service.request("desktop/projects/create", { name: "Shared" }, user);
    await handleIssueToolCall(
      service,
      "projects_update",
      { id: project.id, roderThreadId: "roderAgent-thread" },
      caller,
    );
    expect(await handleIssueToolCall(service, "projects_read", { id: project.id }, caller)).toMatchObject({
      project: { roderThreadId: "roderAgent-thread" },
    });
    await expect(handleIssueToolCall(service, "unknown", {}, caller)).rejects.toThrow("Unknown issue tool");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a thread that is not a Roder can file, take, report on and close an issue", async () => {
  const directory = await mkdtemp(join(tmpdir(), "roder-issue-tools-"));
  try {
    const service = new IssuesService({ storagePath: join(directory, "db.json") });
    // A plain project: no workspace and no Roder.
    const { project } = await service.request("desktop/projects/create", { name: "Plain" }, user);
    const call = (name: string, args: unknown) => handleIssueToolCall(service, name, args, caller);
    const { issue } = (await call("issues_create", {
      projectId: project.id,
      title: "Agent report",
      status: "todo",
      doneCriteria: "The bug no longer reproduces",
      priority: "high",
      owner: { type: "thread", threadId: caller.threadId },
    })) as { issue: { id: string } };
    expect((await service.request("desktop/issues/read", { id: issue.id })).issue).toMatchObject({
      owner: { type: "thread", threadId: "origin-thread" },
      threadIds: ["origin-thread"],
      priority: "high",
    });
    await call("issues_update", { id: issue.id, status: "in_progress", description: "Investigating" });
    await call("issues_comment", { id: issue.id, text: "Found it" });
    await expect(call("issues_update", { id: issue.id, status: "done" })).rejects.toThrow("issues_close");
    await call("issues_link_pull_request", { id: issue.id, url: "https://github.com/team/repo/pull/3", title: "Fix" });
    await call("issues_update", { id: issue.id, status: "in_review" });
    await call("issues_close", { id: issue.id, outcome: "merged", note: "Merged after review" });
    const { issues } = await service.request("desktop/issues/list", { status: "done", threadId: "origin-thread" });
    expect(issues).toHaveLength(1);
    expect(issues[0].description).toBe("Investigating");
    // Every entry the tools wrote is attributed to the calling thread.
    expect(issues[0].activity.map((entry) => [entry.kind, entry.actor])).toEqual(
      ["created", "updated", "comment", "pullRequest", "updated", "closed"].map((kind) => [
        kind,
        { type: "thread", threadId: "origin-thread" },
      ]),
    );
    await expect(call("issues_ask_user", { id: issue.id, question: "Reopen?" })).rejects.toThrow("reopen the issue");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("tool calls act as the calling agent, not the user", async () => {
  const directory = await mkdtemp(join(tmpdir(), "roder-issue-tools-"));
  try {
    const service = new IssuesService({ storagePath: join(directory, "db.json") });
    const { project } = await service.request("desktop/projects/create", { name: "Plain" }, user);
    await expect(
      handleIssueToolCall(
        service,
        "issues_create",
        { projectId: project.id, title: "Do", status: "done", doneCriteria: "Done" },
        caller,
      ),
    ).rejects.toThrow("new issues start in backlog or todo");
    for (const tool of issueToolDefinitions)
      expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

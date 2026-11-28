import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { DesktopAgentTools } from "../electron/agents/desktop-agent-tools";
import { IssuesService } from "../electron/issues/service";
import { handleIssueToolCall, issueToolDefinitions } from "../electron/issues/tools";

test("engine-issued desktop tool calls manage the same persisted issues the UI reads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "desktop-issue-tools-"));
  try {
    const service = new IssuesService({ storagePath: join(directory, "issues.json") });
    const replies: Array<{ output: string; isError: boolean }> = [];
    const bridge = new DesktopAgentTools(
      issueToolDefinitions.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
        execute: (args, context) => handleIssueToolCall(service, tool.name, args, context),
      })),
      async (method, params) => {
        expect(method).toBe("tools/resolve");
        replies.push(params as { output: string; isError: boolean });
        return { resolved: true };
      },
    );
    let next = 0;
    async function call(name: string, args: unknown) {
      await bridge.onNotification("thread/toolExecutionRequested", {
        threadId: "agent-thread",
        turnId: "agent-turn",
        requestId: `request-${++next}`,
        call: { name, arguments: args },
      });
      const result = replies.at(-1)!;
      expect(result.isError).toBe(false);
      return JSON.parse(result.output);
    }
    const { project } = await call("projects_create", { name: "Agent project", workspaceId: "workspace-1" });
    const { issue } = await call("issues_create", {
      projectId: project.id,
      title: "Fix regression",
      owner: { type: "thread", threadId: "agent-thread" },
    });
    await call("issues_update", { id: issue.id, status: "in_progress", description: "Verified the fix" });
    await call("issues_close", { id: issue.id, outcome: "dropped", note: "Fixed upstream" });
    const reloaded = new IssuesService({ storagePath: join(directory, "issues.json") });
    expect(await reloaded.request("desktop/issues/list", {})).toMatchObject({
      issues: [{ id: issue.id, status: "cancelled", description: "Verified the fix", threadIds: ["agent-thread"] }],
    });
    // The engine's calling thread is the actor: agents can't skip the lifecycle.
    const { issue: other } = await call("issues_create", { projectId: project.id, title: "Next" });
    await bridge.onNotification("thread/toolExecutionRequested", {
      threadId: "agent-thread",
      turnId: "agent-turn",
      requestId: `request-${++next}`,
      call: { name: "issues_update", arguments: { id: other.id, status: "done" } },
    });
    expect(replies.at(-1)).toMatchObject({ isError: true });
    expect((await reloaded.request("desktop/issues/read", { id: other.id })).issue.activity[0].actor).toEqual({
      type: "thread",
      threadId: "agent-thread",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

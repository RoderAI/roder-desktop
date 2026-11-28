import { issueOutcomes, issuePriorities, issueStatuses } from "../../src/types/issues";
import type { IssuesService } from "./service";

const string = { type: "string" };
const nullableString = { type: ["string", "null"] };
const status = { type: "string", enum: issueStatuses };
// Flat rather than oneOf: not every provider's function-calling schema accepts
// oneOf, and no other desktop tool uses it. The service enforces the variants.
const owner = {
  type: "object",
  description:
    'Who holds the issue, one of: {type: "roder"} (the project\'s Roder) or {type: "thread", threadId} (a thread doing the work, which also links it). threadId is required for thread and not allowed otherwise. To hand the issue to the user, use issues_ask_user.',
  properties: {
    type: { type: "string", enum: ["roder", "thread"] },
    threadId: { type: "string", description: 'Required when type is "thread"; omit it for "roder".' },
  },
  required: ["type"],
  additionalProperties: false,
};
const projectFields = {
  name: string,
  description: string,
  workspaceId: nullableString,
  roderThreadId: nullableString,
  archived: { type: "boolean" },
};
const issueFields = {
  projectId: string,
  title: string,
  description: string,
  status,
  priority: { type: "string", enum: issuePriorities },
  owner,
  doneCriteria: { type: "string", description: "What must be true for the issue to be done." },
  outOfScope: { type: "string", description: "What the issue deliberately leaves alone." },
  parent: { ...nullableString, description: "ID of the issue in the same project this one is part of." },
};

function tool(
  name: string,
  method: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    name,
    method,
    description,
    inputSchema: { type: "object", properties, required, additionalProperties: false },
  };
}

export const issueToolDefinitions = [
  tool(
    "projects_list",
    "desktop/projects/list",
    "List local projects. workspaceId is the existing Roder workspace identity, not a filesystem path.",
    { workspaceId: string, archived: { type: "boolean" } },
  ),
  tool("projects_read", "desktop/projects/read", "Read a local project.", { id: string }, ["id"]),
  tool(
    "projects_create",
    "desktop/projects/create",
    "Create a local project, optionally linked to an existing Roder workspace. No external synchronization.",
    { name: string, description: string, workspaceId: nullableString },
    ["name"],
  ),
  tool(
    "projects_update",
    "desktop/projects/update",
    "Edit, archive, or unarchive a local project.",
    { id: string, ...projectFields },
    ["id"],
  ),
  tool(
    "projects_delete",
    "desktop/projects/delete",
    "Delete an empty local project. Archive projects with issue history instead.",
    { id: string },
    ["id"],
  ),
  tool(
    "issues_list",
    "desktop/issues/list",
    "List local issues, optionally filtering by project, status, linked thread, or search text. threadId null finds issues no thread has worked on.",
    { projectId: string, status, threadId: nullableString, query: string },
  ),
  tool(
    "issues_read",
    "desktop/issues/read",
    "Read a local issue including its owner, doneCriteria, linked threads, pull requests and activity.",
    { id: string },
    ["id"],
  ),
  tool(
    "issues_create",
    "desktop/issues/create",
    "Create an issue in a local project. New issues start in backlog (default) or todo; todo needs doneCriteria. Owner defaults to the Roder; set a thread owner to take it yourself.",
    issueFields,
    ["projectId", "title"],
  ),
  tool(
    "issues_update",
    "desktop/issues/update",
    "Edit an issue, change its owner, priority or status. in_progress needs a linked thread or a child issue in progress, in_review a linked pull request. Close with issues_close and hand over to the user with issues_ask_user. doneCriteria can be edited but not cleared.",
    { id: string, ...issueFields },
    ["id"],
  ),
  tool(
    "issues_comment",
    "desktop/issues/comment",
    "Add a comment to an issue's activity: progress, findings, blockers.",
    { id: string, text: string },
    ["id", "text"],
  ),
  tool(
    "issues_link_pull_request",
    "desktop/issues/linkPullRequest",
    "Link a GitHub pull request (https://github.com/<owner>/<repo>/pull/<n>) to an issue.",
    { id: string, url: string, title: string },
    ["id", "url"],
  ),
  tool(
    "issues_ask_user",
    "desktop/issues/askUser",
    "Hand an open issue to the user with a question: the user becomes the owner and the status needs_you. Their reply hands it back to the newest linked thread, else the Roder.",
    { id: string, question: string, recommendation: string },
    ["id", "question"],
  ),
  tool(
    "issues_close",
    "desktop/issues/close",
    "Close an issue. outcome merged (needs a linked pull request) moves it to done; dropped moves it to cancelled. The note says what happened. Closing an already closed issue changes nothing.",
    { id: string, outcome: { type: "string", enum: issueOutcomes }, note: string },
    ["id", "outcome", "note"],
  ),
  tool(
    "issues_delete",
    "desktop/issues/delete",
    "Permanently delete a local issue. Prefer issues_close to preserve history.",
    { id: string },
    ["id"],
  ),
  tool(
    "issues_launch",
    "desktop/issues/launch",
    "Launch work on an issue in its linked workspace; the new thread becomes the owner and the issue moves to in_progress. If a thread already owns it, return that thread without launching again.",
    { id: string },
    ["id"],
  ),
];

/** Tool calls always act as the calling agent's thread, never as the user. */
export async function handleIssueToolCall(
  service: IssuesService,
  name: string,
  args: unknown,
  context: { threadId: string },
): Promise<unknown> {
  const definition = issueToolDefinitions.find((item) => item.name === name);
  if (!definition) throw new Error(`Unknown issue tool: ${name}`);
  return service.request(definition.method, args, { type: "agent", threadId: context.threadId });
}

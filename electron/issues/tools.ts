import { issueStatuses } from "../../src/types/issues";
import type { IssuesService } from "./service";

const string = { type: "string" };
const nullableString = { type: ["string", "null"] };
const status = { type: "string", enum: issueStatuses };
const projectFields = {
  name: string,
  description: string,
  workspaceId: nullableString,
  persistentAgentThreadId: nullableString,
  archived: { type: "boolean" },
};
const issueFields = { projectId: string, title: string, description: string, status, threadId: nullableString };

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
    "List local issues, optionally filtering by project, status, assigned thread, or search text. threadId null finds unassigned issues.",
    { projectId: string, status, threadId: nullableString, query: string },
  ),
  tool(
    "issues_read",
    "desktop/issues/read",
    "Read a local issue including its description and assigned thread.",
    { id: string },
    ["id"],
  ),
  tool(
    "issues_create",
    "desktop/issues/create",
    "Create an issue in a local project. Default status is backlog.",
    issueFields,
    ["projectId", "title"],
  ),
  tool(
    "issues_update",
    "desktop/issues/update",
    "Edit or move a local issue, change status, or assign a thread. Use threadId null to unassign.",
    { id: string, ...issueFields },
    ["id"],
  ),
  tool(
    "issues_delete",
    "desktop/issues/delete",
    "Permanently delete a local issue. Prefer done or cancelled status to preserve history.",
    { id: string },
    ["id"],
  ),
  tool(
    "issues_launch",
    "desktop/issues/launch",
    "Launch work on an issue in its linked workspace and assign the resulting thread. If already assigned, return that thread without launching again.",
    { id: string },
    ["id"],
  ),
];

export async function handleIssueToolCall(service: IssuesService, name: string, args: unknown): Promise<unknown> {
  const definition = issueToolDefinitions.find((item) => item.name === name);
  if (!definition) throw new Error(`Unknown issue tool: ${name}`);
  return service.request(definition.method, args);
}

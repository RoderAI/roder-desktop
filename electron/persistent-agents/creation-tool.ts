export const persistentAgentCreateTool = {
  name: "persistent_agent_create",
  description:
    "Create a paused persistent agent for a workspace. Use only when the user asks to create one. Omit workspace selectors to use the calling thread's workspace, or pass workspaceName for an existing workspace by name. Does not enable scheduled or proactive runs.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Display name", maxLength: 120 },
      mission: { type: "string", description: "Long-lived mission", maxLength: 16000 },
      workspaceId: { type: "string", description: "Existing workspace ID; defaults to this thread's workspace" },
      workspaceName: {
        type: "string",
        description: "Existing workspace name, resolved without guessing; do not combine with workspaceId",
      },
      modelProvider: { type: "string" },
      model: { type: "string" },
      reasoning: { type: "string" },
    },
    required: ["name", "mission"],
    additionalProperties: false,
  },
};

export const persistentAgentWorkspacesTool = {
  name: "persistent_agent_workspaces",
  description:
    "List existing desktop workspaces and their IDs to choose where to create a persistent agent. These are not issue projects.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
};

export async function listPersistentAgentWorkspaces(
  args: unknown,
  request: (method: string, params: unknown) => Promise<unknown>,
): Promise<unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length)
    throw new Error("Expected an empty object");
  return request("workspace/list", {});
}

export async function createPersistentAgentFromTool(
  args: unknown,
  threadId: string,
  request: (method: string, params: unknown) => Promise<unknown>,
): Promise<unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Expected an object");
  const input = { ...args } as Record<string, unknown>;
  const allowed = new Set(Object.keys(persistentAgentCreateTool.parameters.properties));
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new Error("Unexpected persistent agent argument");
  for (const [key, maximum] of Object.entries({
    name: 120,
    mission: 16000,
    workspaceId: 500,
    workspaceName: 500,
    modelProvider: 500,
    model: 500,
    reasoning: 100,
  })) {
    const value = input[key];
    if (value === undefined && key !== "name" && key !== "mission") continue;
    // Some tool providers supply empty strings for omitted optional fields.
    if (typeof value === "string" && !value.trim() && key !== "name" && key !== "mission") {
      delete input[key];
      continue;
    }
    if (typeof value !== "string" || !value.trim() || value.length > maximum)
      throw new Error(`Invalid persistent agent ${key}`);
  }
  if (!!input.model !== !!input.modelProvider) throw new Error("Choose both model and model provider");
  if (input.workspaceId && input.workspaceName) throw new Error("Choose either workspaceId or workspaceName");
  let workspaceId = input.workspaceId;
  if (input.workspaceName) {
    const result = await request("workspace/list", {});
    const workspaces = (result as { workspaces?: { id: string; name: string }[] } | null)?.workspaces ?? [];
    const matches = workspaces.filter((workspace) => workspace.name === String(input.workspaceName).trim());
    if (matches.length !== 1)
      throw new Error(
        matches.length
          ? "Multiple workspaces have that name; use persistent_agent_workspaces and select a workspaceId"
          : "Workspace not found; use persistent_agent_workspaces to list existing workspace names and IDs",
      );
    workspaceId = matches[0].id;
  }
  if (workspaceId === undefined) {
    const result = await request("thread/read", { threadId, includeTurns: false });
    const thread = (result as { thread?: { workspaceId?: unknown } } | null)?.thread;
    workspaceId = thread?.workspaceId;
    if (typeof workspaceId !== "string" || !workspaceId) {
      throw new Error(
        "This thread has no workspace; use persistent_agent_workspaces to select an existing workspaceId or workspaceName",
      );
    }
  }
  const { workspaceName: _workspaceName, ...creation } = input;
  return request("desktop/persistent-agents/create", { ...creation, workspaceId });
}

export const persistentAgentSkillBody = `# Persistent agent

Use this built-in skill when the user asks to create a persistent agent, a long-lived project assistant, or invokes $persistent-agent. It is available in Roder Desktop outside the application repository.

Ask only for missing details: the agent's display name and long-lived mission. Reuse details already provided; do not ask the user to fill out the UI. Default to the calling thread's workspace by omitting optional workspace fields. Empty optional strings are treated as omitted, not evidence that this thread has no workspace. For a requested workspace such as roder-site, pass workspaceName directly. Use persistent_agent_workspaces to discover existing workspaces when needed; projects_list lists issue projects, not workspaces. Never ask the user to find an internal ID when lookup can resolve their workspace name. For duplicate names, ask them to choose from the returned workspaces; never guess or create a workspace.

Call persistent_agent_create with name and mission. Pass modelProvider and model together, and reasoning, only when the user requested them. Use only advertised tools; if this older thread lacks the creation tool, ask the user to start a new chat.

New agents start paused. Creating one does not authorize enabling proactive work, scheduling wakes, or starting a run. Never invent a scheduler or change budgets. Explain that proactive work requires user enablement and the desktop must remain running.

After the tool succeeds, report the returned agent ID, workspace ID, thread ID, and paused status. Preserve backend errors, use workspace lookup for workspace selection errors, and ask only for genuinely missing information. Never claim success before the tool returns. A mission mentioning several repositories does not itself configure access or monitoring across those repositories; explain any access that still needs to be set up.`;

export const persistentAgentSkill = {
  id: "builtin:persistent-agent",
  name: "persistent-agent",
  canonicalPath: "roder-builtin://persistent-agent/SKILL.md",
  source: "builtIn" as const,
  exposure: "direct_only" as const,
  activation: "enabled" as const,
  experimental: false,
  diagnostics: [],
  shortDescription: "Create a desktop persistent agent",
  description:
    "Use when the user asks to create a persistent agent, or invokes $persistent-agent. Create it with persistent_agent_create; new agents start paused.",
  agentMetadata: {
    raw: {
      instructions: [persistentAgentSkillBody],
    },
  },
};

export function readPersistentAgentSkill(
  params: unknown,
): { skill: { descriptor: typeof persistentAgentSkill; body: string } } | undefined {
  const selector = (params as { selector?: { name?: { name?: unknown }; path?: { path?: unknown } } } | null)?.selector;
  if (selector?.name?.name !== persistentAgentSkill.name && selector?.path?.path !== persistentAgentSkill.canonicalPath)
    return undefined;
  return { skill: { descriptor: persistentAgentSkill, body: persistentAgentSkillBody } };
}

export function mergePersistentAgentSkill(baseResult: unknown): { skills: unknown[]; diagnostics: unknown[] } {
  const base = baseResult as { skills?: unknown[]; diagnostics?: unknown[] } | null;
  const skills = Array.isArray(base?.skills) ? base.skills : [];
  return {
    ...(base && typeof base === "object" ? base : {}),
    skills: [
      ...skills.filter(
        (skill) =>
          !skill || typeof skill !== "object" || (skill as { name?: unknown }).name !== persistentAgentSkill.name,
      ),
      persistentAgentSkill,
    ],
    diagnostics: Array.isArray(base?.diagnostics) ? base.diagnostics : [],
  };
}

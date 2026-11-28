export const roderAgentCreateTool = {
  name: "roder_create",
  description:
    "Create a paused Roder for a workspace. Use only when the user asks to create one. Omit workspace selectors to use the calling thread's workspace, or pass workspaceName for an existing workspace by name. Does not enable scheduled or proactive runs.",
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

export const roderAgentWorkspacesTool = {
  name: "roder_workspaces",
  description:
    "List existing desktop workspaces and their IDs to choose where to create a Roder. These are not issue projects.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
};

export async function listRoderAgentWorkspaces(
  args: unknown,
  request: (method: string, params: unknown) => Promise<unknown>,
): Promise<unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length)
    throw new Error("Expected an empty object");
  return request("workspace/list", {});
}

export async function createRoderAgentFromTool(
  args: unknown,
  threadId: string,
  request: (method: string, params: unknown) => Promise<unknown>,
): Promise<unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Expected an object");
  const input = { ...args } as Record<string, unknown>;
  const allowed = new Set(Object.keys(roderAgentCreateTool.parameters.properties));
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new Error("Unexpected Roder argument");
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
    if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error(`Invalid Roder ${key}`);
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
          ? "Multiple workspaces have that name; use roder_workspaces and select a workspaceId"
          : "Workspace not found; use roder_workspaces to list existing workspace names and IDs",
      );
    workspaceId = matches[0].id;
  }
  if (workspaceId === undefined) {
    const result = await request("thread/read", { threadId, includeTurns: false });
    const thread = (result as { thread?: { workspaceId?: unknown } } | null)?.thread;
    workspaceId = thread?.workspaceId;
    if (typeof workspaceId !== "string" || !workspaceId) {
      throw new Error(
        "This thread has no workspace; use roder_workspaces to select an existing workspaceId or workspaceName",
      );
    }
  }
  const { workspaceName: _workspaceName, ...creation } = input;
  return request("desktop/roders/create", { ...creation, workspaceId });
}

export const roderAgentSkillBody = `# Roder

Use this built-in skill when the user asks to create a Roder, a long-lived project assistant, or invokes $roder. It is available in Roder Desktop outside the application repository.

Ask only for missing details: the agent's display name and long-lived mission. Reuse details already provided; do not ask the user to fill out the UI. Default to the calling thread's workspace by omitting optional workspace fields. Empty optional strings are treated as omitted, not evidence that this thread has no workspace. For a requested workspace such as roder-site, pass workspaceName directly. Use roder_workspaces to discover existing workspaces when needed; projects_list lists issue projects, not workspaces. Never ask the user to find an internal ID when lookup can resolve their workspace name. For duplicate names, ask them to choose from the returned workspaces; never guess or create a workspace.

Call roder_create with name and mission. Pass modelProvider and model together, and reasoning, only when the user requested them. Use only advertised tools; if this older thread lacks the creation tool, ask the user to start a new chat.

New agents start paused. Creating one does not authorize enabling proactive work, scheduling wakes, or starting a run. Never invent a scheduler or change budgets. Explain that proactive work requires user enablement and the desktop must remain running.

After the tool succeeds, report the returned agent ID, workspace ID, thread ID, and paused status. Preserve backend errors, use workspace lookup for workspace selection errors, and ask only for genuinely missing information. Never claim success before the tool returns. A mission mentioning several repositories does not itself configure access or monitoring across those repositories; explain any access that still needs to be set up.`;

export const roderAgentSkill = {
  id: "builtin:roder",
  name: "roder",
  canonicalPath: "roder-builtin://roder/SKILL.md",
  source: "builtIn" as const,
  exposure: "direct_only" as const,
  activation: "enabled" as const,
  experimental: false,
  diagnostics: [],
  shortDescription: "Create a desktop Roder",
  description:
    "Use when the user asks to create a Roder, or invokes $roder. Create it with roder_create; new agents start paused.",
  agentMetadata: {
    raw: {
      instructions: [roderAgentSkillBody],
    },
  },
};

export function readRoderAgentSkill(
  params: unknown,
): { skill: { descriptor: typeof roderAgentSkill; body: string } } | undefined {
  const selector = (params as { selector?: { name?: { name?: unknown }; path?: { path?: unknown } } } | null)?.selector;
  if (selector?.name?.name !== roderAgentSkill.name && selector?.path?.path !== roderAgentSkill.canonicalPath)
    return undefined;
  return { skill: { descriptor: roderAgentSkill, body: roderAgentSkillBody } };
}

export function mergeRoderAgentSkill(baseResult: unknown): { skills: unknown[]; diagnostics: unknown[] } {
  const base = baseResult as { skills?: unknown[]; diagnostics?: unknown[] } | null;
  const skills = Array.isArray(base?.skills) ? base.skills : [];
  return {
    ...(base && typeof base === "object" ? base : {}),
    skills: [
      ...skills.filter(
        (skill) => !skill || typeof skill !== "object" || (skill as { name?: unknown }).name !== roderAgentSkill.name,
      ),
      roderAgentSkill,
    ],
    diagnostics: Array.isArray(base?.diagnostics) ? base.diagnostics : [],
  };
}

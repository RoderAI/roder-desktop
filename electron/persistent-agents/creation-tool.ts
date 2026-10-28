export const persistentAgentCreateTool = {
  name: "persistent_agent_create",
  description:
    "Create a paused persistent agent for a workspace. Use only when the user asks to create one. If workspaceId is omitted, use the calling thread's workspace. Does not enable scheduled or proactive runs.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Display name", maxLength: 120 },
      mission: { type: "string", description: "Long-lived mission", maxLength: 16000 },
      workspaceId: { type: "string", description: "Existing workspace ID; defaults to this thread's workspace" },
      modelProvider: { type: "string" },
      model: { type: "string" },
      reasoning: { type: "string" },
    },
    required: ["name", "mission"],
    additionalProperties: false,
  },
};

export async function createPersistentAgentFromTool(
  args: unknown,
  threadId: string,
  request: (method: string, params: unknown) => Promise<unknown>,
): Promise<unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Expected an object");
  const input = args as Record<string, unknown>;
  const allowed = new Set(Object.keys(persistentAgentCreateTool.parameters.properties));
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new Error("Unexpected persistent agent argument");
  for (const [key, maximum] of Object.entries({
    name: 120,
    mission: 16000,
    workspaceId: 500,
    modelProvider: 500,
    model: 500,
    reasoning: 100,
  })) {
    const value = input[key];
    if (value === undefined && key !== "name" && key !== "mission") continue;
    if (typeof value !== "string" || !value.trim() || value.length > maximum)
      throw new Error(`Invalid persistent agent ${key}`);
  }
  if (!!input.model !== !!input.modelProvider) throw new Error("Choose both model and model provider");
  let workspaceId = input.workspaceId;
  if (workspaceId === undefined) {
    const result = await request("thread/read", { threadId, includeTurns: false });
    const thread = (result as { thread?: { workspaceId?: unknown } } | null)?.thread;
    workspaceId = thread?.workspaceId;
    if (typeof workspaceId !== "string" || !workspaceId) {
      throw new Error("This thread has no workspace; specify an existing workspaceId");
    }
  }
  return request("desktop/persistent-agents/create", { ...input, workspaceId });
}

export const persistentAgentSkillBody = `# Persistent agent

Use this built-in skill when the user asks to create a persistent agent, a long-lived project assistant, or invokes $persistent-agent. It is available in Roder Desktop outside the application repository.

Ask only for missing details: the agent's display name and long-lived mission. Reuse details already provided; do not ask the user to fill out the UI. Default to the calling thread's workspace. Ask for an existing workspace ID only if the user wants a different workspace or the tool reports that this thread has none.

Call persistent_agent_create with name and mission. Pass modelProvider and model together, and reasoning, only when the user requested them. Use only advertised tools; if this older thread lacks the creation tool, ask the user to start a new chat.

New agents start paused. Creating one does not authorize enabling proactive work, scheduling wakes, or starting a run. Never invent a scheduler or change budgets. Explain that proactive work requires user enablement and the desktop must remain running.

After the tool succeeds, report the returned agent ID, workspace ID, thread ID, and paused status. Preserve any backend error and ask for the missing information; never claim success before the tool returns.`;

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

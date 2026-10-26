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
      instructions: [
        "Ask for a name and mission if missing. Use persistent_agent_create with both. The tool defaults to the current thread's workspace; supply workspaceId only if the user chooses a different workspace.",
        "A new persistent agent starts paused. Do not enable proactive work, schedule a wake, or start a run unless the user explicitly requests it.",
        "Report the returned agent id, workspace id, thread id and paused status. Never claim creation succeeded before the tool returns.",
      ],
    },
  },
};

export function mergePersistentAgentSkill(baseResult: unknown): { skills: unknown[]; diagnostics: unknown[] } {
  const base = baseResult as { skills?: unknown[]; diagnostics?: unknown[] } | null;
  const skills = Array.isArray(base?.skills) ? base.skills : [];
  return {
    ...(base && typeof base === "object" ? base : {}),
    skills: [
      ...skills.filter(
        (skill) => !skill || typeof skill !== "object" || (skill as { name?: unknown }).name !== persistentAgentSkill.name,
      ),
      persistentAgentSkill,
    ],
    diagnostics: Array.isArray(base?.diagnostics) ? base.diagnostics : [],
  };
}

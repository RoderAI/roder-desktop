type EngineRequest = (method: string, params: unknown) => Promise<unknown>;

export async function applyDesktopTurnPolicy(request: EngineRequest, params: unknown): Promise<unknown> {
  if (!params || typeof params !== "object" || Array.isArray(params)) return params;
  const { threadId, policyMode, ...rest } = params as Record<string, unknown>;
  if (typeof threadId !== "string" || policyMode === undefined) return params;

  // The app-server's turn/start policyMode sets the runtime-wide mode, not the thread override.
  await request("thread/set_mode", { threadId, mode: policyMode, reason: "desktop turn permissions" });
  return { threadId, ...rest };
}

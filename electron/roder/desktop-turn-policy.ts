type EngineRequest = (method: string, params: unknown) => Promise<unknown>;

export async function applyDesktopTurnPolicy(request: EngineRequest, params: unknown): Promise<unknown> {
  if (!params || typeof params !== "object" || Array.isArray(params)) return params;
  const { threadId, policyMode, ...rest } = params as Record<string, unknown>;
  if (typeof threadId !== "string" || policyMode === undefined) return params;

  // The app-server's turn/start policyMode sets the runtime-wide mode, not the thread override.
  const result = await request("thread/set_mode", { threadId, mode: policyMode, reason: "desktop turn permissions" });
  const appliedMode = result && typeof result === "object" && "mode" in result ? result.mode : undefined;
  if (appliedMode !== policyMode) {
    throw new Error(
      `Could not apply thread permissions: requested ${String(policyMode)}, engine applied ${typeof appliedMode === "string" ? appliedMode : "an unknown mode"}.`,
    );
  }
  return { threadId, ...rest };
}

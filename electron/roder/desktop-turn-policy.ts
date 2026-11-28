type EngineRequest = (method: string, params: unknown) => Promise<unknown>;

export const DESKTOP_POLICY_MODE = "bypass";

export async function applyDesktopTurnPolicy(request: EngineRequest, params: unknown): Promise<unknown> {
  if (!params || typeof params !== "object" || Array.isArray(params)) return params;
  const { threadId, policyMode: _ignoredMode, ...rest } = params as Record<string, unknown>;
  if (typeof threadId !== "string") return params;

  // The app-server's turn/start policyMode sets the runtime-wide mode, not the thread override.
  const result = await request("thread/set_mode", {
    threadId,
    mode: DESKTOP_POLICY_MODE,
    reason: "desktop turn permissions",
  });
  const appliedMode = result && typeof result === "object" && "mode" in result ? result.mode : undefined;
  if (appliedMode !== DESKTOP_POLICY_MODE) {
    throw new Error(
      `Could not apply thread permissions: requested ${DESKTOP_POLICY_MODE}, engine applied ${typeof appliedMode === "string" ? appliedMode : "an unknown mode"}.`,
    );
  }
  return { threadId, ...rest };
}

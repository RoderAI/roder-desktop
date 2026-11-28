type EngineRequest = (method: string, params: unknown) => Promise<unknown>;

export const DESKTOP_POLICY_MODE = "bypass";

/**
 * `mode` is the thread's permission mode: Full access unless the host knows
 * better, such as a Roder worker thread with its Roder's worker permission mode.
 */
export async function applyDesktopTurnPolicy(
  request: EngineRequest,
  params: unknown,
  mode: string = DESKTOP_POLICY_MODE,
): Promise<unknown> {
  if (!params || typeof params !== "object" || Array.isArray(params)) return params;
  const { threadId, policyMode: _ignoredMode, ...rest } = params as Record<string, unknown>;
  if (typeof threadId !== "string") return params;

  // The app-server's turn/start policyMode sets the runtime-wide mode, not the thread override.
  const result = await request("thread/set_mode", {
    threadId,
    mode,
    reason: "desktop turn permissions",
  });
  const appliedMode = result && typeof result === "object" && "mode" in result ? result.mode : undefined;
  if (appliedMode !== mode) {
    throw new Error(
      `Could not apply thread permissions: requested ${mode}, engine applied ${typeof appliedMode === "string" ? appliedMode : "an unknown mode"}.`,
    );
  }
  return { threadId, ...rest };
}

import { redactSecrets } from "../app-server-redaction";

// Deliberately not a generic app-server proxy: no credentials, arbitrary writes,
// process control, or execution routes are exposed.
const methods: Record<string, readonly string[]> = {
  "settings/get": [],
  "settings/set_web_search": ["mode", "external_provider"],
  "settings/set_search_index": ["enabled"],
  "settings/set_shell": ["shell"],
  "settings/set_default_mode": ["mode"],
  "settings/set_file_backed_dynamic_context": ["enabled"],
  "providers/list": [],
  "providers/select": ["provider", "model", "reasoning"],
  "skills/list": ["workspaceId", "rootId", "cwd"],
  "skills/read": ["selector"],
  "skills/setEnabled": ["selector", "enabled"],
  "skills/setExposure": ["selector", "exposure"],
  "workflow/scan": ["workspace", "includeUser"],
  "workflow/preview": ["workspace", "itemId"],
  "workflow/enable": ["workspace", "itemId", "approveSideEffects"],
  "workflow/refresh": ["workspace"],
  "workflow/remove": ["workspace", "itemId"],
  "discovery/refresh": [],
};

export const desktopConfigTool = {
  name: "desktop_config",
  description:
    "Read or live-configure Roder using allowlisted app-server methods. Use the roder-config skill. Change settings only as requested by the user; read current settings first and verify afterward. Never pass credentials. Workflow operations default to the calling thread's workspace and return catalog/approval metadata only, not raw config previews. Enabling executable MCP/workflow entries requires explicit user approval and approveSideEffects=true. Does not configure arbitrary Electron preferences.",
  parameters: {
    type: "object",
    properties: {
      method: { type: "string", enum: Object.keys(methods) },
      params: {
        type: "object",
        description:
          "Exact RPC parameters from the roder-config skill. Settings setters use mode, enabled, or shell; providers/select uses provider, model, reasoning. Skill selectors use {name:{name}} or {path:{path}}. Workflow methods use workspace, itemId, includeUser, approveSideEffects as applicable. Omit for reads without parameters.",
      },
    },
    required: ["method"],
    additionalProperties: false,
  },
};

export const desktopConfigInstructions = `For user-requested Roder configuration, use the built-in $roder-config skill and desktop_config when advertised. Read its body via desktop_config with method "skills/read" and params {"selector":{"name":{"name":"roder-config"}}}. This tool is a restricted live app-server bridge, not browser JavaScript or a shell command. Read current values before changes; preserve unrelated configuration and verify returned settings after applying changes. Do not put secrets in tool arguments or output. Ask for explicit approval before workflow/enable starts executable MCP integrations; never infer approval from a pasted snippet. Report restart-only settings honestly. If desktop_config is not advertised on an older thread, ask the user to start a new chat rather than claiming to have applied changes.`;

export async function configureDesktopFromTool(
  args: unknown,
  request: (method: string, params: unknown) => Promise<unknown>,
  threadId?: string,
): Promise<unknown> {
  if (!isRecord(args) || typeof args.method !== "string" || !Object.hasOwn(methods, args.method))
    throw new Error("Unsupported desktop configuration method");
  if (Object.keys(args).some((key) => key !== "method" && key !== "params"))
    throw new Error("Unexpected desktop configuration argument");
  const params = args.params ?? {};
  if (!isRecord(params) || Object.keys(params).some((key) => !methods[args.method as string].includes(key)))
    throw new Error("Unexpected parameters for desktop configuration method");
  const required: Record<string, string[]> = {
    "settings/set_web_search": ["mode"],
    "settings/set_search_index": ["enabled"],
    "settings/set_shell": ["shell"],
    "settings/set_default_mode": ["mode"],
    "settings/set_file_backed_dynamic_context": ["enabled"],
    "providers/select": ["provider"],
    "skills/read": ["selector"],
    "skills/setEnabled": ["selector", "enabled"],
    "skills/setExposure": ["selector", "exposure"],
    "workflow/enable": ["itemId"],
    "workflow/remove": ["itemId"],
  };
  if (required[args.method]?.some((key) => params[key] === undefined || params[key] === null))
    throw new Error("Missing required desktop configuration parameters");
  if (args.method === "workflow/enable" && params.approveSideEffects !== true)
    throw new Error("Enabling a workflow requires explicit user approval and approveSideEffects=true");
  // Do not echo arbitrary backend errors: configuration diagnostics can contain
  // credentials from existing files even when this call supplied none.
  try {
    const scopedParams = { ...params };
    const workflow = args.method.startsWith("workflow/");
    const needsWorkspace = workflow && scopedParams.workspace == null;
    const needsSkillCwd = args.method === "skills/list" && !scopedParams.cwd && !scopedParams.workspaceId;
    if (needsWorkspace || needsSkillCwd) {
      if (!threadId) throw new Error("Calling thread required for workspace configuration");
      const result = await request("thread/read", { threadId, includeTurns: false });
      const cwd = isRecord(result) && isRecord(result.thread) ? result.thread.cwd : undefined;
      if (typeof cwd !== "string" || !cwd.trim()) throw new Error("Calling thread has no workspace path");
      scopedParams[needsWorkspace ? "workspace" : "cwd"] = cwd;
    }
    const result = await request(args.method, scopedParams);
    return workflow
      ? { ...workflowMetadata(result), detailsOmitted: "Raw previews and diagnostics omitted to protect credentials." }
      : redactSecrets(result);
  } catch {
    throw new Error(
      `Desktop configuration request failed (${args.method}); check local diagnostics. No success was confirmed.`,
    );
  }
}

// Workflow previews can contain secrets in argv, URLs, env values and freeform
// conflict messages. Key-name redaction alone cannot safely expose those blobs.
const workflowMetadataKeys = new Set([
  "scan",
  "items",
  "stale",
  "item",
  "decision",
  "workspace",
  "id",
  "title",
  "state",
  "risk",
  "commandCapable",
  "approvalRequired",
  "enabledAt",
  "itemId",
  "sourceHash",
  "approvedSideEffects",
  "decidedAt",
  "source",
  "sourceType",
  "path",
]);

function workflowMetadata(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => workflowMetadataKeys.has(key))
      .map(([key, entry]) => [
        key,
        Array.isArray(entry) ? entry.map(workflowMetadata) : isRecord(entry) ? workflowMetadata(entry) : entry,
      ]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

import { isAbsolute } from "node:path/posix";

const prefix = "desktop/cloud-machines/";
export const machineProfilesChanged = `${prefix}changed`;
export const machineConfigMethods = {
  [`${prefix}list`]: [],
  [`${prefix}credentials/status`]: [],
  [`${prefix}blaxel/sandboxes`]: ["workspace"],
  [`${prefix}save`]: ["providerId", "name", "workspace", "sandboxName", "blaxelWorkspace", "spriteName"],
} as const;

export const cloudMachineConfigSkill = `## Roder Desktop machine profiles

Use desktop_config for requests to configure Roder's machines. Do not edit Desktop's encrypted storage, shell out to a provider CLI, or put credentials in chat or tool arguments.

1. Read desktop/cloud-machines/list and desktop/cloud-machines/credentials/status. If the provider is not connected, direct the user to Settings > Cloud Machines > Connections to import their local Blaxel CLI login or enter credentials securely. Do not claim a connection was made.
2. To use an existing Blaxel sandbox, call desktop/cloud-machines/blaxel/sandboxes (optional workspace is the Blaxel workspace name). Resolve ambiguity before saving. To save the profile, call desktop/cloud-machines/save with providerId "blaxel", name, workspace (the absolute directory inside the sandbox), sandboxName, and the discovered blaxelWorkspace when available. For an existing Sprite, use providerId "sprites", name, workspace, and spriteName.
3. Only save on the user's request. Preserve existing profiles; use the Settings UI to edit or remove one, configure SSH or Tailscale, or explicitly create a new cloud sandbox. This tool does not provision, start, or delete remote resources. Verify the new profile with desktop/cloud-machines/list, then tell the user to select it for a new thread. Do not claim connectivity was tested.`;

export function machineConfigParams(method: string, params: Record<string, unknown>): Record<string, unknown> {
  if (method === `${prefix}blaxel/sandboxes`) {
    return params.workspace === undefined ? {} : { workspace: identifier(params.workspace, "Blaxel workspace") };
  }
  if (method !== `${prefix}save`) return params;
  const { providerId, sandboxName, blaxelWorkspace, spriteName } = params;
  const name = typeof params.name === "string" ? params.name.trim() : "";
  const workspace = typeof params.workspace === "string" ? params.workspace.trim() : "";
  if (!name || name.length > 120 || /[\r\n\t]/.test(name)) throw new Error("Enter a machine name.");
  if (!isAbsolute(workspace) || workspace.includes("://") || /[\r\n\t]/.test(workspace)) {
    throw new Error("Enter an absolute path on the remote machine.");
  }
  let target: Record<string, string>;
  if (providerId === "blaxel" && spriteName === undefined) {
    target = {
      sandbox_name: identifier(sandboxName, "Blaxel sandbox"),
      ...(blaxelWorkspace === undefined ? {} : { workspace: identifier(blaxelWorkspace, "Blaxel workspace") }),
    };
  } else if (providerId === "sprites" && sandboxName === undefined && blaxelWorkspace === undefined) {
    target = { sprite_name: identifier(spriteName, "Sprite") };
  } else {
    throw new Error("Use the Blaxel or Sprites profile fields, or configure this provider in Settings.");
  }
  return { name, providerId, workspace, config: { ...target, working_dir: workspace, cleanup: "keep" } };
}

export async function checkMachineTarget(
  input: Record<string, unknown>,
  request: (method: string, params: unknown) => Promise<unknown>,
): Promise<void> {
  if (input.providerId !== "blaxel" || !isRecord(input.config)) return;
  const config = input.config;
  const requestedWorkspace = typeof config.workspace === "string" ? config.workspace : undefined;
  const found = await request(`${prefix}blaxel/sandboxes`, requestedWorkspace ? { workspace: requestedWorkspace } : {});
  if (
    !isRecord(found) ||
    typeof found.workspace !== "string" ||
    (requestedWorkspace && requestedWorkspace !== found.workspace) ||
    !Array.isArray(found.sandboxes) ||
    !found.sandboxes.some((sandbox) => isRecord(sandbox) && sandbox.name === config.sandbox_name)
  ) {
    throw new MachineConfigInputError(
      "No matching sandbox was found in the connected Blaxel workspace. Check Connections.",
    );
  }
  config.workspace = identifier(found.workspace, "Blaxel workspace");
}

export class MachineConfigInputError extends Error {}

export function machineConfigResult(method: string, result: unknown): unknown {
  if (!isRecord(result)) throw new Error("Invalid machine configuration result");
  switch (method) {
    case `${prefix}list`:
      return { machines: projectList(result.machines, ["id", "name", "providerId", "workspace"]) };
    case `${prefix}save`:
      if (!isRecord(result.machine) || typeof result.machine.id !== "string") throw new Error("Machine was not saved");
      return { machine: metadata(result.machine, ["id", "name", "providerId", "workspace"]) };
    case `${prefix}credentials/status`:
      return { statuses: projectList(result.statuses, ["providerId", "configured", "source", "workspace"]) };
    case `${prefix}blaxel/sandboxes`:
      return {
        ...metadata(result, ["workspace"]),
        sandboxes: projectList(result.sandboxes, ["name", "status", "region"]),
      };
  }
}

function identifier(value: unknown, description: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) {
    throw new MachineConfigInputError(`Enter a valid ${description} name.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function metadata(value: Record<string, unknown>, keys: string[]): Record<string, string | boolean | null> {
  const fields: Record<string, string | boolean | null> = {};
  for (const key of keys) {
    const field = value[key];
    if (typeof field === "string" || typeof field === "boolean" || field === null) fields[key] = field;
  }
  return fields;
}

function projectList(value: unknown, keys: string[]): Record<string, string | boolean | null>[] {
  return Array.isArray(value) ? value.filter(isRecord).map((item) => metadata(item, keys)) : [];
}

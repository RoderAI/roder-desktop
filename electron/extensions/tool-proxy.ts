import type { JsonObject, JsonValue } from "@roderai/extension-api";
import type { ExtensionCatalogSnapshot } from "./catalog";
import type { ExtensionHost, ExtensionToolResult } from "./extension-host";

export type ToolsListResult = {
  tools?: ToolSpec[];
  [key: string]: unknown;
};

export type ToolSpec = {
  name: string;
  description: string;
  input_schema: unknown;
  source?: string;
  extension_id?: string;
};

export type ToolsCallParams = {
  tool_name?: string;
  name?: string;
  arguments?: JsonObject;
  input?: JsonObject;
};

export type ToolsCallResult = {
  text: string;
  data: JsonValue;
  is_error: boolean;
};

export function mergeExtensionTools(baseResult: unknown, catalog: ExtensionCatalogSnapshot): ToolsListResult {
  const base = isToolsListResult(baseResult) ? baseResult : {};
  return {
    ...base,
    tools: [...(base.tools ?? []), ...extensionToolSpecs(catalog)],
  };
}

export function extensionToolSpecs(catalog: ExtensionCatalogSnapshot): ToolSpec[] {
  return catalog.extensions
    .filter((extension) => extension.enabled)
    .flatMap((extension) =>
      extension.manifest.contributes.tools.map((tool) => ({
        name: tool.id,
        description: tool.description,
        input_schema: tool.inputSchema,
        source: "desktop-extension",
        extension_id: extension.id,
      })),
    );
}

export function extensionToolName(params: unknown, catalog: ExtensionCatalogSnapshot): string | undefined {
  const request = params as ToolsCallParams | undefined;
  const name = request?.tool_name ?? request?.name;
  if (!name) {
    return undefined;
  }
  return extensionToolSpecs(catalog).some((tool) => tool.name === name) ? name : undefined;
}

export async function callExtensionTool(host: ExtensionHost, toolName: string, params: unknown): Promise<ToolsCallResult> {
  const request = params as ToolsCallParams | undefined;
  const input = request?.arguments ?? request?.input ?? {};
  try {
    const result: ExtensionToolResult = await host.executeTool(toolName, input);
    return {
      text: typeof result.result === "string" ? result.result : JSON.stringify(result.result),
      data: result.result,
      is_error: false,
    };
  } catch (error) {
    return {
      text: (error as Error).message,
      data: null,
      is_error: true,
    };
  }
}

function isToolsListResult(value: unknown): value is ToolsListResult {
  return value !== null && typeof value === "object" && (Array.isArray((value as ToolsListResult).tools) || (value as ToolsListResult).tools === undefined);
}

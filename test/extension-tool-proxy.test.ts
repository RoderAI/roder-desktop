import { expect, test } from "vitest";
import { callExtensionTool, extensionToolName, mergeExtensionTools } from "../electron/extensions/tool-proxy";

function catalogSnapshot(enabled = true) {
  return {
    extensions: [
      {
        id: "roder.hello-roder-extension",
        enabled,
        manifest: {
          contributes: {
            tools: [
              {
                id: "hello-roder.echo",
                description: "Echoes text.",
                inputSchema: { type: "object" },
              },
            ],
          },
        },
      },
    ],
  };
}

test("tool proxy merges enabled extension tools into tools/list", async () => {
  const result = mergeExtensionTools({ tools: [{ name: "native", description: "Native", input_schema: {} }] }, catalogSnapshot());

  expect(result.tools.map((tool) => tool.name)).toEqual(["native", "hello-roder.echo"]);
  expect(result.tools[1].source).toBe("desktop-extension");
  expect(result.tools[1].extension_id).toBe("roder.hello-roder-extension");
});

test("tool proxy ignores disabled extension tools", async () => {
  const result = mergeExtensionTools({ tools: [] }, catalogSnapshot(false));

  expect(result.tools).toEqual([]);
  expect(extensionToolName({ tool_name: "hello-roder.echo" }, catalogSnapshot(false))).toBe(undefined);
});

test("tool proxy executes extension tool calls through the host", async () => {
  const host = {
    executeTool: async (toolName, input) => ({
      extensionId: "roder.hello-roder-extension",
      toolId: toolName,
      result: { input },
    }),
  };

  const result = await callExtensionTool(host, "hello-roder.echo", { arguments: { text: "hi" } });
  expect(result).toEqual({
    text: "{\"input\":{\"text\":\"hi\"}}",
    data: { input: { text: "hi" } },
    is_error: false,
  });
});

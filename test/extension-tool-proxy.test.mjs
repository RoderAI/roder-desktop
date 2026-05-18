import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import ts from "typescript";

async function loadToolProxyModule() {
  const directory = mkdtempSync(join(tmpdir(), "roder-extension-tool-proxy-"));
  const source = readFileSync(new URL("../electron/extensions/tool-proxy.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  });
  const path = join(directory, "tool-proxy.mjs");
  writeFileSync(path, output.outputText);
  return import(`${path}?t=${Date.now()}`);
}

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
  const { mergeExtensionTools } = await loadToolProxyModule();
  const result = mergeExtensionTools({ tools: [{ name: "native", description: "Native", input_schema: {} }] }, catalogSnapshot());

  assert.deepEqual(result.tools.map((tool) => tool.name), ["native", "hello-roder.echo"]);
  assert.equal(result.tools[1].source, "desktop-extension");
  assert.equal(result.tools[1].extension_id, "roder.hello-roder-extension");
});

test("tool proxy ignores disabled extension tools", async () => {
  const { mergeExtensionTools, extensionToolName } = await loadToolProxyModule();
  const result = mergeExtensionTools({ tools: [] }, catalogSnapshot(false));

  assert.deepEqual(result.tools, []);
  assert.equal(extensionToolName({ tool_name: "hello-roder.echo" }, catalogSnapshot(false)), undefined);
});

test("tool proxy executes extension tool calls through the host", async () => {
  const { callExtensionTool } = await loadToolProxyModule();
  const host = {
    executeTool: async (toolName, input) => ({
      extensionId: "roder.hello-roder-extension",
      toolId: toolName,
      result: { input },
    }),
  };

  const result = await callExtensionTool(host, "hello-roder.echo", { arguments: { text: "hi" } });
  assert.deepEqual(result, {
    text: "{\"input\":{\"text\":\"hi\"}}",
    data: { input: { text: "hi" } },
    is_error: false,
  });
});

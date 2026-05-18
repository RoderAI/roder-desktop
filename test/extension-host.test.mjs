import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import ts from "typescript";

async function loadExtensionModules() {
  const directory = mkdtempSync(join(tmpdir(), "roder-extension-host-"));
  writeTranspiledModule("../electron/extensions/manifest.ts", join(directory, "manifest.mjs"));
  writeTranspiledModule("../electron/extensions/package-manager.ts", join(directory, "package-manager.mjs"), {
    "./manifest": "./manifest.mjs",
  });
  writeTranspiledModule("../electron/extensions/catalog.ts", join(directory, "catalog.mjs"), {
    "./manifest": "./manifest.mjs",
    "./package-manager": "./package-manager.mjs",
  });
  writeTranspiledModule("../electron/extensions/extension-host-runner.ts", join(directory, "extension-host-runner.mjs"));
  writeTranspiledModule("../electron/extensions/extension-host.ts", join(directory, "extension-host.mjs"), {
    "./catalog": "./catalog.mjs",
    "./extension-host-runner": "./extension-host-runner.mjs",
  });
  const catalogModule = await import(`${join(directory, "catalog.mjs")}?t=${Date.now()}`);
  const hostModule = await import(`${join(directory, "extension-host.mjs")}?t=${Date.now()}`);
  return {
    ExtensionCatalog: catalogModule.ExtensionCatalog,
    ExtensionHost: hostModule.ExtensionHost,
  };
}

function writeTranspiledModule(sourcePath, outputPath, replacements = {}) {
  let source = readFileSync(new URL(sourcePath, import.meta.url), "utf8");
  for (const [from, to] of Object.entries(replacements)) {
    source = source.replaceAll(`"${from}"`, `"${to}"`);
  }
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  });
  writeFileSync(outputPath, output.outputText);
}

function createExecutableExtensionFixture() {
  const directory = mkdtempSync(join(tmpdir(), "hosted-roder-extension-"));
  writeFileSync(
    join(directory, "extension.mjs"),
    `
export async function activate(context) {
  context.subscriptions.push(context.commands.registerCommand(
    { id: "hello-host.sayHello", title: "Say Hello" },
    async () => {
      await context.globalState.update("lastCommand", "hello");
      await context.notifications.showInformationMessage(context.preferences["hello-host.greeting"]);
      return { greeting: context.preferences["hello-host.greeting"], extensionId: context.extensionId };
    }
  ));
  context.subscriptions.push(context.tools.registerTool({
    id: "hello-host.echo",
    title: "Echo Text",
    description: "Echoes text.",
    inputSchema: { type: "object" },
    handler: async (input) => {
      const previous = await context.globalState.get("toolRuns", 0);
      const runCount = previous + 1;
      await context.globalState.update("toolRuns", runCount);
      return { text: input.text, runCount };
    }
  }));
}
`,
  );
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify(
      {
        name: "hello-host-extension",
        version: "0.1.0",
        description: "Host test extension.",
        roder: {
          displayName: "Hello Host",
          publisher: "roder",
          engines: { roder: ">=0.0.0" },
          main: "extension.mjs",
          activationEvents: ["onCommand:hello-host.sayHello", "onTool:hello-host.echo"],
          capabilities: ["desktop.notification"],
          contributes: {
            commands: [{ id: "hello-host.sayHello", title: "Say Hello" }],
            tools: [{ id: "hello-host.echo", title: "Echo Text", description: "Echoes text.", inputSchema: { type: "object" } }],
            configuration: [{ key: "hello-host.greeting", title: "Greeting", type: "text", default: "Hello host" }],
            views: { panels: [] },
          },
        },
      },
      null,
      2,
    ),
  );
  return directory;
}

test("extension host activates an installed extension and executes commands and tools", async () => {
  const { ExtensionCatalog, ExtensionHost } = await loadExtensionModules();
  const userDataPath = mkdtempSync(join(tmpdir(), "roder-host-user-data-"));
  const catalog = new ExtensionCatalog({ userDataPath, appVersion: "0.1.0" });
  const installed = await catalog.installFromFolder(createExecutableExtensionFixture());
  const host = new ExtensionHost({
    userDataPath,
    appName: "Roder",
    appVersion: "0.1.0",
    catalog,
  });

  try {
    const command = await host.executeCommand("hello-host.sayHello");
    assert.equal(command.extensionId, installed.id);
    assert.deepEqual(command.result, { greeting: "Hello host", extensionId: installed.id });

    const firstTool = await host.executeTool("hello-host.echo", { text: "one" });
    assert.deepEqual(firstTool.result, { text: "one", runCount: 1 });
    const secondTool = await host.executeTool("hello-host.echo", { text: "two" });
    assert.deepEqual(secondTool.result, { text: "two", runCount: 2 });
    await waitForLog(catalog, installed.id, /info: Hello host/);
  } finally {
    await host.stopAll();
  }
});

test("extension host refuses disabled extension contributions", async () => {
  const { ExtensionCatalog, ExtensionHost } = await loadExtensionModules();
  const userDataPath = mkdtempSync(join(tmpdir(), "roder-host-user-data-"));
  const catalog = new ExtensionCatalog({ userDataPath, appVersion: "0.1.0" });
  const installed = await catalog.installFromFolder(createExecutableExtensionFixture());
  await catalog.disable(installed.id);
  const host = new ExtensionHost({
    userDataPath,
    appName: "Roder",
    appVersion: "0.1.0",
    catalog,
  });

  try {
    await assert.rejects(() => host.executeCommand("hello-host.sayHello"), /No enabled extension contributes command/);
  } finally {
    await host.stopAll();
  }
});

async function waitForLog(catalog, extensionId, pattern) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const logs = (await catalog.readLogs(extensionId)).join("\n");
    if (pattern.test(logs)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.match((await catalog.readLogs(extensionId)).join("\n"), pattern);
}

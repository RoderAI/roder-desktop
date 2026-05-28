import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { ExtensionCatalog } from "../electron/extensions/catalog";
import { ExtensionHost } from "../electron/extensions/extension-host";

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
            tools: [
              {
                id: "hello-host.echo",
                title: "Echo Text",
                description: "Echoes text.",
                inputSchema: { type: "object" },
              },
            ],
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
    expect(command.extensionId).toBe(installed.id);
    expect(command.result).toEqual({ greeting: "Hello host", extensionId: installed.id });

    const firstTool = await host.executeTool("hello-host.echo", { text: "one" });
    expect(firstTool.result).toEqual({ text: "one", runCount: 1 });
    const secondTool = await host.executeTool("hello-host.echo", { text: "two" });
    expect(secondTool.result).toEqual({ text: "two", runCount: 2 });
    await waitForLog(catalog, installed.id, /info: Hello host/);
  } finally {
    await host.stopAll();
  }
});

test("extension host refuses disabled extension contributions", async () => {
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
    await expect(() => host.executeCommand("hello-host.sayHello")).rejects.toThrow(
      /No enabled extension contributes command/,
    );
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
  expect((await catalog.readLogs(extensionId)).join("\n")).toMatch(pattern);
}

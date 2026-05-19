import type { RoderExtensionContext } from "@roderai/extension-api";

export async function activate(context: RoderExtensionContext): Promise<void> {
  context.subscriptions.push(
    context.commands.registerCommand(
      {
        id: "hello-roder.sayHello",
        title: "Say Hello",
        category: "Hello Roder",
      },
      async () => {
        const greeting = String(context.preferences["hello-roder.greeting"] ?? "Hello from a local extension");
        await context.globalState.update("lastCommandRunAt", new Date().toISOString());
        await context.notifications.showInformationMessage(greeting);
        return {
          greeting,
          extensionId: context.extensionId,
        };
      },
    ),
  );

  context.subscriptions.push(
    context.commands.registerCommand(
      {
        id: "hello-roder.noViewHello",
        title: "No-View Hello",
        category: "Hello Roder",
      },
      async () => {
        const count = Number((await context.globalState.get("noViewCommandRuns", 0)) ?? 0) + 1;
        await context.globalState.update("noViewCommandRuns", count);
        return `No-view hello #${count}`;
      },
    ),
  );

  context.subscriptions.push(
    context.tools.registerTool({
      id: "hello-roder.echo",
      title: "Echo Text",
      description: "Echoes text from the user and records how many times the tool has run.",
      inputSchema: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Text to echo back.",
          },
        },
        required: ["text"],
        additionalProperties: false,
      },
      handler: async (input) => {
        const previousRuns = Number((await context.globalState.get("toolRuns", 0)) ?? 0);
        const runCount = previousRuns + 1;
        await context.globalState.update("toolRuns", runCount);
        return {
          text: String(input.text ?? ""),
          runCount,
          storedAt: new Date().toISOString(),
        };
      },
    }),
  );
}

export async function deactivate(): Promise<void> {
  return;
}

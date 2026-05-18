export const extensionHostRunnerSource = String.raw`
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const commands = new Map();
const tools = new Map();
let deactivate = undefined;
let activeContext = undefined;

process.on("message", (message) => {
  void handleMessage(message);
});

async function handleMessage(message) {
  if (!message || typeof message !== "object") {
    return;
  }
  try {
    if (message.type === "activate") {
      await activateExtension(message);
      send({ type: "response", id: message.id, result: registeredContributions() });
      return;
    }
    if (message.type === "executeCommand") {
      const handler = commands.get(message.commandId);
      if (!handler) {
        throw new Error("Command " + message.commandId + " is not registered");
      }
      send({ type: "response", id: message.id, result: await handler(...(message.args ?? [])) });
      return;
    }
    if (message.type === "executeTool") {
      const registration = tools.get(message.toolId);
      if (!registration) {
        throw new Error("Tool " + message.toolId + " is not registered");
      }
      const controller = new AbortController();
      const context = {
        toolCallId: message.toolCallId,
        extensionId: activeContext.extensionId,
        signal: controller.signal,
      };
      send({ type: "response", id: message.id, result: await registration.handler(message.input ?? {}, context) });
      return;
    }
    if (message.type === "deactivate") {
      if (deactivate) {
        await deactivate();
      }
      commands.clear();
      tools.clear();
      send({ type: "response", id: message.id, result: null });
    }
  } catch (error) {
    send({ type: "response", id: message.id, error: error instanceof Error ? error.message : String(error) });
  }
}

async function activateExtension(message) {
  commands.clear();
  tools.clear();
  activeContext = message.context;
  const moduleUrl = pathToFileURL(message.entryPath).href + "?t=" + Date.now();
  const extensionModule = await import(moduleUrl);
  if (typeof extensionModule.activate !== "function") {
    throw new Error("Extension entry must export activate(context)");
  }
  const context = createContext(message.context);
  await extensionModule.activate(context);
  deactivate = typeof extensionModule.deactivate === "function" ? extensionModule.deactivate : undefined;
}

function createContext(context) {
  const subscriptions = [];
  const api = {
    extensionId: context.extensionId,
    extensionPath: context.extensionPath,
    subscriptions,
    globalStoragePath: context.globalStoragePath,
    workspaceStoragePath: context.workspaceStoragePath,
    globalState: createStorage(context.globalStoragePath),
    workspaceState: createStorage(context.workspaceStoragePath ?? context.globalStoragePath),
    secrets: {
      async get() {
        return undefined;
      },
      async store() {
        throw new Error("Secret storage is not available in this extension host slice");
      },
      async delete() {
        return;
      },
    },
    commands: {
      registerCommand(command, handler) {
        commands.set(command.id, handler);
        return disposable(() => commands.delete(command.id));
      },
      async executeCommand(id, ...args) {
        const handler = commands.get(id);
        if (!handler) {
          throw new Error("Command " + id + " is not registered");
        }
        return handler(...args);
      },
    },
    tools: {
      registerTool(registration) {
        tools.set(registration.id, registration);
        return disposable(() => tools.delete(registration.id));
      },
    },
    notifications: {
      async showInformationMessage(message) {
        send({ type: "log", level: "info", message });
      },
      async showWarningMessage(message) {
        send({ type: "log", level: "warning", message });
      },
      async showErrorMessage(message) {
        send({ type: "log", level: "error", message });
      },
    },
    env: context.env,
    workspace: context.workspace,
    thread: context.thread,
    preferences: context.preferences,
  };
  return api;
}

function createStorage(storagePath) {
  const statePath = storagePath + "/state.json";
  return {
    async get(key, defaultValue) {
      const state = await readState(statePath);
      return Object.prototype.hasOwnProperty.call(state, key) ? state[key] : defaultValue;
    },
    async update(key, value) {
      const state = await readState(statePath);
      if (value === undefined) {
        delete state[key];
      } else {
        state[key] = value;
      }
      await mkdir(dirname(statePath), { recursive: true });
      await writeFile(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");
    },
  };
}

async function readState(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function registeredContributions() {
  return {
    commands: [...commands.keys()],
    tools: [...tools.keys()],
  };
}

function disposable(dispose) {
  const item = { dispose };
  activeContext?.subscriptions?.push(item);
  return item;
}

function send(message) {
  if (process.send) {
    process.send(message);
  }
}
`;

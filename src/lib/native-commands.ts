import type { CommandDescriptor, RoderModel } from "@/types/roder";
import type { NativeCommandOutput } from "@/lib/native-command-formatters";
import { errorOutput, infoOutput, warningOutput } from "@/lib/native-command-formatters";

export type NativeCommandKind = "model" | "clear" | "retry" | "agents" | "tasks" | "processes";

export type NativeCommandDefinition = {
  name: string;
  description: string;
  argumentHint: string | null;
  kind: NativeCommandKind;
};

export type NativeCommandInvocation = {
  name: string;
  arguments: string;
  definition: NativeCommandDefinition;
};

export type NativeCommandResult =
  | { type: "output"; output: NativeCommandOutput }
  | { type: "openModelPicker" }
  | { type: "selectModel"; modelId: string; modelProvider: string }
  | { type: "clear" }
  | { type: "retry" }
  | { type: "agents" }
  | { type: "tasks" }
  | { type: "processes"; includeCompleted: boolean }
  | { type: "stopProcess"; processId: string }
  | { type: "stopAllProcesses" };

export const nativeCommandDefinitions: NativeCommandDefinition[] = [
  {
    name: "model",
    description: "Show or change the active model.",
    argumentHint: "[model-id]",
    kind: "model",
  },
  {
    name: "clear",
    description: "Clear the visible conversation state.",
    argumentHint: null,
    kind: "clear",
  },
  {
    name: "retry",
    description: "Resubmit the last user message.",
    argumentHint: null,
    kind: "retry",
  },
  {
    name: "agents",
    description: "List configured subagents.",
    argumentHint: null,
    kind: "agents",
  },
  {
    name: "tasks",
    description: "List background tasks.",
    argumentHint: null,
    kind: "tasks",
  },
  {
    name: "ps",
    description: "List or stop Roder-owned processes.",
    argumentHint: "all|stop <id>|stop-all --confirm",
    kind: "processes",
  },
];

export function nativeCommandDescriptors(definitions = nativeCommandDefinitions): CommandDescriptor[] {
  return definitions.map((definition) => ({
    name: definition.name,
    description: definition.description,
    argument_hint: definition.argumentHint,
    source: "desktop",
    model: null,
    agent: null,
    has_shell_includes: false,
    has_url_includes: false,
  }));
}

export function mergedCommandDescriptors(
  appServerCommands: CommandDescriptor[],
  definitions = nativeCommandDefinitions,
): CommandDescriptor[] {
  const byName = new Map<string, CommandDescriptor>();
  for (const command of appServerCommands) {
    byName.set(command.name, command);
  }
  for (const command of nativeCommandDescriptors(definitions)) {
    byName.set(command.name, command);
  }
  return [...byName.values()].toSorted((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true }),
  );
}

export function nativeCommandInvocation(
  name: string,
  argumentsText: string,
  definitions = nativeCommandDefinitions,
): NativeCommandInvocation | null {
  const definition = definitions.find((command) => command.name === name);
  return definition ? { name, arguments: argumentsText, definition } : null;
}

export function planNativeCommand(invocation: NativeCommandInvocation, models: RoderModel[] = []): NativeCommandResult {
  switch (invocation.definition.kind) {
    case "model":
      return planModelCommand(invocation.arguments, models);
    case "clear":
      return { type: "clear" };
    case "retry":
      return { type: "retry" };
    case "agents":
      return { type: "agents" };
    case "tasks":
      return { type: "tasks" };
    case "processes":
      return planProcessesCommand(invocation.arguments);
  }
}

function planModelCommand(argumentsText: string, models: RoderModel[]): NativeCommandResult {
  const modelId = argumentsText.trim();
  if (!modelId) {
    return { type: "openModelPicker" };
  }
  const model = models.find((candidate) => candidate.id === modelId || candidate.name === modelId);
  if (!model) {
    return {
      type: "output",
      output: errorOutput("Model not found", `No configured model matches ${modelId}.`),
    };
  }
  return {
    type: "selectModel",
    modelId: model.id,
    modelProvider: model.modelProvider,
  };
}

function planProcessesCommand(argumentsText: string): NativeCommandResult {
  const parts = argumentsText.trim().split(/\s+/).filter(Boolean);
  const [action, subject, ...rest] = parts;
  if (!action) {
    return { type: "processes", includeCompleted: false };
  }
  if (action === "all") {
    return { type: "processes", includeCompleted: true };
  }
  if (action === "stop" && subject) {
    return { type: "stopProcess", processId: subject };
  }
  if (action === "stop-all") {
    if (subject === "--confirm" || rest.includes("--confirm")) {
      return { type: "stopAllProcesses" };
    }
    return {
      type: "output",
      output: warningOutput("Confirmation required", "Use /ps stop-all --confirm to stop all processes."),
    };
  }
  return {
    type: "output",
    output: infoOutput("Unknown /ps action", "Use /ps, /ps all, /ps stop <id>, or /ps stop-all --confirm."),
  };
}

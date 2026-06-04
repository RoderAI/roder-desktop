import { expect, test } from "vitest";
import {
  mergedCommandDescriptors,
  nativeCommandInvocation,
  nativeCommandDescriptors,
  planNativeCommand,
} from "../src/lib/native-commands";
import type { CommandDescriptor, RoderModel } from "../src/types/roder";

test("projects native commands to command descriptors", () => {
  expect(nativeCommandDescriptors().map((command) => command.name)).toEqual([
    "model",
    "clear",
    "retry",
    "agents",
    "tasks",
    "ps",
  ]);
  expect(nativeCommandDescriptors()[0]).toMatchObject({
    source: "desktop",
    has_shell_includes: false,
    has_url_includes: false,
  });
});

test("merges native commands with app-server commands and lets native names win", () => {
  const commands = mergedCommandDescriptors([
    command({ name: "review", source: "builtin" }),
    command({ name: "model", source: "builtin", description: "Prompt model help" }),
  ]);

  expect(commands.map((item) => item.name)).toEqual(["agents", "clear", "model", "ps", "retry", "review", "tasks"]);
  expect(commands.find((item) => item.name === "model")).toMatchObject({
    source: "desktop",
    description: "Show or change the active model.",
  });
  expect(commands.find((item) => item.name === "tasks")).toMatchObject({
    description: "List background tasks.",
  });
});

test("finds native command invocations by name", () => {
  expect(nativeCommandInvocation("review", "api")).toBeNull();
  expect(nativeCommandInvocation("model", "gpt-5.5")).toMatchObject({
    name: "model",
    arguments: "gpt-5.5",
    definition: { kind: "model" },
  });
});

test("plans model command behavior", () => {
  const models: RoderModel[] = [{ id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai" }];

  expect(planNativeCommand(nativeCommandInvocation("model", "", undefined)!, models)).toEqual({
    type: "openModelPicker",
  });
  expect(planNativeCommand(nativeCommandInvocation("model", "gpt-5.5")!, models)).toMatchObject({
    type: "selectModel",
    modelId: "gpt-5.5",
    modelProvider: "openai",
  });
  expect(planNativeCommand(nativeCommandInvocation("model", "missing")!, models)).toMatchObject({
    type: "output",
    output: { tone: "error", title: "Model not found" },
  });
});

test("plans model command against visible configured models from any provider", () => {
  const models: RoderModel[] = [
    { id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai" },
    { id: "claude-code/sonnet", name: "Claude Code Sonnet", modelProvider: "claude-code" },
  ];

  expect(planNativeCommand(nativeCommandInvocation("model", "claude-code/sonnet")!, models)).toMatchObject({
    type: "selectModel",
    modelId: "claude-code/sonnet",
    modelProvider: "claude-code",
  });
});

test("plans process command behavior with explicit destructive confirmation", () => {
  expect(planNativeCommand(nativeCommandInvocation("ps", "")!)).toEqual({ type: "processes", includeCompleted: false });
  expect(planNativeCommand(nativeCommandInvocation("ps", "all")!)).toEqual({
    type: "processes",
    includeCompleted: true,
  });
  expect(planNativeCommand(nativeCommandInvocation("ps", "stop proc-1")!)).toEqual({
    type: "stopProcess",
    processId: "proc-1",
  });
  expect(planNativeCommand(nativeCommandInvocation("ps", "stop-all")!)).toMatchObject({
    type: "output",
    output: { tone: "warning" },
  });
  expect(planNativeCommand(nativeCommandInvocation("ps", "stop-all --confirm")!)).toEqual({
    type: "stopAllProcesses",
  });
});

function command(patch: Partial<CommandDescriptor>): CommandDescriptor {
  return {
    name: patch.name ?? "review",
    description: patch.description ?? "Review changes",
    argument_hint: patch.argument_hint ?? "[scope]",
    source: patch.source ?? "builtin",
    model: patch.model ?? null,
    agent: patch.agent ?? null,
    has_shell_includes: patch.has_shell_includes ?? false,
    has_url_includes: patch.has_url_includes ?? false,
  };
}

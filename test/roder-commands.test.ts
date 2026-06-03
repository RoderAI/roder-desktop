import { expect, test } from "vitest";
import {
  completedCommandInvocation,
  commandInvocation,
  commandInvocationText,
  commandWarning,
  commandWarnings,
  matchingCommandCompletions,
  replaceSlashCommandToken,
  slashCommandLikeText,
  slashCommandToken,
} from "../src/lib/roder-commands";
import type { CommandDescriptor } from "../src/types/roder";

test("detects a slash command token at the start of a single-line prompt", () => {
  expect(slashCommandToken("/re", 3)).toEqual({ start: 0, end: 3, query: "re" });
  expect(slashCommandToken("/review", 4)).toEqual({ start: 0, end: 7, query: "review" });
  expect(slashCommandToken(" /review", " /review".length)).toEqual({ start: 1, end: 8, query: "review" });
  expect(slashCommandToken("//comment", "//comment".length)).toBeNull();
  expect(slashCommandToken("open /review", "open /review".length)).toBeNull();
  expect(slashCommandToken("/review api", "/review api".length)).toBeNull();
  expect(slashCommandToken("/review\napi", "/review\napi".length)).toBeNull();
});

test("detects slash-looking command submissions before the catalog is loaded", () => {
  expect(slashCommandLikeText("/review api")).toBe(true);
  expect(slashCommandLikeText(" /review")).toBe(true);
  expect(slashCommandLikeText("//review")).toBe(false);
  expect(slashCommandLikeText("/review\napi")).toBe(false);
});

test("matches command completions by name prefix in sorted order", () => {
  const commands = [command({ name: "retry" }), command({ name: "review" }), command({ name: "model" })];

  expect(matchingCommandCompletions(commands, "re").map((item) => item.name)).toEqual(["retry", "review"]);
  expect(matchingCommandCompletions(commands, "").map((item) => item.name)).toEqual(["model", "retry", "review"]);
});

test("parses command invocations only for known command names", () => {
  const commands = [command({ name: "review" }), command({ name: "ce-work_beta" }), command({ name: "retry" })];

  expect(commandInvocation("/review api", commands)).toEqual({ name: "review", arguments: "api" });
  expect(commandInvocation("/review api  --flag=value", commands)).toEqual({
    name: "review",
    arguments: "api  --flag=value",
  });
  expect(commandInvocation("/ce-work_beta feature", commands)).toEqual({
    name: "ce-work_beta",
    arguments: "feature",
  });
  expect(commandInvocation("/review", commands)).toEqual({ name: "review", arguments: "" });
  expect(commandInvocation("/review   ", commands)).toEqual({ name: "review", arguments: "" });
  expect(commandInvocation("/missing api", commands)).toBeNull();
  expect(commandInvocation("//review", commands)).toBeNull();
  expect(commandInvocation("/workspace/file", commands)).toBeNull();
});

test("replaces the active slash command token with a completed command", () => {
  expect(replaceSlashCommandToken("/re", { start: 0, end: 3, query: "re" }, "review")).toEqual({
    text: "/review ",
    caret: "/review ".length,
  });
  expect(replaceSlashCommandToken("/review", { start: 0, end: 7, query: "review" }, "review")).toEqual({
    text: "/review ",
    caret: "/review ".length,
  });
});

test("builds a completed command invocation from the full prompt text", () => {
  const commands = [command({ name: "review" })];

  expect(completedCommandInvocation("/re api", { start: 0, end: 3, query: "re" }, "review", commands)).toEqual({
    name: "review",
    arguments: "api",
  });
  expect(completedCommandInvocation("/reapi", { start: 0, end: 3, query: "re" }, "review", commands)).toEqual({
    name: "review",
    arguments: "api",
  });
});

test("derives compact warning labels from command descriptors", () => {
  expect(commandWarning(command({ agent: "explorer", has_shell_includes: true }))).toBe("shell gated");
  expect(commandWarning(command({ model: "gpt-5.5" }))).toBe("changes model");
  expect(commandWarning(command({ has_shell_includes: true }))).toBe("shell gated");
  expect(commandWarning(command({ has_url_includes: true }))).toBe("url gated");
  expect(commandWarning(command({ source: "extension:repo-tools" }))).toBe("extension");
  expect(commandWarning(command({}))).toBeNull();
});

test("derives every relevant command warning in priority order", () => {
  expect(
    commandWarnings(
      command({
        agent: "explorer",
        model: "gpt-5.5",
        has_shell_includes: true,
        has_url_includes: true,
        source: "extension:repo-tools",
      }),
    ),
  ).toEqual(["shell gated", "url gated", "uses subagent", "changes model", "extension"]);
});

test("formats a command invocation as title seed text", () => {
  expect(commandInvocationText({ name: "review", arguments: "api" })).toBe("/review api");
  expect(commandInvocationText({ name: "review", arguments: "" })).toBe("/review");
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

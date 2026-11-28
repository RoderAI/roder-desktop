import type { CommandDescriptor } from "@/types/roder";
import type { CommandInvocation } from "@/lib/roder-commands";

export type ClaudeMenuCommand = "workflows" | "tasks";
export type ClaudeMenuInvocation = { command: ClaudeMenuCommand; arguments: string };
export type ClaudeTerminalFrame = { lines: string[]; readyForTurn: boolean; closed: boolean };

export const claudeMenuTitles = { workflows: "Claude Code workflows", tasks: "Claude Code subagents" };

const claudeCommands: Readonly<Record<string, ClaudeMenuCommand>> = {
  workflows: "workflows",
  tasks: "tasks",
  agents: "tasks",
  subagents: "tasks",
};

export function claudeMenuInvocation(invocation: CommandInvocation): ClaudeMenuInvocation | null {
  if (!Object.hasOwn(claudeCommands, invocation.name)) return null;
  return { command: claudeCommands[invocation.name], arguments: invocation.arguments };
}

export function claudeCommandCatalog(commands: CommandDescriptor[]): CommandDescriptor[] {
  const nativeCommands = Object.entries(claudeCommands).map(([name, kind]): CommandDescriptor => ({
    name,
    description:
      kind === "workflows" ? "Open Claude’s dynamic workflows." : "Open Claude’s background tasks and subagents.",
    argument_hint: null,
    source: "claude-code",
    model: null,
    agent: null,
    has_shell_includes: false,
    has_url_includes: false,
  }));
  return [...commands.filter(({ name }) => !Object.hasOwn(claudeCommands, name)), ...nativeCommands];
}

export function claudeMenuText(frame: ClaudeTerminalFrame, command: ClaudeMenuCommand): string {
  const heading = command === "workflows" ? "Dynamic workflows" : "Background";
  const headingIndex = frame.lines.findLastIndex((line) => line.trim() === heading);
  const echo = frame.lines.findLastIndex((line) => line.trimStart().startsWith(`❯ /${command}`));
  let body = frame.lines.slice(headingIndex >= 0 ? headingIndex : echo + 1);
  if (headingIndex < 0 && echo >= 0) {
    const rule = body.findIndex((line) => /^([─▔])\1{3}/.test(line));
    if (rule >= 0) body = frame.readyForTurn ? body.slice(0, rule) : body.slice(rule + 1);
  }
  return body
    .map((line) => line.replace(/^ {2}/, ""))
    .join("\n")
    .trim();
}

const menuKeys: Readonly<Record<string, string>> = {
  ArrowDown: "Down",
  ArrowUp: "Up",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Enter: "Enter",
  Escape: "Escape",
  PageUp: "PPage",
  PageDown: "NPage",
  Backspace: "BSpace",
  Delete: "Delete",
};

export function claudeMenuKey(key: string): string | undefined {
  return Object.hasOwn(menuKeys, key) ? menuKeys[key] : undefined;
}

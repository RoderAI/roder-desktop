import type { CommandDescriptor } from "@/types/roder";

export type SlashCommandToken = {
  start: number;
  end: number;
  query: string;
};

export type CommandInvocation = {
  name: string;
  arguments: string;
};

const commandNamePattern = /^[A-Za-z0-9:_-]*$/;

export function slashCommandToken(text: string, caret: number): SlashCommandToken | null {
  const caretEnd = Math.max(0, Math.min(caret, text.length));
  const beforeCaret = text.slice(0, caretEnd);
  const trimmedStart = beforeCaret.match(/^\s*/)?.[0].length ?? 0;
  const queryText = beforeCaret.slice(trimmedStart);

  if (!queryText.startsWith("/") || queryText.startsWith("//") || queryText.includes("\n")) {
    return null;
  }
  if (queryText.includes(" ") || queryText.includes("\t")) {
    return null;
  }

  const afterCaret = text.slice(caretEnd).match(/^[A-Za-z0-9:_-]*/)?.[0] ?? "";
  const end = caretEnd + afterCaret.length;
  const query = text.slice(trimmedStart + 1, end);
  if (!commandNamePattern.test(query)) {
    return null;
  }

  return {
    start: trimmedStart,
    end,
    query,
  };
}

export function matchingCommandCompletions(
  commands: CommandDescriptor[],
  query: string,
  limit?: number,
): CommandDescriptor[] {
  const normalizedQuery = normalize(query);
  const matches = sortCommandsByName(commands).filter((command) =>
    normalizedQuery ? normalize(command.name).startsWith(normalizedQuery) : true,
  );
  return typeof limit === "number" ? matches.slice(0, limit) : matches;
}

export function commandInvocation(text: string, commands: CommandDescriptor[]): CommandInvocation | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\n")) {
    return null;
  }

  const invocationMatch = trimmed.match(/^\/([A-Za-z0-9:_-]+)(?:[ \t]+(.*))?$/);
  const name = invocationMatch?.[1] ?? "";
  if (!name || !commandNamePattern.test(name) || !commands.some((command) => command.name === name)) {
    return null;
  }

  return {
    name,
    arguments: invocationMatch?.[2] ?? "",
  };
}

export function slashCommandLikeText(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.includes("\n");
}

export function commandInvocationText(invocation: CommandInvocation): string {
  return invocation.arguments ? `/${invocation.name} ${invocation.arguments}` : `/${invocation.name}`;
}

export function completedCommandInvocation(
  text: string,
  token: SlashCommandToken,
  commandName: string,
  commands: CommandDescriptor[],
): CommandInvocation | null {
  return commandInvocation(replaceSlashCommandToken(text, token, commandName).text, commands);
}

export function replaceSlashCommandToken(
  text: string,
  token: SlashCommandToken,
  commandName: string,
): { text: string; caret: number } {
  const replacement = `/${commandName} `;
  const nextText = `${text.slice(0, token.start)}${replacement}${text.slice(token.end)}`;
  return {
    text: nextText,
    caret: token.start + replacement.length,
  };
}

export function commandWarning(command: CommandDescriptor): string | null {
  return commandWarnings(command)[0] ?? null;
}

export function commandWarnings(command: CommandDescriptor): string[] {
  const warnings: string[] = [];
  if (command.has_shell_includes) {
    warnings.push("shell gated");
  }
  if (command.has_url_includes) {
    warnings.push("url gated");
  }
  if (command.agent) {
    warnings.push("uses subagent");
  }
  if (command.model) {
    warnings.push("changes model");
  }
  if (command.source.startsWith("extension:")) {
    warnings.push("extension");
  }
  return warnings;
}

function sortCommandsByName(commands: CommandDescriptor[]): CommandDescriptor[] {
  return commands.toSorted((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true }),
  );
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

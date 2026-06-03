import type { KeyboardEvent } from "react";
import { useComposerCompletion } from "@/hooks/use-composer-completion";
import {
  completedCommandInvocation,
  matchingCommandCompletions,
  replaceSlashCommandToken,
  slashCommandToken,
  type CommandInvocation,
} from "@/lib/roder-commands";
import { readSkillPromptEditorText, writeSkillPromptEditorText } from "@/lib/lexical-skill-prompt";
import type { CommandDescriptor, SkillDescriptor } from "@/types/roder";
import type { LexicalEditor } from "lexical";

type CommandCompletionState = {
  commandCompletions: CommandDescriptor[];
  handleCommandCompletionKeyDown: (event: KeyboardEvent<HTMLDivElement>) => boolean;
  highlightedCommandIndex: number;
  runCommandCompletion: (command: CommandDescriptor) => void;
  setHighlightedCommandIndex: (index: number) => void;
  showCommandCompletionMenu: boolean;
};

type UseCommandCompletionOptions = {
  editor: LexicalEditor;
  prompt: string;
  caretPosition: number;
  commands: CommandDescriptor[];
  skills: SkillDescriptor[];
  disabled: boolean;
  onCommandSubmit: (invocation: CommandInvocation) => void;
  onPromptChange: (prompt: string, caret: number) => void;
};

export function useCommandCompletion({
  editor,
  prompt,
  caretPosition,
  commands,
  skills,
  disabled,
  onCommandSubmit,
  onPromptChange,
}: UseCommandCompletionOptions): CommandCompletionState {
  const completionToken = disabled ? null : slashCommandToken(prompt, caretPosition);
  const commandCompletions = completionToken ? matchingCommandCompletions(commands, completionToken.query) : [];
  const completion = useComposerCompletion({ token: completionToken, itemCount: commandCompletions.length });
  const highlightedCommandIndex = completion.highlightedIndex;

  function selectedCommandForKeyboard(): CommandDescriptor | undefined {
    return commandCompletions[highlightedCommandIndex];
  }

  function completeCommand(command: CommandDescriptor): void {
    if (!completionToken) {
      return;
    }
    const next = replaceSlashCommandToken(readSkillPromptEditorText(editor), completionToken, command.name);
    writeSkillPromptEditorText(editor, next.text, skills, next.caret);
    onPromptChange(next.text, next.caret);
    completion.reset();
    requestAnimationFrame(() => {
      editor.focus();
    });
  }

  function runCommandCompletion(command: CommandDescriptor): void {
    const currentText = readSkillPromptEditorText(editor);
    const invocation = completionToken
      ? completedCommandInvocation(currentText, completionToken, command.name, commands)
      : null;
    completion.reset();
    onCommandSubmit(invocation ?? { name: command.name, arguments: "" });
  }

  function handleCommandCompletionKeyDown(event: KeyboardEvent<HTMLDivElement>): boolean {
    if (!completion.showMenu) {
      return false;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      completion.moveHighlight(event.key === "ArrowDown" ? "next" : "previous");
      return true;
    }

    if (event.key === "Tab") {
      const selectedCommand = selectedCommandForKeyboard();
      if (!selectedCommand) {
        return false;
      }
      event.preventDefault();
      event.stopPropagation();
      completeCommand(selectedCommand);
      return true;
    }

    if (event.key === "Enter") {
      const selectedCommand = selectedCommandForKeyboard();
      if (!selectedCommand) {
        return false;
      }
      event.preventDefault();
      event.stopPropagation();
      runCommandCompletion(selectedCommand);
      return true;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      completion.dismiss();
      return true;
    }

    return false;
  }

  return {
    commandCompletions,
    handleCommandCompletionKeyDown,
    highlightedCommandIndex,
    runCommandCompletion,
    setHighlightedCommandIndex: completion.setHighlightedIndex,
    showCommandCompletionMenu: completion.showMenu,
  };
}

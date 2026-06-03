import type { KeyboardEvent } from "react";
import { useComposerCompletion } from "@/hooks/use-composer-completion";
import { shouldClearDismissedCompletion } from "@/lib/composer-completions";
import { readSkillPromptEditorText, replaceSkillPromptCompletionToken } from "@/lib/lexical-skill-prompt";
import { matchingSkillCompletions, skillCompletionToken } from "@/lib/roder-skills";
import type { SkillDescriptor } from "@/types/roder";
import type { LexicalEditor } from "lexical";

type SkillCompletionState = {
  handleSkillCompletionKeyDown: (event: KeyboardEvent<HTMLDivElement>) => boolean;
  highlightedSkillIndex: number;
  insertSkillCompletion: (skill: SkillDescriptor) => void;
  setHighlightedSkillIndex: (index: number) => void;
  showSkillCompletionMenu: boolean;
  skillCompletions: SkillDescriptor[];
};

type UseSkillCompletionOptions = {
  editor: LexicalEditor;
  prompt: string;
  caretPosition: number;
  skills: SkillDescriptor[];
  onPromptChange: (prompt: string, caret: number) => void;
};

export function useSkillCompletion({
  editor,
  prompt,
  caretPosition,
  skills,
  onPromptChange,
}: UseSkillCompletionOptions): SkillCompletionState {
  const completionToken = skillCompletionToken(prompt, caretPosition);
  const skillCompletions = completionToken ? matchingSkillCompletions(skills, completionToken.query) : [];
  const completion = useComposerCompletion({ token: completionToken, itemCount: skillCompletions.length });
  const showSkillCompletionMenu = completion.showMenu;
  const highlightedSkillIndex = completion.highlightedIndex;

  function insertSkillCompletion(skill: SkillDescriptor): void {
    if (!completionToken) {
      return;
    }
    const nextCaret = replaceSkillPromptCompletionToken(editor, completionToken, skill.name, skills);
    const nextPrompt = readSkillPromptEditorText(editor);
    onPromptChange(nextPrompt, nextCaret);
    completion.reset();
    requestAnimationFrame(() => {
      editor.focus();
    });
  }

  function selectedSkillForKeyboard(): SkillDescriptor | undefined {
    return skillCompletions[highlightedSkillIndex];
  }

  function moveSkillCompletionHighlight(direction: "next" | "previous"): void {
    completion.moveHighlight(direction);
  }

  function dismissSkillCompletion(): void {
    completion.dismiss();
  }

  function handleSkillCompletionKeyDown(event: KeyboardEvent<HTMLDivElement>): boolean {
    if (shouldClearDismissedCompletion(completion.completionKey, completion.dismissedCompletionKey, event)) {
      completion.reset();
    }

    if (!showSkillCompletionMenu) {
      return false;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      moveSkillCompletionHighlight(event.key === "ArrowDown" ? "next" : "previous");
      return true;
    }

    if (event.key === "Tab" || event.key === "Enter") {
      const selectedSkill = selectedSkillForKeyboard();
      if (!selectedSkill) {
        return false;
      }
      event.preventDefault();
      event.stopPropagation();
      insertSkillCompletion(selectedSkill);
      return true;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismissSkillCompletion();
      return true;
    }

    return false;
  }

  return {
    handleSkillCompletionKeyDown,
    highlightedSkillIndex,
    insertSkillCompletion,
    setHighlightedSkillIndex: completion.setHighlightedIndex,
    showSkillCompletionMenu,
    skillCompletions,
  };
}

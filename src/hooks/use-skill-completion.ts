import { useMemo, useState, type KeyboardEvent } from "react";
import {
  readSkillPromptEditorText,
  replaceSkillPromptCompletionToken,
} from "@/lib/lexical-skill-prompt";
import {
  matchingSkillCompletions,
  moveSkillCompletionIndex,
  skillCompletionToken,
} from "@/lib/roder-skills";
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

type SkillCompletionUiState = {
  completionKey: string | null;
  dismissedCompletionKey: string | null;
  highlightedSkillIndex: number;
};

export function useSkillCompletion({
  editor,
  prompt,
  caretPosition,
  skills,
  onPromptChange,
}: UseSkillCompletionOptions): SkillCompletionState {
  const [uiState, setUiState] = useState<SkillCompletionUiState>({
    completionKey: null,
    dismissedCompletionKey: null,
    highlightedSkillIndex: 0,
  });
  const completionToken = useMemo(() => skillCompletionToken(prompt, caretPosition), [caretPosition, prompt]);
  const completionKey = completionToken
    ? `${completionToken.start}:${completionToken.end}:${completionToken.query}`
    : null;
  const skillCompletions = useMemo(
    () => (completionToken ? matchingSkillCompletions(skills, completionToken.query) : []),
    [completionToken, skills],
  );
  const currentUiState =
    uiState.completionKey === completionKey
      ? uiState
      : { completionKey, dismissedCompletionKey: null, highlightedSkillIndex: 0 };
  const showSkillCompletionMenu =
    Boolean(completionToken && skillCompletions.length > 0) && completionKey !== currentUiState.dismissedCompletionKey;
  const highlightedSkillIndex = showSkillCompletionMenu
    ? Math.max(0, Math.min(currentUiState.highlightedSkillIndex, skillCompletions.length - 1))
    : currentUiState.highlightedSkillIndex;

  function insertSkillCompletion(skill: SkillDescriptor): void {
    if (!completionToken) {
      return;
    }
    const nextCaret = replaceSkillPromptCompletionToken(editor, completionToken, skill.name, skills);
    const nextPrompt = readSkillPromptEditorText(editor);
    onPromptChange(nextPrompt, nextCaret);
    setUiState({ completionKey, dismissedCompletionKey: null, highlightedSkillIndex: 0 });
    requestAnimationFrame(() => {
      editor.focus();
    });
  }

  function selectedSkillForKeyboard(): SkillDescriptor | undefined {
    return skillCompletions[highlightedSkillIndex];
  }

  function moveSkillCompletionHighlight(direction: "next" | "previous"): void {
    setUiState((state) => {
      const previousIndex = state.completionKey === completionKey ? state.highlightedSkillIndex : 0;
      return {
        completionKey,
        dismissedCompletionKey: state.completionKey === completionKey ? state.dismissedCompletionKey : null,
        highlightedSkillIndex: moveSkillCompletionIndex(previousIndex, skillCompletions.length, direction),
      };
    });
  }

  function dismissSkillCompletion(): void {
    if (completionKey) {
      setUiState({
        completionKey,
        dismissedCompletionKey: completionKey,
        highlightedSkillIndex,
      });
    }
  }

  function handleSkillCompletionKeyDown(event: KeyboardEvent<HTMLDivElement>): boolean {
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
    setHighlightedSkillIndex: (index) =>
      setUiState({
        completionKey,
        dismissedCompletionKey: currentUiState.dismissedCompletionKey,
        highlightedSkillIndex: index,
      }),
    showSkillCompletionMenu,
    skillCompletions,
  };
}

import { useState } from "react";
import {
  completionKey as completionKeyForToken,
  currentCompletionUiState,
  moveCompletionIndex,
  shouldShowCompletionMenu,
  type CompletionToken,
  type CompletionUiState,
} from "@/lib/composer-completions";

type UseComposerCompletionOptions = {
  token: CompletionToken | null;
  itemCount: number;
};

type ComposerCompletionState = {
  completionKey: string | null;
  dismissedCompletionKey: string | null;
  highlightedIndex: number;
  showMenu: boolean;
  dismiss: () => void;
  moveHighlight: (direction: "next" | "previous") => void;
  reset: () => void;
  setHighlightedIndex: (index: number) => void;
};

export function useComposerCompletion({ token, itemCount }: UseComposerCompletionOptions): ComposerCompletionState {
  const [uiState, setUiState] = useState<CompletionUiState>({
    completionKey: null,
    dismissedCompletionKey: null,
    highlightedIndex: 0,
  });
  const key = completionKeyForToken(token);
  const currentState = currentCompletionUiState(uiState, key);
  const showMenu = shouldShowCompletionMenu(key, currentState.dismissedCompletionKey, itemCount);
  const highlightedIndex = showMenu
    ? Math.max(0, Math.min(currentState.highlightedIndex, itemCount - 1))
    : currentState.highlightedIndex;

  function moveHighlight(direction: "next" | "previous"): void {
    setUiState((state) => {
      const previousIndex = state.completionKey === key ? state.highlightedIndex : 0;
      return {
        completionKey: key,
        dismissedCompletionKey: state.completionKey === key ? state.dismissedCompletionKey : null,
        highlightedIndex: moveCompletionIndex(previousIndex, itemCount, direction),
      };
    });
  }

  function dismiss(): void {
    if (key) {
      setUiState((state) => {
        const stateForKey = currentCompletionUiState(state, key);
        return {
          completionKey: key,
          dismissedCompletionKey: key,
          highlightedIndex: boundedCompletionIndex(stateForKey.highlightedIndex, itemCount),
        };
      });
    }
  }

  return {
    completionKey: key,
    dismissedCompletionKey: currentState.dismissedCompletionKey,
    highlightedIndex,
    showMenu,
    dismiss,
    moveHighlight,
    reset: () => setUiState(() => ({ completionKey: key, dismissedCompletionKey: null, highlightedIndex: 0 })),
    setHighlightedIndex: (index) =>
      setUiState((state) => {
        const stateForKey = currentCompletionUiState(state, key);
        return {
          completionKey: key,
          dismissedCompletionKey: stateForKey.dismissedCompletionKey,
          highlightedIndex: index,
        };
      }),
  };
}

function boundedCompletionIndex(index: number, itemCount: number): number {
  return Math.max(0, Math.min(index, itemCount - 1));
}

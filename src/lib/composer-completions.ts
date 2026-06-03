export type CompletionToken = {
  start: number;
  end: number;
  query: string;
};

export type CompletionUiState = {
  completionKey: string | null;
  dismissedCompletionKey: string | null;
  highlightedIndex: number;
};

export type CompletionEditingKeyEvent = {
  altKey?: boolean;
  ctrlKey?: boolean;
  key: string;
  metaKey?: boolean;
};

export function completionKey(token: CompletionToken | null): string | null {
  return token ? `${token.start}:${token.end}:${token.query}` : null;
}

export function completionOptionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}

export function currentCompletionUiState(state: CompletionUiState, key: string | null): CompletionUiState {
  return state.completionKey === key
    ? state
    : { completionKey: key, dismissedCompletionKey: null, highlightedIndex: 0 };
}

export function shouldShowCompletionMenu(key: string | null, dismissedKey: string | null, itemCount: number): boolean {
  return Boolean(key && itemCount > 0 && key !== dismissedKey);
}

export function shouldClearDismissedCompletion(
  key: string | null,
  dismissedKey: string | null,
  event: CompletionEditingKeyEvent,
): boolean {
  if (!key || key !== dismissedKey) {
    return false;
  }
  if (event.key === "Backspace" || event.key === "Delete") {
    return true;
  }
  return event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey;
}

export function moveCompletionIndex(currentIndex: number, itemCount: number, direction: "next" | "previous"): number {
  if (itemCount <= 0) {
    return -1;
  }

  if (currentIndex < 0 || currentIndex >= itemCount) {
    return direction === "next" ? 0 : itemCount - 1;
  }
  if (direction === "next") {
    return (currentIndex + 1) % itemCount;
  }
  return (currentIndex - 1 + itemCount) % itemCount;
}

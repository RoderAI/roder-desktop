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

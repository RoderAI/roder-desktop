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

/** Insert `$` / `@` (etc.) at the caret, adding a leading space when mid-word so completion can open. */
export function completionTriggerInsertion(
  text: string,
  caret: number,
  trigger: string,
): { text: string; caret: number } {
  const clampedCaret = Math.max(0, Math.min(caret, text.length));
  const previous = clampedCaret > 0 ? text[clampedCaret - 1] : undefined;
  const needsLeadingSpace = previous !== undefined && !isCompletionTriggerBoundary(previous);
  const insertion = needsLeadingSpace ? ` ${trigger}` : trigger;
  return {
    text: `${text.slice(0, clampedCaret)}${insertion}${text.slice(clampedCaret)}`,
    caret: clampedCaret + insertion.length,
  };
}

function isCompletionTriggerBoundary(character: string): boolean {
  return /\s/.test(character) || "([{,;".includes(character);
}

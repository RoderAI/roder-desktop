export const transcriptScrollAffordanceThresholdPx = 4;

export type TranscriptEndStateSource = {
  isAtEnd: (threshold?: number) => boolean;
};

export type TranscriptScrollAffordanceInput = {
  rowCount: number;
  source: TranscriptEndStateSource;
  threshold?: number;
};

export type TranscriptFollowAction =
  | {
      behavior: "auto";
      kind: "explicit";
    }
  | {
      behavior: "auto";
      kind: "auto";
      scrollObservationVersion: number;
    }
  | {
      kind: "none";
    };

export type TranscriptFollowActionInput = {
  followSignalChanged: boolean;
  pinnedToEnd: boolean;
  scrollObservationVersion: number;
  transcriptChanged: boolean;
};

export type TranscriptPinnedIntentInput = {
  observedCanScrollToBottom: boolean;
  pinnedToEnd: boolean;
  userScrollIntent: boolean;
};

export type TranscriptScrollAffordanceVisibilityInput = {
  observedCanScrollToBottom: boolean;
  pinnedToEnd: boolean;
  rowCount: number;
};

export type TranscriptScrollRestorationState = {
  pinnedToEnd: boolean;
  scrollOffset: number;
};

export type TranscriptViewportScrollMetrics = {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
};

export type TranscriptScrollRestorationAction =
  | {
      kind: "end";
      pinnedToEnd: true;
    }
  | {
      kind: "offset";
      pinnedToEnd: boolean;
      scrollOffset: number;
    };

export function canScrollTranscriptToBottom(
  source: TranscriptEndStateSource,
  threshold = transcriptScrollAffordanceThresholdPx,
): boolean {
  return !source.isAtEnd(threshold);
}

export function canScrollTranscriptRowsToBottom({
  rowCount,
  source,
  threshold = transcriptScrollAffordanceThresholdPx,
}: TranscriptScrollAffordanceInput): boolean {
  if (rowCount === 0) {
    return false;
  }
  return canScrollTranscriptToBottom(source, threshold);
}

export function transcriptFollowAction({
  followSignalChanged,
  pinnedToEnd,
  scrollObservationVersion,
  transcriptChanged,
}: TranscriptFollowActionInput): TranscriptFollowAction {
  if (followSignalChanged) {
    return {
      behavior: "auto",
      kind: "explicit",
    };
  }
  if (transcriptChanged && pinnedToEnd) {
    return {
      behavior: "auto",
      kind: "auto",
      scrollObservationVersion,
    };
  }
  return { kind: "none" };
}

export function nextTranscriptPinnedToEnd({
  observedCanScrollToBottom,
  pinnedToEnd,
  userScrollIntent,
}: TranscriptPinnedIntentInput): boolean {
  if (userScrollIntent) {
    return !observedCanScrollToBottom;
  }
  if (!observedCanScrollToBottom) {
    return true;
  }
  return pinnedToEnd;
}

export function shouldShowTranscriptScrollAffordance({
  observedCanScrollToBottom,
  pinnedToEnd,
  rowCount,
}: TranscriptScrollAffordanceVisibilityInput): boolean {
  return rowCount > 0 && observedCanScrollToBottom && !pinnedToEnd;
}

export function canScrollTranscriptViewportToBottom(
  { clientHeight, scrollHeight, scrollTop }: TranscriptViewportScrollMetrics,
  threshold = transcriptScrollAffordanceThresholdPx,
): boolean {
  return Math.max(0, scrollHeight - clientHeight - scrollTop) > threshold;
}

export function transcriptScrollRestorationStateFromViewport(
  metrics: TranscriptViewportScrollMetrics,
): TranscriptScrollRestorationState {
  return {
    pinnedToEnd: !canScrollTranscriptViewportToBottom(metrics),
    scrollOffset: Math.max(0, metrics.scrollTop),
  };
}

export function transcriptScrollRestorationAction({
  restoredState,
  rowCount,
}: {
  restoredState?: TranscriptScrollRestorationState;
  rowCount: number;
}): TranscriptScrollRestorationAction {
  if (restoredState) {
    if (restoredState.pinnedToEnd) {
      return { kind: "end", pinnedToEnd: true };
    }
    return {
      kind: "offset",
      pinnedToEnd: false,
      scrollOffset: Math.max(0, restoredState.scrollOffset),
    };
  }

  if (rowCount > 0) {
    return { kind: "end", pinnedToEnd: true };
  }

  return { kind: "offset", pinnedToEnd: true, scrollOffset: 0 };
}

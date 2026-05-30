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

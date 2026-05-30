import { expect, test } from "vitest";
import {
  canScrollTranscriptRowsToBottom,
  canScrollTranscriptToBottom,
  nextTranscriptPinnedToEnd,
  shouldShowTranscriptScrollAffordance,
  transcriptFollowAction,
  transcriptScrollAffordanceThresholdPx,
} from "../src/lib/transcript-scroll";

test("reports no scroll affordance when the virtualizer is at the transcript end", () => {
  const thresholds: Array<number | undefined> = [];
  const canScroll = canScrollTranscriptToBottom({
    isAtEnd: (threshold) => {
      thresholds.push(threshold);
      return true;
    },
  });

  expect(canScroll).toBe(false);
  expect(thresholds).toEqual([transcriptScrollAffordanceThresholdPx]);
});

test("reports the scroll affordance when the virtualizer is away from the transcript end", () => {
  expect(
    canScrollTranscriptToBottom({
      isAtEnd: () => false,
    }),
  ).toBe(true);
});

test("passes a custom threshold through to the virtualizer", () => {
  const thresholds: Array<number | undefined> = [];
  canScrollTranscriptToBottom(
    {
      isAtEnd: (threshold) => {
        thresholds.push(threshold);
        return false;
      },
    },
    24,
  );

  expect(thresholds).toEqual([24]);
});

test("reports no scroll affordance for an empty transcript even if the virtualizer is away from the end", () => {
  expect(
    canScrollTranscriptRowsToBottom({
      rowCount: 0,
      source: {
        isAtEnd: () => false,
      },
    }),
  ).toBe(false);
});

test("reports the scroll affordance for non-empty transcript rows", () => {
  expect(
    canScrollTranscriptRowsToBottom({
      rowCount: 1,
      source: {
        isAtEnd: () => false,
      },
    }),
  ).toBe(true);
});

test("explicit follow requests scroll immediately to the end", () => {
  expect(
    transcriptFollowAction({
      followSignalChanged: true,
      pinnedToEnd: false,
      scrollObservationVersion: 8,
      transcriptChanged: false,
    }),
  ).toEqual({ behavior: "auto", kind: "explicit" });
});

test("keeps streaming growth on instant auto-follow so virtualizer end anchoring can resize-correct", () => {
  expect(
    transcriptFollowAction({
      followSignalChanged: false,
      pinnedToEnd: true,
      scrollObservationVersion: 12,
      transcriptChanged: true,
    }),
  ).toEqual({ behavior: "auto", kind: "auto", scrollObservationVersion: 12 });
});

test("does not auto-follow transcript changes after the user scrolls away", () => {
  expect(
    transcriptFollowAction({
      followSignalChanged: false,
      pinnedToEnd: false,
      scrollObservationVersion: 12,
      transcriptChanged: true,
    }),
  ).toEqual({ kind: "none" });
});

test("does not follow unchanged transcripts without an explicit request", () => {
  expect(
    transcriptFollowAction({
      followSignalChanged: false,
      pinnedToEnd: true,
      scrollObservationVersion: 12,
      transcriptChanged: false,
    }),
  ).toEqual({ kind: "none" });
});

test("keeps pinned intent through transient resize observations that are not user scrolls", () => {
  expect(
    nextTranscriptPinnedToEnd({
      observedCanScrollToBottom: true,
      pinnedToEnd: true,
      userScrollIntent: false,
    }),
  ).toBe(true);
});

test("releases pinned intent when the user scrolls away from the end", () => {
  expect(
    nextTranscriptPinnedToEnd({
      observedCanScrollToBottom: true,
      pinnedToEnd: true,
      userScrollIntent: true,
    }),
  ).toBe(false);
});

test("restores pinned intent when scrolling reaches the end", () => {
  expect(
    nextTranscriptPinnedToEnd({
      observedCanScrollToBottom: false,
      pinnedToEnd: false,
      userScrollIntent: false,
    }),
  ).toBe(true);
});

test("hides the scroll affordance while pinned even if resize observation is temporarily away from the end", () => {
  expect(
    shouldShowTranscriptScrollAffordance({
      observedCanScrollToBottom: true,
      pinnedToEnd: true,
      rowCount: 3,
    }),
  ).toBe(false);
});

test("shows the scroll affordance only after the user is away from the end", () => {
  expect(
    shouldShowTranscriptScrollAffordance({
      observedCanScrollToBottom: true,
      pinnedToEnd: false,
      rowCount: 3,
    }),
  ).toBe(true);
});

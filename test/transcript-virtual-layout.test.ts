import { expect, test } from "vitest";
import { transcriptVirtualPadding } from "../src/lib/transcript-scroll";

test("reserves unmounted history and space below the visible rows", () => {
  const visibleRows = [
    { start: 3400, end: 3436 },
    { start: 3436, end: 3480 },
  ];
  expect(transcriptVirtualPadding(visibleRows, 4900)).toEqual({ paddingTop: 3400, paddingBottom: 1420 });
});

test("keeps the composer inset below the live tail regardless of its measured height", () => {
  const before = transcriptVirtualPadding(
    [
      { start: 400, end: 436 },
      { start: 436, end: 480 },
    ],
    580,
  );
  const after = transcriptVirtualPadding(
    [
      { start: 400, end: 518 },
      { start: 518, end: 562 },
    ],
    662,
  );
  expect(before).toEqual({ paddingTop: 400, paddingBottom: 100 });
  expect(after).toEqual(before);
});

test("reserves the estimated size before the viewport mounts any rows", () => {
  expect(transcriptVirtualPadding([], 400)).toEqual({ paddingTop: 0, paddingBottom: 400 });
});

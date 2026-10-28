import { expect, test } from "vitest";
import {
  buildTranscriptHistoryRows,
  reconcileTranscriptRows,
  transcriptRowsSearchText,
} from "../src/lib/transcript-rows";
import { estimateTranscriptRowSize } from "../src/components/transcript";
import { buildTranscriptNavigation } from "../src/lib/transcript-navigation";

test("full conversation geometry is reserved before any older message payload is loaded", () => {
  const rows = buildTranscriptHistoryRows(20_003, 40);
  expect(rows).toHaveLength(Math.ceil(20_003 / 32));
  expect(rows.reduce((size, row) => size + estimateTranscriptRowSize(row), 0)).toBe(20_003 * 40);
  expect(rows[0]).toMatchObject({ kind: "history", start: 0, end: 32 });
  expect(rows.at(-1)).toMatchObject({ start: 20_000, end: 20_003 });
  expect(rows.some((row) => "entry" in row)).toBe(false);
});

test("history slots retain identity and dimensions when cached pages change", () => {
  const initial = buildTranscriptHistoryRows(10_000, 48);
  const rebuilt = buildTranscriptHistoryRows(10_000, 48);
  expect(reconcileTranscriptRows(initial, rebuilt)).toBe(initial);
  expect(buildTranscriptNavigation(initial)).toEqual([]);
  expect(transcriptRowsSearchText(initial)).toBe("");
  expect(buildTranscriptHistoryRows(0, 48)).toEqual([]);
});

import { expect, test } from "vitest";
import { pruneTranscriptDisclosureState, setTranscriptDisclosureOpen } from "../src/lib/transcript-disclosure-state";

test("sets disclosure state by key without mutating unrelated rows", () => {
  const state = setTranscriptDisclosureOpen({ "tool:a": true }, "tool:b", true);

  expect(state).toEqual({
    "tool:a": true,
    "tool:b": true,
  });
});

test("returns the same state object when the requested disclosure value is unchanged", () => {
  const state = { "tool:a": true };

  expect(setTranscriptDisclosureOpen(state, "tool:a", true)).toBe(state);
});

test("prunes disclosure state for rows that are no longer present", () => {
  expect(
    pruneTranscriptDisclosureState(
      {
        "tool:a": true,
        "tool:b": false,
        "tool:c": true,
      },
      ["tool:a", "tool:c"],
    ),
  ).toEqual({
    "tool:a": true,
    "tool:c": true,
  });
});

test("returns the same state object when no stale disclosure keys exist", () => {
  const state = { "tool:a": true };

  expect(pruneTranscriptDisclosureState(state, ["tool:a"])).toBe(state);
});

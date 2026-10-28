import { expect, test } from "vitest";
import { pruneTranscriptDisclosureState, setTranscriptDisclosureOpen } from "../src/lib/transcript-disclosure-state";
import { buildTranscriptRows, transcriptRowDisclosureKeys } from "../src/lib/transcript-rows";

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

test("batched subagent message disclosures stay independent and survive transcript row rebuilding", () => {
  const envelope = (sender: string) => `Message Type: MESSAGE\nTask name: /root\nSender: ${sender}\nPayload:\nProgress`;
  const messages = [
    {
      id: "mailbox",
      threadId: "parent",
      role: "user" as const,
      status: "complete" as const,
      text: `${envelope("/root/first")}\n\n${envelope("/root/second")}`,
    },
  ];
  const row = buildTranscriptRows({ messages })[0];
  const keys = transcriptRowDisclosureKeys(row);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe("disclosure:message:mailbox:subagent:delivery:0");
  expect(keys[1]).not.toBe(keys[0]);
  const state = setTranscriptDisclosureOpen({}, keys[1], true);
  expect(
    pruneTranscriptDisclosureState(state, transcriptRowDisclosureKeys(buildTranscriptRows({ messages })[0])),
  ).toEqual({ [keys[1]]: true });
});

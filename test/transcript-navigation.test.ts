import { expect, test } from "vitest";
import { buildTranscriptRows } from "../src/lib/transcript-rows";
import {
  activeTranscriptNavigationId,
  buildTranscriptNavigation,
  transcriptNavigationKeyIndex,
  transcriptNavigationPreview,
  transcriptNavigationTarget,
} from "../src/lib/transcript-navigation";
import type { ConversationMessage } from "../src/types/roder";

const message = (id: string, role: ConversationMessage["role"], text: string): ConversationMessage => ({
  id,
  role,
  text,
  status: "complete",
});

test("navigation maps real conversation messages to virtual rows, not raw message indexes", () => {
  const rows = buildTranscriptRows({
    messages: [
      message("user", "user", "First\n question"),
      { ...message("tool", "tool", "Read file"), toolName: "read_file" },
      message("answer", "assistant", "The answer"),
      message("empty", "assistant", ""),
    ],
    showWorkingIndicator: true,
  });
  const entries = buildTranscriptNavigation(rows);
  expect(entries).toEqual([
    { id: "user", role: "user", preview: "First question", rowIndex: 0 },
    { id: "answer", role: "assistant", preview: "The answer", rowIndex: 2 },
  ]);
  expect(transcriptNavigationTarget(entries, "answer")).toBe(2);
  expect(transcriptNavigationTarget(entries, "missing-from-this-thread")).toBeNull();
});

test("current marker follows the conversation message before a visible tool row and the end when pinned", () => {
  const entries = [
    { id: "first", role: "user" as const, preview: "First", rowIndex: 0 },
    { id: "last", role: "assistant" as const, preview: "Last", rowIndex: 5 },
  ];
  expect(activeTranscriptNavigationId(entries, 3, false)).toBe("first");
  expect(activeTranscriptNavigationId(entries, 5, false)).toBe("last");
  expect(activeTranscriptNavigationId(entries, 0, true)).toBe("last");
  expect(activeTranscriptNavigationId([], 0, false)).toBeNull();
});

test("keyboard navigation is bounded and supports the first and last message", () => {
  expect(transcriptNavigationKeyIndex("ArrowDown", 1, 3)).toBe(2);
  expect(transcriptNavigationKeyIndex("ArrowDown", 2, 3)).toBe(2);
  expect(transcriptNavigationKeyIndex("ArrowUp", 0, 3)).toBe(0);
  expect(transcriptNavigationKeyIndex("Home", 2, 3)).toBe(0);
  expect(transcriptNavigationKeyIndex("End", 0, 3)).toBe(2);
  expect(transcriptNavigationKeyIndex("Enter", 0, 3)).toBeNull();
  expect(transcriptNavigationKeyIndex("Home", 0, 0)).toBeNull();
});

test("clicking an already-visible or bottom-clamped message preserves its selected marker", () => {
  const entries = [
    { id: "first", role: "user" as const, preview: "First", rowIndex: 0 },
    { id: "last", role: "assistant" as const, preview: "Last", rowIndex: 5 },
  ];
  expect(activeTranscriptNavigationId(entries, 0, true, "first")).toBe("first");
  expect(activeTranscriptNavigationId(entries, 0, false, "last")).toBe("last");
  expect(activeTranscriptNavigationId(entries, 0, false, null)).toBe("first");
  expect(activeTranscriptNavigationId(entries, 0, false, "removed-message")).toBe("first");
});

test("hover previews preserve the message heading, paragraphs, and list indentation", () => {
  expect(
    transcriptNavigationPreview(
      "  **GitHub verification worked**\n\nCompleted and verified:\n\n  • Google callback\n    and authorized domains  ",
    ),
  ).toEqual({
    title: "**GitHub verification worked**",
    body: "Completed and verified:\n\n  • Google callback\n    and authorized domains",
  });
  expect(transcriptNavigationPreview("A short question")).toEqual({ title: "A short question", body: "" });
  expect(transcriptNavigationPreview("Heading\r\n\r\nWindows paragraph")).toEqual({
    title: "Heading",
    body: "Windows paragraph",
  });
  expect(transcriptNavigationPreview("x".repeat(2_000)).title).toHaveLength(640);
});

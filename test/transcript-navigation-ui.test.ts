import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { TranscriptNavigation } from "../src/components/transcript-navigation";
import { buildTranscriptNavigation } from "../src/lib/transcript-navigation";
import { buildTranscriptRows } from "../src/lib/transcript-rows";
import { roderIpc } from "../src/lib/roder-ipc";
import type { ConversationMessage } from "../src/types/roder";

test("the rail renders only the user's markers, not assistant or subagent messages", () => {
  const messages: ConversationMessage[] = [
    { id: "mine", role: "user", text: "My question", status: "complete" },
    { id: "answer", role: "assistant", text: "An assistant answer", status: "complete" },
    {
      id: "inbox",
      role: "user",
      text: "Message Type: MESSAGE\nTask name: /root\nSender: /root/reviewer\nPayload:\nAgent update.",
      status: "complete",
    },
  ];
  const html = renderToStaticMarkup(
    createElement(TranscriptNavigation, {
      items: buildTranscriptNavigation(buildTranscriptRows({ messages })),
      messages,
      activeId: "mine",
      bottomInsetPx: 0,
      onSelect: () => {},
    }),
  );
  expect(html).toContain('aria-label="Your message navigation"');
  expect(html).toContain('data-transcript-nav="mine"');
  expect(html).toContain("Jump to your message 1: My question");
  expect(html).not.toContain('data-transcript-nav="answer"');
  expect(html).not.toContain('data-transcript-nav="inbox"');
});

test("unloaded user summaries render markers without rendering transcript bodies or fetching during render", () => {
  const read = vi.spyOn(roderIpc, "readThreadHistory");
  try {
    const html = renderToStaticMarkup(
      createElement(TranscriptNavigation, {
        items: [{ id: "old", role: "user", preview: "Older question", rowIndex: -1 }],
        messages: [],
        activeId: null,
        bottomInsetPx: 0,
        onSelect: () => {},
        history: { threadId: "thread", before: "older" },
      }),
    );
    expect(html).toContain('data-transcript-nav="old"');
    expect(html).toContain("Jump to your message 1: Older question");
    expect(html).not.toContain("data-index");
    expect(read).not.toHaveBeenCalled();
  } finally {
    read.mockRestore();
  }
});

import { expect, test } from "vitest";
import { applyThreadItemEvent, messagesFromThread } from "../src/lib/roder-thread";
import type { RoderThread, RoderItem } from "../src/types/roder";

const summary =
  "Model switch summary: previous profile mock/mock used edit tool none. Current profile codex/gpt-6.1-sol uses edit tool patch. Available tools now: agent_swarm, apply_patch, chrome_click.";

function thread(items: RoderItem[]): RoderThread {
  return {
    id: "thread",
    model: "gpt-6.1-sol",
    modelProvider: "codex",
    preview: "hi",
    cwd: "/workspace",
    createdAt: 1,
    updatedAt: 1,
    status: { type: "idle", activeTurnId: null, activeFlags: [] },
    turns: [{ id: "turn", items, itemsView: "default", status: "completed" }],
  };
}

test("engine model switch context remains in saved thread data but not the visible transcript", () => {
  const source = thread([
    { id: "user", type: "userMessage", text: "hi" },
    { id: "internal", type: "userMessage", text: summary },
    { id: "answer", type: "agentMessage", text: "Hello" },
  ]);
  expect(messagesFromThread(source).map((message) => message.text)).toEqual(["hi", "Hello"]);
  expect(source.turns?.[0].items).toHaveLength(3);
  expect(source.turns?.[0].items[1]).toMatchObject({ text: summary });
});

test("live model switch items are hidden through the same projection as reloaded history", () => {
  const next = applyThreadItemEvent(thread([]), {
    seq: 1,
    eventId: "event",
    threadId: "thread",
    turnId: "turn",
    timestamp: "2026-10-24T00:00:00Z",
    event: { type: "itemCompleted", item: { id: "internal", type: "userMessage", text: summary } },
  });
  expect(messagesFromThread(next)).toEqual([]);
});

test("ordinary messages discussing model switches and assistant quotations remain visible", () => {
  const source = thread([
    { id: "user", type: "userMessage", text: "Model switch summary: please explain this feature" },
    { id: "quoted", type: "userMessage", text: `Please inspect this log:\n${summary}` },
    { id: "answer", type: "agentMessage", text: summary },
    { id: "image", type: "userMessage", text: summary, images: [{ imageUrl: "data:image/png;base64,test" }] },
  ]);
  expect(messagesFromThread(source).map((message) => message.id)).toEqual(["user", "quoted", "answer", "image"]);
});

import { expect, test } from "vitest";
import {
  applyThreadItemEvent,
  isThreadRunning,
  markThreadStatus,
  messagesFromThread,
  patchThread,
  shouldShowThreadWorkingIndicator,
  upsertThread,
} from "../src/lib/roder-thread";

function thread(id, updatedAt) {
  return {
    id,
    name: id,
    preview: "",
    cwd: "/workspace",
    updatedAt,
    status: { type: "idle", activeTurnId: null, activeFlags: [] },
    turns: [],
  };
}

test("updating an existing thread keeps its sidebar position", () => {
  const threads = [thread("thread-a", 100), thread("thread-b", 90), thread("thread-c", 80)];

  const result = upsertThread(threads, thread("thread-c", 200));

  expect(Array.from(result, (item) => item.id)).toEqual(["thread-a", "thread-b", "thread-c"]);
  expect(result[2].updatedAt).toBe(200);
});

test("new threads are added at the top of the sidebar order", () => {
  const threads = [thread("thread-a", 100), thread("thread-b", 90)];

  const result = upsertThread(threads, thread("thread-c", 80));

  expect(Array.from(result, (item) => item.id)).toEqual(["thread-c", "thread-a", "thread-b"]);
});

test("backend thread snapshots replace local activity status", () => {
  const running = { ...thread("thread-a", 100), status: { type: "running", activeTurnId: "turn-a", activeFlags: [] } };

  const result = upsertThread([running], thread("thread-a", 120));

  expect(result[0].status).toEqual({ type: "idle", activeTurnId: null, activeFlags: [] });
});

test("explicit status changes update thread activity", () => {
  const threads = [thread("thread-a", 100), thread("thread-b", 90)];

  const running = markThreadStatus(threads, "thread-b", { type: "running", activeTurnId: "turn-b", activeFlags: [] });
  expect(isThreadRunning(running[1])).toBe(true);
  expect(running[1].status.activeTurnId).toBe("turn-b");

  const idle = markThreadStatus(running, "thread-b", { type: "idle", activeTurnId: null, activeFlags: [] });
  expect(isThreadRunning(idle[1])).toBe(false);
  expect(idle[1].status.activeTurnId).toBe(null);
});

test("thread title patches update in place without waiting for a list refresh", () => {
  const threads = [thread("thread-a", 100), thread("thread-b", 90)];

  const result = patchThread(threads, "thread-b", { name: "Named thread", preview: "Fallback title", updatedAt: 120 });

  expect(Array.from(result, (item) => item.id)).toEqual(["thread-a", "thread-b"]);
  expect(result[1].name).toBe("Named thread");
  expect(result[1].preview).toBe("Fallback title");
  expect(result[1].updatedAt).toBe(120);
});

test("working indicator follows active thread work without covering waits", () => {
  const running = { ...thread("thread-a", 100), status: { type: "running", activeTurnId: "turn-a", activeFlags: [] } };
  const waiting = {
    ...running,
    status: { type: "running", activeTurnId: "turn-a", activeFlags: ["approvalRequired"] },
  };
  const streamingAssistantMessages = [{ id: "message-1", role: "assistant", text: "Hello", status: "streaming" }];
  const streamingToolMessages = [{ id: "tool-1", role: "tool", text: "Reading", status: "streaming" }];
  const staleAssistantStreamWithLaterTool = [
    { id: "message-1", turnId: "turn-a", role: "assistant", text: "Thinking", status: "streaming" },
    { id: "tool-1", turnId: "turn-a", role: "tool", text: "Read src", status: "complete" },
  ];

  expect(shouldShowThreadWorkingIndicator(running, 0, [])).toBe(true);
  expect(shouldShowThreadWorkingIndicator(running, 0, streamingToolMessages)).toBe(true);
  expect(shouldShowThreadWorkingIndicator(running, 0, streamingAssistantMessages)).toBe(false);
  expect(shouldShowThreadWorkingIndicator(running, 0, staleAssistantStreamWithLaterTool)).toBe(true);
  expect(shouldShowThreadWorkingIndicator(running, 1, [])).toBe(false);
  expect(shouldShowThreadWorkingIndicator(waiting, 0, [])).toBe(false);
  expect(shouldShowThreadWorkingIndicator(thread("thread-b", 90), 0, [])).toBe(false);
});

test("message snapshots are reused for unchanged thread objects", () => {
  const current = {
    ...thread("thread-a", 100),
    turns: [
      {
        id: "turn-a",
        itemsView: "default",
        status: "completed",
        items: [{ id: "message-a", type: "userMessage", text: "Hello" }],
      },
    ],
  };

  const first = messagesFromThread(current);
  const second = messagesFromThread(current);

  expect(first).toBe(second);
});

test("user message images are projected into transcript messages", () => {
  const current = {
    ...thread("thread-a", 100),
    turns: [
      {
        id: "turn-a",
        itemsView: "default",
        status: "completed",
        items: [
          {
            id: "message-a",
            type: "userMessage",
            text: "clean this sketch up",
            images: [{ imageUrl: "data:image/png;base64,YWJj" }],
          },
        ],
      },
    ],
  };

  expect(messagesFromThread(current)).toEqual([
    {
      id: "message-a",
      threadId: "thread-a",
      turnId: "turn-a",
      role: "user",
      text: "clean this sketch up",
      images: [{ imageUrl: "data:image/png;base64,YWJj" }],
      status: "complete",
    },
  ]);
});

test("typed item events keep reasoning items hidden and project commentary updates", () => {
  let current = {
    ...thread("thread-a", 100),
    status: { type: "running", activeTurnId: "turn-a", activeFlags: [] },
    turns: [{ id: "turn-a", items: [], itemsView: "default", status: "inProgress" }],
  };

  current = applyThreadItemEvent(current, {
    seq: 1,
    eventId: "event-1",
    threadId: "thread-a",
    turnId: "turn-a",
    timestamp: "1970-01-01T00:00:00Z",
    event: {
      type: "itemStarted",
      item: { id: "turn-a-agent-reasoning", type: "reasoning", summary: [], content: [""], status: "inProgress" },
    },
  });
  current = applyThreadItemEvent(current, {
    seq: 2,
    eventId: "event-2",
    threadId: "thread-a",
    turnId: "turn-a",
    timestamp: "1970-01-01T00:00:00Z",
    event: {
      type: "itemDelta",
      itemId: "turn-a-agent-reasoning",
      delta: { type: "reasoningText", delta: "thinking", contentIndex: 0 },
    },
  });
  current = applyThreadItemEvent(current, {
    seq: 3,
    eventId: "event-3",
    threadId: "thread-a",
    turnId: "turn-a",
    timestamp: "1970-01-01T00:00:00Z",
    event: {
      type: "itemDelta",
      itemId: "turn-a-agent-commentary",
      delta: { type: "agentMessageText", delta: "checking files", phase: "commentary" },
    },
  });
  current = applyThreadItemEvent(current, {
    seq: 4,
    eventId: "event-4",
    threadId: "thread-a",
    turnId: "turn-a",
    timestamp: "1970-01-01T00:00:00Z",
    event: {
      type: "itemDelta",
      itemId: "turn-a-agent-final_answer",
      delta: { type: "agentMessageText", delta: "done", phase: "final_answer" },
    },
  });

  const items = current.turns[0].items;
  expect(items.length).toBe(3);
  expect(items[0].type).toBe("reasoning");
  expect(Array.from(items[0].content)).toEqual(["thinking"]);
  expect(items[1].type).toBe("agentMessage");
  expect(items[1].text).toBe("checking files");
  expect(items[1].phase).toBe("commentary");
  expect(items[2].type).toBe("agentMessage");
  expect(items[2].text).toBe("done");

  const messages = messagesFromThread(current);
  expect(plain(messages.map((message) => [message.id, message.text, message.phase]))).toEqual([
    ["turn-a-agent-commentary:commentary", "checking files", "commentary"],
    ["turn-a-agent-final_answer", "done", "final_answer"],
  ]);
});

test("duplicate completed message item ids are preserved as separate transcript messages", () => {
  let current = {
    ...thread("thread-a", 100),
    turns: [{ id: "turn-a", items: [], itemsView: "default", status: "inProgress" }],
  };

  current = applyThreadItemEvent(current, {
    seq: 1,
    eventId: "event-1",
    threadId: "thread-a",
    turnId: "turn-a",
    timestamp: "1970-01-01T00:00:00Z",
    event: {
      type: "itemCompleted",
      item: { id: "turn-a-user", type: "userMessage", text: "tell me about this project", status: "completed" },
    },
  });
  current = applyThreadItemEvent(current, {
    seq: 2,
    eventId: "event-2",
    threadId: "thread-a",
    turnId: "turn-a",
    timestamp: "1970-01-01T00:00:00Z",
    event: {
      type: "itemDelta",
      itemId: "turn-a-agent-final_answer",
      delta: { type: "agentMessageText", delta: "This looks like VoicePlan.", phase: "final_answer" },
    },
  });
  current = applyThreadItemEvent(current, {
    seq: 3,
    eventId: "event-3",
    threadId: "thread-a",
    turnId: "turn-a",
    timestamp: "1970-01-01T00:00:00Z",
    event: {
      type: "itemCompleted",
      item: {
        id: "turn-a-agent-final_answer",
        type: "agentMessage",
        text: "This looks like VoicePlan.",
        phase: "final_answer",
        status: "completed",
      },
    },
  });
  current = applyThreadItemEvent(current, {
    seq: 4,
    eventId: "event-4",
    threadId: "thread-a",
    turnId: "turn-a",
    timestamp: "1970-01-01T00:00:00Z",
    event: {
      type: "itemCompleted",
      item: { id: "turn-a-user", type: "userMessage", text: "did you set a goal?", status: "completed" },
    },
  });
  current = applyThreadItemEvent(current, {
    seq: 5,
    eventId: "event-5",
    threadId: "thread-a",
    turnId: "turn-a",
    timestamp: "1970-01-01T00:00:00Z",
    event: {
      type: "itemDelta",
      itemId: "turn-a-agent-final_answer",
      delta: { type: "agentMessageText", delta: "No, I didn't set a goal.", phase: "final_answer" },
    },
  });
  current = applyThreadItemEvent(current, {
    seq: 6,
    eventId: "event-6",
    threadId: "thread-a",
    turnId: "turn-a",
    timestamp: "1970-01-01T00:00:00Z",
    event: {
      type: "itemCompleted",
      item: {
        id: "turn-a-agent-final_answer",
        type: "agentMessage",
        text: "No, I didn't set a goal.",
        phase: "final_answer",
        status: "completed",
      },
    },
  });

  const messages = messagesFromThread(current);
  expect(plain(messages.map((message) => [message.role, message.id, message.text]))).toEqual([
    ["user", "turn-a-user", "tell me about this project"],
    ["assistant", "turn-a-agent-final_answer", "This looks like VoicePlan."],
    ["user", "turn-a-user::duplicate-2", "did you set a goal?"],
    ["assistant", "turn-a-agent-final_answer::duplicate-2", "No, I didn't set a goal."],
  ]);
});

test("duplicate message item ids from loaded thread snapshots are localized", () => {
  const current = {
    ...thread("thread-a", 100),
    turns: [
      {
        id: "turn-a",
        itemsView: "default",
        status: "completed",
        items: [
          { id: "turn-a-user", type: "userMessage", text: "tell me about this project", status: "completed" },
          {
            id: "turn-a-agent-final_answer",
            type: "agentMessage",
            text: "This looks like VoicePlan.",
            phase: "final_answer",
            status: "completed",
          },
          { id: "turn-a-user", type: "userMessage", text: "did you set a goal?", status: "completed" },
          {
            id: "turn-a-agent-final_answer",
            type: "agentMessage",
            text: "No, I didn't set a goal.",
            phase: "final_answer",
            status: "completed",
          },
        ],
      },
    ],
  };

  const messages = messagesFromThread(current);

  expect(plain(messages.map((message) => [message.role, message.id, message.text]))).toEqual([
    ["user", "turn-a-user", "tell me about this project"],
    ["assistant", "turn-a-agent-final_answer", "This looks like VoicePlan."],
    ["user", "turn-a-user::duplicate-2", "did you set a goal?"],
    ["assistant", "turn-a-agent-final_answer::duplicate-2", "No, I didn't set a goal."],
  ]);
});

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

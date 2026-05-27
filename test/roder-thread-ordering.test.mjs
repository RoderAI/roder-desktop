import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const helperSource = readFileSync(new URL("../src/lib/roder-thread.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2023,
  },
}).outputText;

const module = { exports: {} };
new Script(compiled).runInNewContext({
  exports: module.exports,
  module,
  require: (specifier) => {
    if (specifier === "@/lib/tool-display") {
      return { isShellToolName: () => false };
    }
    throw new Error(`Unexpected require: ${specifier}`);
  },
});
const { applyThreadItemEvent, isThreadRunning, markThreadStatus, messagesFromThread, shouldShowThreadWorkingIndicator, upsertThread } = module.exports;

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

  assert.deepEqual(Array.from(result, (item) => item.id), ["thread-a", "thread-b", "thread-c"]);
  assert.equal(result[2].updatedAt, 200);
});

test("new threads are added at the top of the sidebar order", () => {
  const threads = [thread("thread-a", 100), thread("thread-b", 90)];

  const result = upsertThread(threads, thread("thread-c", 80));

  assert.deepEqual(Array.from(result, (item) => item.id), ["thread-c", "thread-a", "thread-b"]);
});

test("backend thread snapshots replace local activity status", () => {
  const running = { ...thread("thread-a", 100), status: { type: "running", activeTurnId: "turn-a", activeFlags: [] } };

  const result = upsertThread([running], thread("thread-a", 120));

  assert.deepEqual(result[0].status, { type: "idle", activeTurnId: null, activeFlags: [] });
});

test("explicit status changes update thread activity", () => {
  const threads = [thread("thread-a", 100), thread("thread-b", 90)];

  const running = markThreadStatus(threads, "thread-b", { type: "running", activeTurnId: "turn-b", activeFlags: [] });
  assert.equal(isThreadRunning(running[1]), true);
  assert.equal(running[1].status.activeTurnId, "turn-b");

  const idle = markThreadStatus(running, "thread-b", { type: "idle", activeTurnId: null, activeFlags: [] });
  assert.equal(isThreadRunning(idle[1]), false);
  assert.equal(idle[1].status.activeTurnId, null);
});

test("working indicator follows active thread work without covering waits", () => {
  const running = { ...thread("thread-a", 100), status: { type: "running", activeTurnId: "turn-a", activeFlags: [] } };
  const waiting = { ...running, status: { type: "running", activeTurnId: "turn-a", activeFlags: ["approvalRequired"] } };
  const streamingAssistantMessages = [{ id: "message-1", role: "assistant", text: "Hello", status: "streaming" }];
  const streamingToolMessages = [{ id: "tool-1", role: "tool", text: "Reading", status: "streaming" }];
  const staleAssistantStreamWithLaterTool = [
    { id: "message-1", turnId: "turn-a", role: "assistant", text: "Thinking", status: "streaming" },
    { id: "tool-1", turnId: "turn-a", role: "tool", text: "Read src", status: "complete" },
  ];

  assert.equal(shouldShowThreadWorkingIndicator(running, 0, []), true);
  assert.equal(shouldShowThreadWorkingIndicator(running, 0, streamingToolMessages), true);
  assert.equal(shouldShowThreadWorkingIndicator(running, 0, streamingAssistantMessages), false);
  assert.equal(shouldShowThreadWorkingIndicator(running, 0, staleAssistantStreamWithLaterTool), true);
  assert.equal(shouldShowThreadWorkingIndicator(running, 1, []), false);
  assert.equal(shouldShowThreadWorkingIndicator(waiting, 0, []), false);
  assert.equal(shouldShowThreadWorkingIndicator(thread("thread-b", 90), 0, []), false);
});

test("typed item events project into stable reasoning and final message items", () => {
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
      itemId: "turn-a-agent-final_answer",
      delta: { type: "agentMessageText", delta: "done", phase: "final_answer" },
    },
  });

  const items = current.turns[0].items;
  assert.equal(items.length, 2);
  assert.equal(items[0].type, "reasoning");
  assert.deepEqual(Array.from(items[0].content), ["thinking"]);
  assert.equal(items[1].type, "agentMessage");
  assert.equal(items[1].text, "done");

  const messages = messagesFromThread(current);
  assert.deepEqual(plain(messages.map((message) => [message.id, message.text, message.phase])), [
    ["turn-a-agent-reasoning", "thinking", "reasoning"],
    ["turn-a-agent-final_answer", "done", "final_answer"],
  ]);
});

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

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
const { isThreadRunning, markThreadStatus, shouldShowThreadWorkingIndicator, upsertThread } = module.exports;

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

  assert.equal(shouldShowThreadWorkingIndicator(running, 0, []), true);
  assert.equal(shouldShowThreadWorkingIndicator(running, 0, streamingToolMessages), true);
  assert.equal(shouldShowThreadWorkingIndicator(running, 0, streamingAssistantMessages), false);
  assert.equal(shouldShowThreadWorkingIndicator(running, 1, []), false);
  assert.equal(shouldShowThreadWorkingIndicator(waiting, 0, []), false);
  assert.equal(shouldShowThreadWorkingIndicator(thread("thread-b", 90), 0, []), false);
});

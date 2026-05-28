import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const helperSource = readFileSync(new URL("../src/lib/roder-wait-requests.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2023,
  },
}).outputText;

const module = { exports: {} };
new Script(compiled).runInNewContext({ exports: module.exports, module });
const { reducePendingWaitRequests, shouldDisplayStartedItem, waitRequestsForThread } = module.exports;

test("approval requests are stored by thread and removed by resolution", () => {
  const requested = reducePendingWaitRequests({}, {
    method: "thread/approvalRequested",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      approvalId: "approval-1",
      toolId: "tool-1",
      toolName: "shell",
      reason: "shell commands require approval",
    },
  }, "");

  assert.deepEqual(plain(waitRequestsForThread(requested, "thread-1")), [{
    kind: "approval",
    id: "approval-1",
    approvalId: "approval-1",
    threadId: "thread-1",
    turnId: "turn-1",
    toolId: "tool-1",
    toolName: "shell",
    reason: "shell commands require approval",
  }]);

  const resolved = reducePendingWaitRequests(requested, {
    method: "thread/approvalResolved",
    params: {
      threadId: "thread-1",
      approvalId: "approval-1",
      approved: true,
    },
  }, "");

  assert.deepEqual(plain(waitRequestsForThread(resolved, "thread-1")), []);
});

test("user input requests keep questions and turn completion clears stale waits", () => {
  const requested = reducePendingWaitRequests({}, {
    method: "thread/userInputRequested",
    params: {
      threadId: "thread-2",
      turnId: "turn-2",
      requestId: "input-1",
      questions: [
        {
          id: "mode",
          question: "Which mode?",
          options: [
            { label: "Default", description: "Continue in default mode." },
            { label: "Plan", description: "Stay in planning mode." },
          ],
        },
      ],
    },
  }, "");

  assert.deepEqual(plain(waitRequestsForThread(requested, "thread-2")), [{
    kind: "userInput",
    id: "input-1",
    requestId: "input-1",
    threadId: "thread-2",
    turnId: "turn-2",
    questions: [
      {
        id: "mode",
        question: "Which mode?",
        options: [
          { label: "Default", description: "Continue in default mode." },
          { label: "Plan", description: "Stay in planning mode." },
        ],
      },
    ],
  }]);

  const completed = reducePendingWaitRequests(requested, {
    method: "turn/completed",
    params: {
      threadId: "thread-2",
      turn: { id: "turn-2", status: "completed" },
    },
  }, "");

  assert.deepEqual(plain(waitRequestsForThread(completed, "thread-2")), []);
});

test("plan exit requests are stored and removed by resolution", () => {
  const requested = reducePendingWaitRequests({}, {
    method: "thread/planExitRequested",
    params: {
      threadId: "thread-3",
      turnId: "turn-3",
      requestId: "plan-exit-1",
      targetMode: "default",
      planSummary: "Implement approved edits",
    },
  }, "");

  assert.deepEqual(plain(waitRequestsForThread(requested, "thread-3")), [{
    kind: "planExit",
    id: "plan-exit-1",
    requestId: "plan-exit-1",
    threadId: "thread-3",
    turnId: "turn-3",
    targetMode: "default",
    planSummary: "Implement approved edits",
  }]);

  const resolved = reducePendingWaitRequests(requested, {
    method: "thread/planExitResolved",
    params: {
      threadId: "thread-3",
      requestId: "plan-exit-1",
      approved: true,
    },
  }, "");

  assert.deepEqual(plain(waitRequestsForThread(resolved, "thread-3")), []);
});

test("missing thread wait requests reuse a stable empty array", () => {
  const first = waitRequestsForThread({}, "missing-thread");
  const second = waitRequestsForThread({}, "missing-thread");

  assert.equal(first, second);
});

test("item started filtering accepts only typed assistant and tool execution items", () => {
  assert.equal(shouldDisplayStartedItem({ type: "agentMessage" }), true);
  assert.equal(shouldDisplayStartedItem({ type: "toolExecution" }), true);
  assert.equal(shouldDisplayStartedItem({ type: "tool.started" }), false);
  assert.equal(shouldDisplayStartedItem({ type: "toolCall" }), false);
  assert.equal(shouldDisplayStartedItem({ type: "userMessage" }), false);
});

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

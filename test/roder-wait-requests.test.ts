import { expect, test } from "vitest";
import {
  reducePendingWaitRequests,
  shouldDisplayStartedItem,
  waitRequestsForThread,
} from "../src/lib/roder-wait-requests";

test("approval requests are stored by thread and removed by resolution", () => {
  const requested = reducePendingWaitRequests(
    {},
    {
      method: "thread/approvalRequested",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        approvalId: "approval-1",
        toolId: "tool-1",
        toolName: "shell",
        reason: "shell commands require approval",
      },
    },
    "",
  );

  expect(plain(waitRequestsForThread(requested, "thread-1"))).toEqual([
    {
      kind: "approval",
      id: "approval-1",
      approvalId: "approval-1",
      threadId: "thread-1",
      turnId: "turn-1",
      toolId: "tool-1",
      toolName: "shell",
      reason: "shell commands require approval",
    },
  ]);

  const resolved = reducePendingWaitRequests(
    requested,
    {
      method: "thread/approvalResolved",
      params: {
        threadId: "thread-1",
        approvalId: "approval-1",
        approved: true,
      },
    },
    "",
  );

  expect(plain(waitRequestsForThread(resolved, "thread-1"))).toEqual([]);
});

test("user input requests keep questions and turn completion clears stale waits", () => {
  const requested = reducePendingWaitRequests(
    {},
    {
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
    },
    "",
  );

  expect(plain(waitRequestsForThread(requested, "thread-2"))).toEqual([
    {
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
    },
  ]);

  const completed = reducePendingWaitRequests(
    requested,
    {
      method: "turn/completed",
      params: {
        threadId: "thread-2",
        turn: { id: "turn-2", status: "completed" },
      },
    },
    "",
  );

  expect(plain(waitRequestsForThread(completed, "thread-2"))).toEqual([]);
});

test("plan exit requests are stored and removed by resolution", () => {
  const requested = reducePendingWaitRequests(
    {},
    {
      method: "thread/planExitRequested",
      params: {
        threadId: "thread-3",
        turnId: "turn-3",
        requestId: "plan-exit-1",
        targetMode: "default",
        planSummary: "Implement approved edits",
      },
    },
    "",
  );

  expect(plain(waitRequestsForThread(requested, "thread-3"))).toEqual([
    {
      kind: "planExit",
      id: "plan-exit-1",
      requestId: "plan-exit-1",
      threadId: "thread-3",
      turnId: "turn-3",
      targetMode: "default",
      planSummary: "Implement approved edits",
    },
  ]);

  const resolved = reducePendingWaitRequests(
    requested,
    {
      method: "thread/planExitResolved",
      params: {
        threadId: "thread-3",
        requestId: "plan-exit-1",
        approved: true,
      },
    },
    "",
  );

  expect(plain(waitRequestsForThread(resolved, "thread-3"))).toEqual([]);
});

test("missing thread wait requests reuse a stable empty array", () => {
  const first = waitRequestsForThread({}, "missing-thread");
  const second = waitRequestsForThread({}, "missing-thread");

  expect(first).toBe(second);
});

test("item started filtering accepts only typed assistant and tool execution items", () => {
  expect(shouldDisplayStartedItem({ type: "agentMessage" })).toBe(true);
  expect(shouldDisplayStartedItem({ type: "toolExecution" })).toBe(true);
  expect(shouldDisplayStartedItem({ type: "tool.started" })).toBe(false);
  expect(shouldDisplayStartedItem({ type: "toolCall" })).toBe(false);
  expect(shouldDisplayStartedItem({ type: "userMessage" })).toBe(false);
});

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

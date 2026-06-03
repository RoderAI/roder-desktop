import { expect, test } from "vitest";
import {
  formatAgentsOutput,
  formatProcessesOutput,
  formatTasksOutput,
  processStateLabel,
} from "../src/lib/native-command-formatters";
import type { ProcessDescriptor, TaskHandle } from "../src/types/roder";

test("formats empty agent list as compact output", () => {
  expect(formatAgentsOutput([])).toEqual({
    title: "No configured subagents.",
    tone: "info",
    body: undefined,
  });
});

test("formats agents with model metadata", () => {
  expect(
    formatAgentsOutput([
      {
        agent_type: "reviewer",
        description: "Review code",
        tools: ["Read"],
        model: "gpt-5.5",
        permission_mode: "default",
        max_turns: null,
        max_result_chars: null,
      },
    ]),
  ).toMatchObject({
    title: "Configured subagents",
    rows: [{ title: "reviewer", detail: "Review code", meta: "gpt-5.5" }],
  });
});

test("formats background tasks", () => {
  expect(formatTasksOutput([task({ task_id: "task-1234567890", state: "running" })])).toMatchObject({
    title: "Background tasks",
    rows: [{ title: "task-1234567", detail: "executor-1 - demo", meta: "running" }],
  });
});

test("formats process summaries and states", () => {
  expect(processStateLabel({ exited: { exitCode: 0 } })).toBe("exited 0");
  expect(processStateLabel({ failed: { error: "boom" } })).toBe("failed");
  expect(formatProcessesOutput([process({ processId: "proc-1234567890", state: "running" })])).toMatchObject({
    title: "Roder-owned processes",
    rows: [{ title: "proc-1234567", detail: "pnpm test - /workspace - stoppable", meta: "running" }],
  });
});

function task(patch: Partial<TaskHandle>): TaskHandle {
  return {
    task_id: patch.task_id ?? "task-1",
    executor_id: patch.executor_id ?? "executor-1",
    spec: patch.spec ?? {
      kind: "demo",
      description: "Demo task",
      input_schema: {},
      metadata: {},
    },
    state: patch.state ?? "queued",
    created_at: patch.created_at ?? "2026-06-03T10:00:00Z",
    started_at: patch.started_at ?? null,
    finished_at: patch.finished_at ?? null,
  };
}

function process(patch: Partial<ProcessDescriptor>): ProcessDescriptor {
  return {
    processId: patch.processId ?? "proc-1",
    origin: patch.origin ?? "command_exec",
    state: patch.state ?? "running",
    command: patch.command ?? ["pnpm", "test"],
    commandSummary: patch.commandSummary ?? "pnpm test",
    cwd: patch.cwd ?? "/workspace",
    pid: patch.pid ?? 123,
    taskId: patch.taskId ?? null,
    threadId: patch.threadId ?? null,
    turnId: patch.turnId ?? null,
    runnerDestinationId: patch.runnerDestinationId ?? null,
    runnerSessionId: patch.runnerSessionId ?? null,
    stoppable: patch.stoppable ?? true,
    startedAt: patch.startedAt ?? "2026-06-03T10:00:00Z",
    updatedAt: patch.updatedAt ?? "2026-06-03T10:01:00Z",
    stdoutTail: patch.stdoutTail ?? null,
    stderrTail: patch.stderrTail ?? null,
  };
}

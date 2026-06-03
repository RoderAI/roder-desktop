import { expect, test, vi } from "vitest";
import { runNativeCommandInvocation, type NativeCommandRouterActions } from "../src/lib/native-command-router";
import type { NativeCommandOutput } from "../src/lib/native-command-formatters";
import type {
  AgentsListResult,
  ProcessesListResult,
  ProcessesStopAllResult,
  ProcessesStopResult,
  TasksListResult,
} from "../src/types/roder";

test("opens the native model picker without command output", async () => {
  const calls: string[] = [];
  const { actions, outputs } = commandActions(calls);

  const handled = await runNativeCommandInvocation({
    actions,
    invocation: { name: "model", arguments: "" },
    ipc: commandIpc(),
    state: commandState(),
  });

  expect(handled).toBe(true);
  expect(calls).toEqual(["clear-output", "open-model-picker"]);
  expect(outputs).toEqual([null]);
});

test("selects a model without success output", async () => {
  const calls: string[] = [];
  const { actions, outputs } = commandActions(calls);

  await runNativeCommandInvocation({
    actions,
    invocation: { name: "model", arguments: "gpt-5.5" },
    ipc: commandIpc(),
    state: commandState(),
  });

  expect(calls).toEqual(["close-model-picker", "select-model:openai:gpt-5.5", "clear-output"]);
  expect(outputs).toEqual([null]);
});

test("clear stores a local transcript offset without mutating messages", async () => {
  const calls: string[] = [];
  const { actions, offsets } = commandActions(calls);

  await runNativeCommandInvocation({
    actions,
    invocation: { name: "clear", arguments: "" },
    ipc: commandIpc(),
    state: commandState({ activeThreadId: "thread-1" }),
  });

  expect(calls).toEqual(["close-model-picker", "clear-output", "offset:thread-1:2"]);
  expect(offsets).toEqual([{ threadId: "thread-1", hiddenMessageCount: 2 }]);
});

test("retry resubmits the latest user message without status output", async () => {
  const calls: string[] = [];
  const { actions, outputs } = commandActions(calls);

  await runNativeCommandInvocation({
    actions,
    invocation: { name: "retry", arguments: "" },
    ipc: commandIpc(),
    state: commandState(),
  });

  expect(calls).toEqual(["close-model-picker", "clear-output", "send:second"]);
  expect(outputs).toEqual([null]);
});

test("agents command formats app-server output rows", async () => {
  const calls: string[] = [];
  const { actions, outputs } = commandActions(calls);

  await runNativeCommandInvocation({
    actions,
    invocation: { name: "agents", arguments: "" },
    ipc: commandIpc({
      listAgents: async () => ({
        agents: [
          {
            agent_type: "reviewer",
            description: "Review code",
            tools: [],
            model: "gpt-5.5",
            permission_mode: "default",
            max_turns: null,
            max_result_chars: null,
          },
        ],
      }),
    }),
    state: commandState(),
  });

  expect(calls).toEqual(["close-model-picker", "output:Configured subagents"]);
  expect(outputs[0]).toMatchObject({ title: "Configured subagents", rows: [{ title: "reviewer" }] });
});

function commandState(patch: Partial<Parameters<typeof runNativeCommandInvocation>[0]["state"]> = {}) {
  return {
    activeThreadBusy: false,
    activeThreadId: "thread-1",
    messages: [
      { id: "message-1", role: "user", text: "first", status: "complete" },
      { id: "message-2", role: "user", text: "second", status: "complete" },
    ],
    models: [{ id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai" }],
    ...patch,
  };
}

function commandActions(calls: string[]) {
  const outputs: Array<NativeCommandOutput | null> = [];
  const offsets: Array<{ threadId: string; hiddenMessageCount: number }> = [];
  const actions: NativeCommandRouterActions = {
    closeModelPicker: () => calls.push("close-model-picker"),
    openModelPicker: () => calls.push("open-model-picker"),
    sendPrompt: vi.fn<NativeCommandRouterActions["sendPrompt"]>(async (prompt) => {
      calls.push(`send:${prompt}`);
    }),
    setCommandOutput: (output) => {
      outputs.push(output);
      calls.push(output ? `output:${output.title}` : "clear-output");
    },
    setLocalTranscriptOffset: (offset) => {
      offsets.push(offset);
      calls.push(`offset:${offset.threadId}:${offset.hiddenMessageCount}`);
    },
    setSelectedModel: (modelId, modelProvider) => calls.push(`select-model:${modelProvider}:${modelId}`),
  };
  return { actions, offsets, outputs };
}

function commandIpc(
  patch: Partial<{
    listAgents: () => Promise<AgentsListResult>;
    listTasks: () => Promise<TasksListResult>;
    listProcesses: (includeCompleted?: boolean) => Promise<ProcessesListResult>;
    stopProcess: (processId: string, reason?: string) => Promise<ProcessesStopResult>;
    stopAllProcesses: (reason?: string) => Promise<ProcessesStopAllResult>;
  }> = {},
) {
  return {
    listAgents: async () => ({ agents: [] }),
    listTasks: async () => ({ tasks: [] }),
    listProcesses: async () => ({ processes: [] }),
    stopProcess: async (processId: string) => ({ result: { processId, stopped: true } }),
    stopAllProcesses: async () => ({ results: [] }),
    ...patch,
  };
}

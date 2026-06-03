import { nativeCommandInvocation, planNativeCommand } from "@/lib/native-commands";
import {
  errorOutput,
  formatAgentsOutput,
  formatProcessesOutput,
  formatTasksOutput,
  successOutput,
  type NativeCommandOutput,
} from "@/lib/native-command-formatters";
import type { CommandInvocation } from "@/lib/roder-commands";
import type {
  AgentsListResult,
  ConversationMessage,
  DesktopAttachment,
  ProcessesListResult,
  ProcessesStopAllResult,
  ProcessesStopResult,
  RoderModel,
  TasksListResult,
} from "@/types/roder";

export type LocalTranscriptOffset = {
  threadId: string;
  hiddenMessageCount: number;
};

export type NativeCommandRouterState = {
  activeThreadBusy: boolean;
  activeThreadId: string;
  messages: ConversationMessage[];
  models: RoderModel[];
};

export type NativeCommandRouterActions = {
  closeModelPicker: () => void;
  openModelPicker: () => void;
  sendPrompt: (prompt: string, attachments: DesktopAttachment[]) => Promise<void>;
  setCommandOutput: (output: NativeCommandOutput | null) => void;
  setLocalTranscriptOffset: (offset: LocalTranscriptOffset) => void;
  setSelectedModel: (modelId: string, modelProvider?: string) => void;
};

export type NativeCommandRouterIpc = {
  listAgents: () => Promise<AgentsListResult>;
  listTasks: () => Promise<TasksListResult>;
  listProcesses: (includeCompleted?: boolean) => Promise<ProcessesListResult>;
  stopProcess: (processId: string, reason?: string) => Promise<ProcessesStopResult>;
  stopAllProcesses: (reason?: string) => Promise<ProcessesStopAllResult>;
};

export async function runNativeCommandInvocation({
  actions,
  invocation,
  ipc,
  state,
}: {
  actions: NativeCommandRouterActions;
  invocation: CommandInvocation;
  ipc: NativeCommandRouterIpc;
  state: NativeCommandRouterState;
}): Promise<boolean> {
  const nativeInvocation = nativeCommandInvocation(invocation.name, invocation.arguments);
  if (!nativeInvocation) {
    return false;
  }

  try {
    const result = planNativeCommand(nativeInvocation, state.models);
    if (result.type === "output") {
      actions.closeModelPicker();
      actions.setCommandOutput(result.output);
      return true;
    }
    if (result.type === "openModelPicker") {
      actions.setCommandOutput(null);
      actions.openModelPicker();
      return true;
    }
    if (result.type === "selectModel") {
      actions.closeModelPicker();
      actions.setSelectedModel(result.modelId, result.modelProvider);
      actions.setCommandOutput(null);
      return true;
    }
    if (result.type === "clear") {
      actions.closeModelPicker();
      actions.setCommandOutput(null);
      actions.setLocalTranscriptOffset({
        threadId: state.activeThreadId || "new-thread",
        hiddenMessageCount: state.messages.length,
      });
      return true;
    }
    if (result.type === "retry") {
      actions.closeModelPicker();
      if (state.activeThreadBusy) {
        actions.setCommandOutput(errorOutput("Retry unavailable", "Wait for the current run to finish first."));
        return true;
      }
      const lastUserMessage = [...state.messages]
        .reverse()
        .find((message) => message.role === "user" && message.text.trim());
      if (!lastUserMessage) {
        actions.setCommandOutput(errorOutput("Nothing to retry yet."));
        return true;
      }
      actions.setCommandOutput(null);
      await actions.sendPrompt(lastUserMessage.text, []);
      return true;
    }
    if (result.type === "agents") {
      actions.closeModelPicker();
      actions.setCommandOutput(formatAgentsOutput((await ipc.listAgents()).agents));
      return true;
    }
    if (result.type === "tasks") {
      actions.closeModelPicker();
      actions.setCommandOutput(formatTasksOutput((await ipc.listTasks()).tasks));
      return true;
    }
    if (result.type === "processes") {
      actions.closeModelPicker();
      actions.setCommandOutput(formatProcessesOutput((await ipc.listProcesses(result.includeCompleted)).processes));
      return true;
    }
    if (result.type === "stopProcess") {
      actions.closeModelPicker();
      const stopped = await ipc.stopProcess(result.processId, "Stopped from desktop slash command");
      actions.setCommandOutput(
        stopped.result.stopped
          ? successOutput("Process stopped", result.processId)
          : errorOutput("Process was not stopped", result.processId),
      );
      return true;
    }
    if (result.type === "stopAllProcesses") {
      actions.closeModelPicker();
      const stopped = await ipc.stopAllProcesses("Stopped from desktop slash command");
      const count = stopped.results.filter((item) => item.stopped).length;
      actions.setCommandOutput(successOutput("Processes stopped", `${count} stopped.`));
      return true;
    }
  } catch (error) {
    actions.closeModelPicker();
    actions.setCommandOutput(errorOutput("Command failed", errorMessage(error)));
    return true;
  }

  return true;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : "Something went wrong";
}

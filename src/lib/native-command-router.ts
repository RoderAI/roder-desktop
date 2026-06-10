import { nativeCommandInvocation, planNativeCommand } from "@/lib/native-commands";
import { errorMessage } from "@/lib/error-message";
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
  setSelectedModel: (modelId: string, modelProvider?: string) => void | Promise<void>;
};

export type NativeCommandRouterIpc = {
  createGoal: (threadId: string, objective: string) => Promise<{ text: string; data: unknown; is_error: boolean }>;
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
    actions.closeModelPicker();

    switch (result.type) {
      case "output":
        actions.setCommandOutput(result.output);
        return true;
      case "openModelPicker":
        actions.setCommandOutput(null);
        actions.openModelPicker();
        return true;
      case "selectModel":
        void actions.setSelectedModel(result.modelId, result.modelProvider);
        actions.setCommandOutput(null);
        return true;
      case "clear":
        actions.setCommandOutput(null);
        actions.setLocalTranscriptOffset({
          threadId: state.activeThreadId || "new-thread",
          hiddenMessageCount: state.messages.length,
        });
        return true;
      case "retry": {
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
      case "agents":
        actions.setCommandOutput(formatAgentsOutput((await ipc.listAgents()).agents));
        return true;
      case "tasks":
        actions.setCommandOutput(formatTasksOutput((await ipc.listTasks()).tasks));
        return true;
      case "goal": {
        if (!state.activeThreadId) {
          actions.setCommandOutput(errorOutput("No active thread", "Start a thread before setting a goal."));
          return true;
        }
        const created = await ipc.createGoal(state.activeThreadId, result.objective);
        actions.setCommandOutput(
          created.is_error
            ? errorOutput("Goal not set", created.text || "The app-server rejected the goal update.")
            : successOutput("Goal set", result.objective),
        );
        return true;
      }
      case "processes":
        actions.setCommandOutput(formatProcessesOutput((await ipc.listProcesses(result.includeCompleted)).processes));
        return true;
      case "stopProcess": {
        const stopped = await ipc.stopProcess(result.processId, "Stopped from desktop slash command");
        actions.setCommandOutput(
          stopped.result.stopped
            ? successOutput("Process stopped", result.processId)
            : errorOutput("Process was not stopped", result.processId),
        );
        return true;
      }
      case "stopAllProcesses": {
        const stopped = await ipc.stopAllProcesses("Stopped from desktop slash command");
        const count = stopped.results.filter((item) => item.stopped).length;
        actions.setCommandOutput(
          count > 0
            ? successOutput("Processes stopped", `${count} stopped.`)
            : errorOutput("No processes stopped", "No running processes matched."),
        );
        return true;
      }
      default: {
        const exhaustive: never = result;
        return exhaustive;
      }
    }
  } catch (error) {
    actions.closeModelPicker();
    actions.setCommandOutput(errorOutput("Command failed", errorMessage(error)));
    return true;
  }
}

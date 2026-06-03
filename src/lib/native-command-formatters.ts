import type { AgentDescriptor, ProcessDescriptor, TaskHandle } from "@/types/roder";

export type NativeCommandOutputTone = "info" | "success" | "warning" | "error";

export type NativeCommandOutputRow = {
  id: string;
  title: string;
  detail?: string;
  meta?: string;
};

export type NativeCommandOutput = {
  title: string;
  body?: string;
  tone: NativeCommandOutputTone;
  rows?: NativeCommandOutputRow[];
};

export function infoOutput(title: string, body?: string): NativeCommandOutput {
  return { title, body, tone: "info" };
}

export function successOutput(title: string, body?: string): NativeCommandOutput {
  return { title, body, tone: "success" };
}

export function warningOutput(title: string, body?: string): NativeCommandOutput {
  return { title, body, tone: "warning" };
}

export function errorOutput(title: string, body?: string): NativeCommandOutput {
  return { title, body, tone: "error" };
}

export function formatAgentsOutput(agents: AgentDescriptor[]): NativeCommandOutput {
  if (agents.length === 0) {
    return infoOutput("No configured subagents.");
  }
  return {
    title: "Configured subagents",
    tone: "info",
    rows: agents.map((agent) => ({
      id: agent.agent_type,
      title: agent.agent_type,
      detail: agent.description,
      meta: agent.model ?? undefined,
    })),
  };
}

export function formatTasksOutput(tasks: TaskHandle[]): NativeCommandOutput {
  if (tasks.length === 0) {
    return infoOutput("No background tasks.");
  }
  return {
    title: "Background tasks",
    tone: "info",
    rows: tasks.map((task) => ({
      id: task.task_id,
      title: shortId(task.task_id),
      detail: `${task.executor_id} - ${task.spec.kind}`,
      meta: task.state,
    })),
  };
}

export function formatProcessesOutput(processes: ProcessDescriptor[]): NativeCommandOutput {
  if (processes.length === 0) {
    return infoOutput("No Roder-owned processes.");
  }
  return {
    title: "Roder-owned processes",
    tone: "info",
    rows: processes.map((process) => ({
      id: process.processId,
      title: shortId(process.processId),
      detail: processDetail(process),
      meta: processStateLabel(process.state),
    })),
  };
}

export function processStateLabel(state: ProcessDescriptor["state"]): string {
  if (typeof state === "string") {
    return state;
  }
  if ("exited" in state) {
    const exitCode = state.exited.exitCode;
    return typeof exitCode === "number" ? `exited ${exitCode}` : "exited";
  }
  if ("failed" in state) {
    return "failed";
  }
  return "unknown";
}

function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 12) : id;
}

function processDetail(process: ProcessDescriptor): string {
  const parts = [process.commandSummary || process.command.join(" ")];
  if (process.cwd) {
    parts.push(process.cwd);
  }
  parts.push(process.stoppable ? "stoppable" : "not stoppable");
  return parts.join(" - ");
}

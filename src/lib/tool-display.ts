export type ToolGroupKind = "readFile" | "readSkill" | "search";

export type ToolGroupDescriptor = {
  entryKind: "readFileGroup" | "readSkillGroup" | "searchGroup";
  family: "read_file" | "read_skill" | "search";
  kind: ToolGroupKind;
};

const compactSummaryTools = new Set([
  "read_file",
  "read_skill",
  "read_skill_file",
  "list_files",
  "search_files",
  "grep",
  "glob",
  "write_file",
  "edit",
  "multi_edit",
  "apply_patch",
]);

const fileActivityTools = new Set([
  "read_file",
  "read_skill_file",
  "list_files",
  "write_file",
  "edit",
  "multi_edit",
  "apply_patch",
]);

const searchActivityTools = new Set(["glob", "grep", "search_files"]);
const hiddenTranscriptTools = new Set([
  "get_goal",
  "create_goal",
  "update_goal",
  "update_plan",
  "verification_review",
]);

export function compactToolGroup(toolName: string | undefined): ToolGroupDescriptor | null {
  if (toolName === "read_file") {
    return { entryKind: "readFileGroup", family: "read_file", kind: "readFile" };
  }
  if (toolName === "read_skill" || toolName === "read_skill_file") {
    return { entryKind: "readSkillGroup", family: "read_skill", kind: "readSkill" };
  }
  if (searchActivityTools.has(toolName ?? "")) {
    return { entryKind: "searchGroup", family: "search", kind: "search" };
  }
  return null;
}

export function isCommandActivityTool(toolName: string | undefined): boolean {
  return isShellToolName(toolName);
}

export function isExplorationActivityTool(toolName: string | undefined): boolean {
  return (
    isFileActivityTool(toolName) ||
    isSearchActivityTool(toolName) ||
    isCommandActivityTool(toolName) ||
    toolName === "read_skill"
  );
}

export function isFileActivityTool(toolName: string | undefined): boolean {
  return fileActivityTools.has(toolName ?? "");
}

export function isSearchActivityTool(toolName: string | undefined): boolean {
  return searchActivityTools.has(toolName ?? "");
}

export function isHiddenTranscriptTool(toolName: string | undefined): boolean {
  return hiddenTranscriptTools.has(toolName ?? "");
}

export function isShellToolName(toolName: string | undefined): boolean {
  return (
    toolName === "shell" ||
    toolName === "exec_command" ||
    toolName === "write_stdin" ||
    toolName === "command" ||
    toolName === "run_command" ||
    toolName === "process.spawn" ||
    toolName?.includes("shell_command") === true ||
    toolName?.includes("exec_command") === true
  );
}

export function usesSummaryAsToolTitle(toolName: string | undefined): boolean {
  return isShellToolName(toolName) || compactSummaryTools.has(toolName ?? "");
}

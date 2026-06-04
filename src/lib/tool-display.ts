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

export function canonicalToolName(toolName: string | undefined): string | undefined {
  return toolName?.split(".").at(-1);
}

export function compactToolGroup(toolName: string | undefined): ToolGroupDescriptor | null {
  const canonicalName = canonicalToolName(toolName);
  if (canonicalName === "read_file") {
    return { entryKind: "readFileGroup", family: "read_file", kind: "readFile" };
  }
  if (canonicalName === "read_skill" || canonicalName === "read_skill_file") {
    return { entryKind: "readSkillGroup", family: "read_skill", kind: "readSkill" };
  }
  if (searchActivityTools.has(canonicalName ?? "")) {
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
  return fileActivityTools.has(canonicalToolName(toolName) ?? "");
}

export function isSearchActivityTool(toolName: string | undefined): boolean {
  return searchActivityTools.has(canonicalToolName(toolName) ?? "");
}

export function isHiddenTranscriptTool(toolName: string | undefined): boolean {
  return hiddenTranscriptTools.has(canonicalToolName(toolName) ?? "");
}

export function isShellToolName(toolName: string | undefined): boolean {
  const canonicalName = canonicalToolName(toolName);
  return (
    canonicalName === "shell" ||
    canonicalName === "exec_command" ||
    canonicalName === "write_stdin" ||
    canonicalName === "command" ||
    canonicalName === "run_command" ||
    toolName === "process.spawn" ||
    toolName?.includes("shell_command") === true ||
    toolName?.includes("exec_command") === true
  );
}

export function usesSummaryAsToolTitle(toolName: string | undefined): boolean {
  return isShellToolName(toolName) || compactSummaryTools.has(canonicalToolName(toolName) ?? "");
}

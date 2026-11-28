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
  "auto_model_routing",
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
const hiddenTranscriptTools = new Set(["get_goal", "create_goal", "update_goal", "update_plan", "verification_review"]);

export type DescriptiveToolKind = "command" | "read_file" | "edit_file" | "search" | "other";

const NAMESPACED_TOOL_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)+$/u;
const SINGLE_TOOL_IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/u;
const COMMON_FILE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "jsonc",
  "md",
  "mdx",
  "txt",
  "css",
  "scss",
  "less",
  "html",
  "htm",
  "svg",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "rs",
  "py",
  "go",
  "rb",
  "php",
  "sh",
  "bash",
  "zsh",
  "fish",
  "toml",
  "yaml",
  "yml",
  "xml",
  "sql",
  "lock",
  "env",
  "cfg",
  "conf",
  "ini",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "java",
  "kt",
  "swift",
  "diff",
  "patch",
  "log",
  "csv",
  "pdf",
  "wasm",
]);
const DESCRIPTIVE_COMMAND_PREFIX_PATTERN = /^(?:run|running|ran|execute|executing|executed|shell)\s+|\$\s+/iu;
const DESCRIPTIVE_CLI_HEAD_PATTERN =
  /^(?:(?:env|sudo|time|nohup)\s+)*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(?:git|gh|npm|pnpm|yarn|bun|npx|node|tsx|ts-node|python3?|pip3?|uv|pytest|cargo|rustc|go|rg|grep|ag|fd|find|ls|cat|head|tail|sed|awk|wc|sort|uniq|cut|tr|xargs|bash|sh|zsh|curl|wget|docker|kubectl|mise|tsc|vitest|jest|eslint|oxlint|oxfmt|biome|prettier|make|cmake|ninja|cd|mkdir|cp|mv|rm|touch|chmod|echo|printf|test|diff|patch)\b/u;
const DESCRIPTIVE_EDIT_PREFIX_PATTERN =
  /^(?:edit|editing|edited|write|writing|wrote|create|creating|created|update|updating|updated|patch|patching|patched|delete|deleting|deleted|remove|removing|removed|move|moving|moved|replace|replacing|replaced|modify|modifying|modified)\s+/iu;
const DESCRIPTIVE_READ_PREFIX_PATTERN =
  /^(?:read|reading|view|viewing|viewed|open|opening|opened|inspect|inspecting|inspected)\s+/iu;
const DESCRIPTIVE_SEARCH_PREFIX_PATTERN =
  /^(?:search|searching|searched|grep|grepping|find|finding|found|glob|globbing|list|listing|listed)\b/iu;
const BARE_FILE_PATH_PATTERN =
  /^(?:~\/|\/|\.{1,2}\/|[A-Za-z]:[\\/])?[^\s]+(?:[\\/][^\s]+|\.[A-Za-z0-9]{1,8})(?::\d+(?:-\d+)?)?$/u;
const SHELL_OUTPUT_MARKER_PATTERN =
  /(?:^|\n)(?:Command exited with code\s+-?\d+|Command output:|exit_code=-?\d+|Exit code:\s*-?\d+)/im;

export function canonicalToolName(toolName: string | undefined): string | undefined {
  if (!toolName) {
    return undefined;
  }
  const trimmed = toolName.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed === "Read") return "read_file";
  if (NAMESPACED_TOOL_IDENTIFIER_PATTERN.test(trimmed)) {
    const tail = trimmed.split(".").at(-1);
    if (tail && !COMMON_FILE_EXTENSIONS.has(tail.toLowerCase())) {
      return tail;
    }
  }
  return trimmed;
}

export function isIdentifierToolName(toolName: string | undefined): boolean {
  const canonicalName = canonicalToolName(toolName);
  return Boolean(canonicalName && SINGLE_TOOL_IDENTIFIER_PATTERN.test(canonicalName));
}

export function isDescriptiveToolName(toolName: string | undefined): boolean {
  const canonicalName = canonicalToolName(toolName);
  return Boolean(canonicalName && !SINGLE_TOOL_IDENTIFIER_PATTERN.test(canonicalName));
}

export function classifyDescriptiveTool(toolName: string | undefined, output?: string): DescriptiveToolKind {
  const trimmed = toolName?.trim() ?? "";
  if (!trimmed) {
    return "other";
  }
  if (output && SHELL_OUTPUT_MARKER_PATTERN.test(output)) {
    return "command";
  }
  if (DESCRIPTIVE_COMMAND_PREFIX_PATTERN.test(trimmed) || DESCRIPTIVE_CLI_HEAD_PATTERN.test(trimmed)) {
    return "command";
  }
  if (DESCRIPTIVE_EDIT_PREFIX_PATTERN.test(trimmed)) {
    return "edit_file";
  }
  if (DESCRIPTIVE_SEARCH_PREFIX_PATTERN.test(trimmed)) {
    return "search";
  }
  if (DESCRIPTIVE_READ_PREFIX_PATTERN.test(trimmed) && !/\bskill$/iu.test(trimmed)) {
    return "read_file";
  }
  if (BARE_FILE_PATH_PATTERN.test(trimmed)) {
    return "read_file";
  }
  return "other";
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
  if (isDescriptiveToolName(toolName)) {
    const kind = classifyDescriptiveTool(toolName);
    if (kind === "read_file") {
      return { entryKind: "readFileGroup", family: "read_file", kind: "readFile" };
    }
    if (kind === "search") {
      return { entryKind: "searchGroup", family: "search", kind: "search" };
    }
  }
  return null;
}

export function isCommandActivityTool(toolName: string | undefined): boolean {
  if (isShellToolName(toolName)) {
    return true;
  }
  return isDescriptiveToolName(toolName) && classifyDescriptiveTool(toolName) === "command";
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
  if (fileActivityTools.has(canonicalToolName(toolName) ?? "")) {
    return true;
  }
  if (isDescriptiveToolName(toolName)) {
    const kind = classifyDescriptiveTool(toolName);
    return kind === "read_file" || kind === "edit_file";
  }
  return false;
}

export function isSearchActivityTool(toolName: string | undefined): boolean {
  if (searchActivityTools.has(canonicalToolName(toolName) ?? "")) {
    return true;
  }
  return isDescriptiveToolName(toolName) && classifyDescriptiveTool(toolName) === "search";
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
  return (
    isShellToolName(toolName) ||
    compactSummaryTools.has(canonicalToolName(toolName) ?? "") ||
    isDescriptiveToolName(toolName)
  );
}

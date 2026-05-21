import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const toolDisplayModule = loadTypescriptModule("../src/lib/tool-display.ts");
const roderThreadModule = loadTypescriptModule("../src/lib/roder-thread.ts", (id) => {
  if (id === "@/lib/tool-display") {
    return toolDisplayModule.exports;
  }
  throw new Error(`Unexpected import: ${id}`);
});
const { messagesFromTurn } = roderThreadModule.exports;

test("read-file tool calls keep a compact completed title from display payload", () => {
  const messages = messagesFromTurn("thread-1", {
    id: "turn-1",
    items: [
      {
        id: "item-tool-started",
        type: "toolCall",
        payload: {
          path: "docs/README.md",
          tool: "read_file",
          tool_call_id: "tool-read-1",
        },
      },
      {
        id: "item-tool-completed",
        text: "# Full file contents\n\nLots of text.",
        type: "toolMessage",
        payload: {
          path: "docs/README.md",
          tool_call_id: "tool-read-1",
        },
      },
    ],
    itemsView: "default",
    status: "completed",
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "tool");
  assert.equal(messages[0].toolName, "read_file");
  assert.equal(messages[0].toolSubject, "README.md");
  assert.equal(messages[0].toolSummary, "Read README.md");
  assert.equal(messages[0].text, "Read README.md");
});

test("read-file tool calls use filenames from top-level payload fields", () => {
  const messages = messagesFromTurn("thread-1", {
    id: "turn-1",
    items: [
      {
        id: "item-tool-completed",
        text: "read file",
        type: "tool.completed",
        payload: {
          path: "src/components/transcript.tsx",
          tool: "read_file",
          tool_call_id: "tool-read-1",
        },
      },
    ],
    itemsView: "default",
    status: "completed",
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].toolSummary, "Read transcript.tsx");
});

test("common tool calls are summarized like compact transcript activity", () => {
  const messages = messagesFromTurn("thread-1", {
    id: "turn-1",
    items: [
      {
        id: "item-list",
        type: "tool.completed",
        payload: {
          path: ".",
          tool: "list_files",
          tool_call_id: "tool-list-1",
        },
      },
      {
        id: "item-search",
        type: "tool.completed",
        payload: {
          query: "ToolTimelineItem",
          path: "src/components",
          tool: "search_files",
          tool_call_id: "tool-search-1",
        },
      },
      {
        id: "item-grep-result-data",
        type: "tool.completed",
        payload: {
          query: "ToolTimelineItem",
          path: "test",
          tool: "grep",
          tool_call_id: "tool-grep-1",
        },
      },
    ],
    itemsView: "default",
    status: "completed",
  });

  assert.deepEqual(plain(messages.map((message) => message.toolSummary)), [
    "Listed files in .",
    'Searched for "ToolTimelineItem" in src/components',
    'Searched for "ToolTimelineItem" in test',
  ]);
  assert.deepEqual(plain(messages.map((message) => message.toolSubject)), [
    ".",
    "ToolTimelineItem in src/components",
    "ToolTimelineItem in test",
  ]);
});

test("list-files tool calls include the listed directory", () => {
  const messages = messagesFromTurn("thread-1", {
    id: "turn-1",
    items: [
      {
        id: "item-list-input",
        type: "tool.completed",
        payload: {
          path: "src/components",
          tool: "list_files",
          tool_call_id: "tool-list-1",
        },
      },
      {
        id: "item-list-reload",
        type: "tool.completed",
        payload: {
          path: "docs",
          tool: "list_files",
          tool_call_id: "tool-list-2",
        },
      },
      {
        id: "item-list-result-data",
        type: "tool.completed",
        payload: {
          path: ".",
          tool: "list_files",
          tool_call_id: "tool-list-3",
        },
      },
    ],
    itemsView: "default",
    status: "completed",
  });

  assert.deepEqual(plain(messages.map((message) => message.toolSummary)), [
    "Listed files in src/components",
    "Listed files in docs",
    "Listed files in .",
  ]);
});

test("skill tool calls are summarized as compact read activity", () => {
  const messages = messagesFromTurn("thread-1", {
    id: "turn-1",
    items: [
      {
        id: "item-skill",
        type: "tool.completed",
        payload: {
          displayName: "ai-sdk",
          name: "ai-sdk",
          tool: "read_skill",
          tool_call_id: "tool-skill-1",
        },
      },
      {
        id: "item-skill-file",
        type: "tool.completed",
        payload: {
          name: "vercel-react-best-practices",
          path: "rules/async-parallel.md",
          tool: "read_skill_file",
          tool_call_id: "tool-skill-file-1",
        },
      },
    ],
    itemsView: "default",
    status: "completed",
  });

  assert.deepEqual(plain(messages.map((message) => message.toolSummary)), [
    "Read ai-sdk Skill",
    "Read vercel-react-best-practices async-parallel.md",
  ]);
});

test("goal and glob tool calls are summarized as plain activity", () => {
  const messages = messagesFromTurn("thread-1", {
    id: "turn-1",
    items: [
      {
        id: "item-goal",
        text: "Goal active: Understand the app.",
        type: "tool.completed",
        payload: {
          tool: "create_goal",
          tool_call_id: "tool-goal-1",
        },
      },
      {
        id: "item-glob",
        type: "tool.completed",
        payload: {
          pattern: "src/**/*.tsx",
          path: ".",
          tool: "glob",
          tool_call_id: "tool-glob-1",
        },
      },
    ],
    itemsView: "default",
    status: "completed",
  });

  assert.deepEqual(plain(messages.map((message) => message.toolSummary)), [
    "Goal active: Understand the app.",
    'Searched for "src/**/*.tsx" in .',
  ]);
});

test("write and edit tools use display payload paths", () => {
  const messages = messagesFromTurn("thread-1", {
    id: "turn-1",
    items: [
      {
        id: "item-write",
        type: "tool.completed",
        payload: {
          path: "src/lib/roder-thread.ts",
          tool: "write_file",
          tool_call_id: "tool-write-1",
        },
      },
      {
        id: "item-edit",
        type: "tool.completed",
        payload: {
          path: "src/components/transcript.tsx",
          tool: "edit",
          tool_call_id: "tool-edit-1",
        },
      },
      {
        id: "item-multi-edit",
        type: "tool.started",
        payload: {
          path: "src/style.css",
          tool: "multi_edit",
          tool_call_id: "tool-edit-2",
        },
      },
      {
        id: "item-patch",
        type: "tool.completed",
        payload: {
          tool: "apply_patch",
          tool_call_id: "tool-patch-1",
        },
      },
    ],
    itemsView: "default",
    status: "completed",
  });

  assert.deepEqual(plain(messages.map((message) => message.toolSummary)), [
    "Wrote roder-thread.ts",
    "Edited transcript.tsx",
    "Editing style.css",
    "Applied patch",
  ]);
});

test("shell tools summarize the command and keep input and output details", () => {
  const messages = messagesFromTurn("thread-1", {
    id: "turn-1",
    items: [
      {
        id: "item-shell-started",
        type: "tool.started",
        payload: {
          command: "pwd",
          tool: "shell",
          tool_call_id: "tool-shell-1",
        },
      },
      {
        id: "item-shell-completed",
        text: "/Users/jonathan/project\n",
        type: "tool.completed",
        payload: {
          command: "pwd",
          tool: "shell",
          tool_call_id: "tool-shell-1",
        },
      },
      {
        id: "item-exec-started",
        type: "tool.started",
        payload: {
          cmd: "pnpm test",
          tool: "exec_command",
          tool_call_id: "tool-exec-1",
        },
      },
    ],
    itemsView: "default",
    status: "completed",
  });

  assert.equal(messages.length, 2);
  assert.equal(messages[0].toolSummary, "Ran pwd");
  assert.equal(messages[0].text, "Ran pwd");
  assert.equal(messages[0].toolInput, "pwd");
  assert.equal(messages[0].toolOutput, "/Users/jonathan/project\n");
  assert.equal(messages[0].toolSubject, "pwd");
  assert.equal(messages[1].toolSummary, "Running pnpm test");
  assert.equal(messages[1].toolInput, "pnpm test");
  assert.equal(messages[1].toolSubject, "pnpm test");
});

test("shell tools stay hidden before the command arrives", () => {
  const messages = messagesFromTurn("thread-1", {
    id: "turn-1",
    items: [
      {
        id: "item-exec-started",
        type: "tool.started",
        payload: {
          tool: "exec_command",
          tool_call_id: "tool-exec-1",
        },
      },
    ],
    itemsView: "default",
    status: "running",
  });

  assert.equal(messages.length, 0);
});

test("completed generic shell results keep the running command summary", () => {
  const messages = messagesFromTurn("thread-1", {
    id: "turn-1",
    items: [
      {
        id: "item-shell-started",
        type: "tool.started",
        payload: {
          command: "git status",
          tool: "shell",
          tool_call_id: "tool-shell-1",
        },
      },
      {
        id: "item-shell-result",
        text: "On branch main\nStatus: completed\nWall time: 1.002 seconds\n",
        type: "toolMessage",
        payload: {
          tool_call_id: "tool-shell-1",
        },
      },
    ],
    itemsView: "default",
    status: "completed",
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].toolName, "shell");
  assert.equal(messages[0].toolSummary, "Ran git status");
  assert.equal(messages[0].toolInput, "git status");
  assert.equal(messages[0].toolOutput, "On branch main\n");
});

test("shell tool output hides command runner metadata", () => {
  const messages = messagesFromTurn("thread-1", {
    id: "turn-1",
    items: [
      {
        id: "item-shell-started",
        type: "tool.started",
        payload: {
          command: "pwd",
          tool: "shell",
          tool_call_id: "tool-shell-1",
        },
      },
      {
        id: "item-shell-result",
        text: "Exit code: 0\nWall time: 0.060 seconds\nOutput:\n/Users/jonathandavies/Developer/gode/gode-desktop\n",
        type: "toolMessage",
        payload: {
          tool_call_id: "tool-shell-1",
        },
      },
    ],
    itemsView: "default",
    status: "completed",
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].toolOutput, "/Users/jonathandavies/Developer/gode/gode-desktop\n");
});

test("failed tool calls keep contract display context", () => {
  const messages = messagesFromTurn("thread-1", {
    id: "turn-1",
    items: [
      {
        id: "item-read-failed",
        status: "failed",
        text: "path does not exist",
        type: "toolMessage",
        toolName: "read_file",
        toolCallId: "tool-read-1",
        payload: {
          path: "src/missing.ts",
        },
      },
      {
        id: "item-search-failed",
        status: "failed",
        text: "search failed",
        type: "toolMessage",
        toolName: "grep",
        toolCallId: "tool-grep-1",
        payload: {
          query: "needle",
          path: "src",
        },
      },
      {
        id: "item-write-failed",
        status: "failed",
        text: "permission denied",
        type: "toolMessage",
        toolName: "write_file",
        toolCallId: "tool-write-1",
        payload: {
          path: "src/protected.ts",
        },
      },
    ],
    itemsView: "default",
    status: "completed",
  });

  assert.deepEqual(plain(messages.map((message) => message.toolSummary)), [
    "Failed to read missing.ts",
    'Failed to search for "needle" in src',
    "Failed to write protected.ts",
  ]);
});

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadTypescriptModule(path, requireFn = () => ({})) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
    },
  }).outputText;
  const module = { exports: {} };
  new Script(compiled).runInNewContext({ exports: module.exports, module, require: requireFn });
  return module;
}

import { expect, test } from "vitest";
import { messagesFromThread, messagesFromTurn } from "../src/lib/roder-thread";

test("typed reasoning items are kept out of visible transcript messages", () => {
  const messages = messagesFromTurn(
    "thread-1",
    turn(
      [
        {
          id: "turn-1-agent-reasoning",
          type: "reasoning",
          summary: ["Inspecting project"],
          content: ["Checking the saved context."],
        },
      ],
      "completed",
    ),
  );

  expect(plain(messages)).toEqual([]);
});

test("commentary phase agent messages hydrate as visible update messages", () => {
  const messages = messagesFromTurn(
    "thread-1",
    turn(
      [
        {
          id: "turn-1-agent-commentary",
          type: "agentMessage",
          text: "I will inspect the transcript first.",
          phase: "commentary",
          status: "completed",
        },
      ],
      "completed",
    ),
  );

  expect(plain(messages)).toEqual([
    {
      id: "turn-1-agent-commentary:commentary",
      threadId: "thread-1",
      turnId: "turn-1",
      role: "assistant",
      text: "I will inspect the transcript first.",
      phase: "commentary",
      status: "complete",
    },
  ]);
});

test("thread snapshots derive messages from canonical typed items only", () => {
  const messages = messagesFromThread({
    id: "thread-1",
    turns: [
      turn(
        [
          { id: "turn-1-user", text: "can you implement a new design?", type: "userMessage" },
          tool("tool-read-1", "read_file", { path: "app.css" }, "completed", "# app css"),
          { id: "turn-1-agent-reasoning", type: "reasoning", content: ["Inspecting styles"], status: "inProgress" },
          {
            id: "turn-1-agent-commentary",
            type: "agentMessage",
            text: "I will check the style path.",
            phase: "commentary",
            status: "completed",
          },
          {
            id: "turn-1-agent-final_answer",
            type: "agentMessage",
            text: "Done",
            phase: "final_answer",
            status: "completed",
          },
        ],
        "inProgress",
      ),
    ],
    status: { type: "running", activeTurnId: "turn-1", activeFlags: [] },
  });

  expect(plain(messages.map(({ id, role, text, phase, status }) => ({ id, role, text, phase, status })))).toEqual([
    { id: "turn-1-user", role: "user", text: "can you implement a new design?", status: "complete" },
    { id: "tool:tool-read-1", role: "tool", text: "Read app.css", status: "complete" },
    {
      id: "turn-1-agent-commentary:commentary",
      role: "assistant",
      text: "I will check the style path.",
      phase: "commentary",
      status: "complete",
    },
    { id: "turn-1-agent-final_answer", role: "assistant", text: "Done", phase: "final_answer", status: "complete" },
  ]);
});

test("typed tool execution items summarize input and output", () => {
  const messages = messagesFromTurn(
    "thread-1",
    turn([tool("tool-list-1", "list_files", { path: "." }, "completed", "src\nCargo.toml")], "completed"),
  );

  expect(messages.length).toBe(1);
  expect(messages[0].role).toBe("tool");
  expect(messages[0].toolName).toBe("list_files");
  expect(messages[0].toolSummary).toBe("Listed files in .");
  expect(messages[0].toolOutput).toBe("src\nCargo.toml");
});

test("common typed tool executions are summarized as compact activity", () => {
  const messages = messagesFromTurn(
    "thread-1",
    turn(
      [
        tool("tool-list-1", "list_files", { path: "." }),
        tool("tool-search-1", "search_files", { query: "ToolTimelineItem", path: "src/components" }),
        tool("tool-glob-1", "glob", { pattern: "src/**/*.tsx", path: "." }),
        tool("tool-write-1", "write_file", { path: "src/lib/roder-thread.ts" }),
        tool("tool-edit-1", "edit", { path: "src/components/transcript.tsx" }),
      ],
      "completed",
    ),
  );

  expect(plain(messages.map((message) => message.toolSummary))).toEqual([
    "Listed files in .",
    'Searched for "ToolTimelineItem" in src/components',
    'Searched for "src/**/*.tsx" in .',
    "Wrote roder-thread.ts",
    "Edited transcript.tsx",
  ]);
});

test("file edit tools expose inline timeline previews", () => {
  const messages = messagesFromTurn(
    "thread-1",
    turn(
      [
        tool("tool-patch-1", "apply_patch", {
          patch: "*** Begin Patch\n*** Update File: src/app.ts\n@@\n-old\n+new\n*** End Patch",
        }),
        tool("tool-write-1", "write_file", { path: "src/app.ts", content: "export const value = 1;\n" }),
        tool("tool-edit-1", "edit", { path: "src/app.ts", old_string: "value = 1", new_string: "value = 2" }),
        tool("tool-multi-edit-1", "multi_edit", {
          path: "src/app.ts",
          edits: [
            { old_string: "value = 2", new_string: "value = 3" },
            { old_string: "name = 'old'", new_string: "name = 'new'" },
          ],
        }),
      ],
      "inProgress",
    ),
  );

  expect(plain(messages.map((message) => message.toolPreview))).toEqual([
    "*** Begin Patch\n*** Update File: src/app.ts\n@@\n-old\n+new\n*** End Patch",
    "export const value = 1;\n",
    "- value = 1\n+ value = 2",
    "@@ edit 1 @@\n- value = 2\n+ value = 3\n@@ edit 2 @@\n- name = 'old'\n+ name = 'new'",
  ]);
});

test("streaming edit tool previews survive completed status updates", () => {
  const messages = messagesFromTurn(
    "thread-1",
    turn(
      [
        tool("tool-edit-1", "edit", { path: "src/app.ts", old_string: "before", new_string: "after" }, "inProgress"),
        tool("tool-edit-1", "edit", undefined, "completed", "ok"),
      ],
      "completed",
    ),
  );

  expect(messages).toHaveLength(1);
  expect(messages[0].toolSummary).toBe("Edited app.ts");
  expect(messages[0].toolPreview).toBe("- before\n+ after");
});

test("namespaced typed tool executions use compact timeline summaries", () => {
  const messages = messagesFromTurn(
    "thread-1",
    turn(
      [
        tool("tool-read-1", "functions.read_file", { path: "src/components/tool-timeline-item.tsx" }),
        tool("tool-grep-1", "functions.grep", { query: "ToolTimelineItem", path: "src" }),
        tool("tool-shell-1", "functions.exec_command", { cmd: "pnpm test" }, "completed", "ok"),
      ],
      "completed",
    ),
  );

  expect(plain(messages.map((message) => message.toolSummary))).toEqual([
    "Read tool-timeline-item.tsx",
    'Searched for "ToolTimelineItem" in src',
    "Ran pnpm test",
  ]);
  expect(messages[2].toolInput).toBe("pnpm test");
});

test("shell tools summarize the command and keep cleaned output details", () => {
  const messages = messagesFromTurn(
    "thread-1",
    turn(
      [
        tool(
          "tool-shell-1",
          "shell",
          { command: "pnpm test" },
          "completed",
          "exit_code=0\noutput_bytes=12\nall tests passed",
        ),
      ],
      "completed",
    ),
  );

  expect(messages.length).toBe(1);
  expect(messages[0].toolSummary).toBe("Ran pnpm test");
  expect(messages[0].toolInput).toBe("pnpm test");
  expect(messages[0].toolOutput).toBe("all tests passed");
});

test("write stdin tools summarize typed commands like shell commands", () => {
  const messages = messagesFromTurn(
    "thread-1",
    turn([tool("tool-stdin-1", "write_stdin", { chars: "pnpm typecheck\n" }, "completed")], "completed"),
  );

  expect(messages.length).toBe(1);
  expect(messages[0].toolSummary).toBe("Ran pnpm typecheck");
  expect(messages[0].toolInput).toBe("pnpm typecheck");
});

test("failed typed tool executions keep display context", () => {
  const messages = messagesFromTurn(
    "thread-1",
    turn(
      [
        tool("tool-read-1", "read_file", { path: "missing.ts" }, "failed", undefined, "not found"),
        tool("tool-search-1", "search_files", { query: "needle", path: "src" }, "failed", undefined, "no matches"),
        tool("tool-write-1", "write_file", { path: "protected.ts" }, "failed", undefined, "permission denied"),
      ],
      "completed",
    ),
  );

  expect(plain(messages.map((message) => message.toolSummary))).toEqual([
    "Failed to read missing.ts",
    'Failed to search for "needle" in src',
    "Failed to write protected.ts",
  ]);
});

test("shell tools stay hidden before the command arrives", () => {
  const messages = messagesFromTurn(
    "thread-1",
    turn([tool("tool-shell-1", "shell", undefined, "inProgress")], "inProgress"),
  );

  expect(plain(messages)).toEqual([]);
});

test("failed turns surface the turn error as a failed system message", () => {
  const messages = messagesFromTurn("thread-1", {
    id: "turn-1",
    items: [],
    itemsView: "default",
    status: "failed",
    error: { message: "Sandbox denied command" },
  });

  expect(plain(messages)).toEqual([
    {
      id: "turn-1:error",
      threadId: "thread-1",
      turnId: "turn-1",
      role: "system",
      text: "Sandbox denied command",
      status: "failed",
    },
  ]);
});

function turn(items, status = "completed") {
  return {
    id: "turn-1",
    items,
    itemsView: "default",
    status,
  };
}

function tool(id, toolName, input, status = "completed", output, error) {
  return {
    id,
    type: "toolExecution",
    toolName,
    toolCallId: id,
    status,
    input,
    output,
    error,
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

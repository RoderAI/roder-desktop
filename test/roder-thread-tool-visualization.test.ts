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

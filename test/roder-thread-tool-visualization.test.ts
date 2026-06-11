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
    selectionMode: {
      type: "auto",
      optionId: "local:coding",
      routerId: "local",
      label: "Auto: Coding",
      baseline: { provider: "codex", model: "gpt-5.5" },
    },
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

test("routing decision items hydrate as timeline tool messages", () => {
  const messages = messagesFromTurn(
    "thread-1",
    turn(
      [
        {
          id: "turn-1-routing-decision-0",
          type: "routingDecision",
          status: "completed",
          decision: {
            threadId: "thread-1",
            turnId: "turn-1",
            roundIndex: 0,
            defaultSelection: { provider: "openai", model: "gpt-5.5" },
            selectedSelection: { provider: "anthropic", model: "claude-sonnet-5" },
            decision: {
              routerId: "local",
              outcome: "escalated",
              reasoning: { enabled: true, level: "high" },
              reason: "Large diff and failing tests",
            },
            timestamp: "2026-06-08T12:00:00Z",
          },
        },
      ],
      "completed",
    ),
  );

  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({
    id: "routing:turn-1-routing-decision-0",
    role: "tool",
    text: "Auto escalated to anthropic / claude-sonnet-5 (High)",
    toolName: "auto_model_routing",
    toolSummary: "Auto escalated to anthropic / claude-sonnet-5 (High)",
    toolSubject: "anthropic / claude-sonnet-5",
    toolOutput:
      "Reason: Large diff and failing tests\nDefault: openai / gpt-5.5\nSelected: anthropic / claude-sonnet-5",
  });
});

test("thread transcript only shows routing decisions when selected model or thinking changes", () => {
  const messages = messagesFromThread({
    id: "thread-1",
    selectionMode: {
      type: "auto",
      optionId: "local:coding",
      routerId: "local",
      label: "Auto: Coding",
      baseline: { provider: "codex", model: "gpt-5.5" },
    },
    turns: [
      turn(
        [
          routingDecision("route-1", {
            selectedModel: "gpt-5.5",
            thinking: "high",
            reason: "risk floor signal",
          }),
          { id: "turn-1-agent", type: "agentMessage", text: "I will inspect this.", status: "completed" },
          routingDecision("route-2", {
            selectedModel: "gpt-5.5",
            thinking: "high",
            reason: "recovery signal",
          }),
          routingDecision("route-3", {
            selectedModel: "gpt-5.5",
            thinking: "medium",
            reason: "lower risk phase",
          }),
          routingDecision("route-4", {
            selectedModel: "gpt-5.4-mini",
            thinking: "medium",
            reason: "cheap follow-up",
          }),
        ],
        "completed",
      ),
    ],
    status: { type: "idle", activeTurnId: null, activeFlags: [] },
  });

  expect(messages.filter((message) => message.toolName === "auto_model_routing").map((message) => message.id)).toEqual([
    "routing:route-1",
    "routing:route-3",
    "routing:route-4",
  ]);
});

test("manual thread transcripts hide routing decision items", () => {
  const messages = messagesFromThread({
    id: "thread-1",
    selectionMode: { type: "manual", provider: "codex", model: "gpt-5.5", reasoning: "high" },
    turns: [
      turn(
        [
          routingDecision("route-1", {
            selectedModel: "gpt-5.5",
            thinking: "high",
            reason: "risk floor signal",
          }),
          { id: "turn-1-agent", type: "agentMessage", text: "I will inspect this.", status: "completed" },
        ],
        "completed",
      ),
    ],
    status: { type: "idle", activeTurnId: null, activeFlags: [] },
  });

  expect(messages.filter((message) => message.toolName === "auto_model_routing")).toEqual([]);
  expect(messages.map((message) => message.text)).toEqual(["I will inspect this."]);
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
        }, "inProgress"),
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
    "diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -0,0 +0,0 @@\n-old\n+new\n",
    "export const value = 1;\n",
    "- value = 1\n+ value = 2",
    "@@ edit 1 @@\n- value = 2\n+ value = 3\n@@ edit 2 @@\n- name = 'old'\n+ name = 'new'",
  ]);
  expect(plain(messages.map((message) => message.toolPreviewKind))).toEqual(["patch", "text", "text", "text"]);
  expect(messages[0].toolSummary).toBe("Editing +1 -1 in app.ts");
});

test("completed apply_patch summaries include edited file and change counts", () => {
  const messages = messagesFromTurn(
    "thread-1",
    turn(
      [
        tool(
          "tool-patch-1",
          "apply_patch",
          {
            patch: [
              "*** Begin Patch",
              "*** Update File: src/app.ts",
              "@@",
              "-old",
              "+new",
              "+newer",
              "*** Update File: src/lib/util.ts",
              "@@",
              "-before",
              "+after",
              "*** End Patch",
            ].join("\n"),
          },
          "completed",
          "ok",
        ),
      ],
      "completed",
    ),
  );

  expect(messages[0].toolSummary).toBe("Applied patch to app.ts +1 more (+3 -2)");
  expect(messages[0].toolSubject).toBe("app.ts");
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

function routingDecision(id, { selectedModel, thinking, reason }) {
  return {
    id,
    type: "routingDecision",
    status: "completed",
    decision: {
      threadId: "thread-1",
      turnId: "turn-1",
      roundIndex: 0,
      defaultSelection: { provider: "codex", model: "gpt-5.5" },
      selectedSelection: { provider: "codex", model: selectedModel },
      decision: {
        routerId: "local",
        outcome: "escalated",
        reasoning: { enabled: true, level: thinking },
        reason,
      },
      timestamp: "2026-06-08T12:00:00Z",
    },
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

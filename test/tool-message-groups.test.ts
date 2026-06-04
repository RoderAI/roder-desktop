import { expect, test } from "vitest";
import { groupToolMessagesForTranscript } from "../src/lib/tool-message-groups";

test("adjacent read-file tool messages collapse into one transcript group", () => {
  const grouped = groupToolMessagesForTranscript([
    createToolMessage("tool-1", "read_file", "Read README.md"),
    createToolMessage("tool-2", "read_file", "Read package.json"),
    createAssistantMessage("Done."),
    createToolMessage("tool-3", "read_file", "Read tsconfig.json"),
  ]);

  expect(plain(grouped)).toEqual([
    {
      id: "activity-group:tool-1:tool-2",
      kind: "activityGroup",
      summary: {
        commands: 0,
        files: 2,
        label: "Explored 2 files",
        searches: 0,
      },
      entries: [
        {
          id: "tool-group:read_file:tool-1:tool-2",
          kind: "readFileGroup",
          messages: [
            createToolMessage("tool-1", "read_file", "Read README.md"),
            createToolMessage("tool-2", "read_file", "Read package.json"),
          ],
        },
      ],
    },
    {
      kind: "message",
      message: createAssistantMessage("Done."),
    },
    {
      kind: "message",
      message: createToolMessage("tool-3", "read_file", "Read tsconfig.json"),
    },
  ]);
});

test("adjacent skill read tool messages collapse into one transcript group", () => {
  const grouped = groupToolMessagesForTranscript([
    createToolMessage("tool-1", "read_skill", "Read ai-sdk Skill"),
    createToolMessage("tool-2", "read_skill_file", "Read ai-sdk streaming.md"),
    createToolMessage("tool-3", "read_file", "Read README.md"),
  ]);

  expect(plain(grouped)).toEqual([
    {
      id: "activity-group:tool-1:tool-3",
      kind: "activityGroup",
      summary: {
        commands: 0,
        files: 2,
        label: "Explored 2 files",
        searches: 0,
      },
      entries: [
        {
          id: "tool-group:read_skill:tool-1:tool-2",
          kind: "readSkillGroup",
          messages: [
            createToolMessage("tool-1", "read_skill", "Read ai-sdk Skill"),
            createToolMessage("tool-2", "read_skill_file", "Read ai-sdk streaming.md"),
          ],
        },
        {
          kind: "message",
          message: createToolMessage("tool-3", "read_file", "Read README.md"),
        },
      ],
    },
  ]);
});

test("adjacent search tool messages collapse into one transcript group", () => {
  const grouped = groupToolMessagesForTranscript([
    createToolMessage("tool-1", "glob", 'Searched "node_modules/.pnpm/7zip-bin@5.2.0/node_modules/7zip-bin/README.md"'),
    createToolMessage("tool-2", "glob", 'Searched "examples/extensions/aurora-theme/package.json"'),
    createToolMessage("tool-3", "search_files", 'Searched for "ToolTimelineItem" in src/components'),
    createAssistantMessage("Done."),
  ]);

  expect(plain(grouped)).toEqual([
    {
      id: "activity-group:tool-1:tool-3",
      kind: "activityGroup",
      summary: {
        commands: 0,
        files: 0,
        label: "Explored 3 searches",
        searches: 3,
      },
      entries: [
        {
          id: "tool-group:search:tool-1:tool-3",
          kind: "searchGroup",
          messages: [
            createToolMessage(
              "tool-1",
              "glob",
              'Searched "node_modules/.pnpm/7zip-bin@5.2.0/node_modules/7zip-bin/README.md"',
            ),
            createToolMessage("tool-2", "glob", 'Searched "examples/extensions/aurora-theme/package.json"'),
            createToolMessage("tool-3", "search_files", 'Searched for "ToolTimelineItem" in src/components'),
          ],
        },
      ],
    },
    {
      kind: "message",
      message: createAssistantMessage("Done."),
    },
  ]);
});

test("completed tool runs collapse into one expandable activity group", () => {
  const grouped = groupToolMessagesForTranscript([
    createUserMessage("Inspect this repo."),
    createToolMessage("tool-1", "read_file", "Read README.md"),
    createToolMessage("tool-2", "read_file", "Read package.json"),
    createToolMessage("tool-3", "grep", 'Searched for "Transcript" in src'),
    createToolMessage("tool-4", "shell", "Ran pnpm test"),
    createAssistantMessage("Done."),
  ]);

  expect(plain(grouped)).toEqual([
    {
      kind: "message",
      message: createUserMessage("Inspect this repo."),
    },
    {
      id: "activity-group:tool-1:tool-4",
      kind: "activityGroup",
      summary: {
        commands: 1,
        files: 2,
        label: "Explored 2 files, 1 search, ran 1 command",
        searches: 1,
      },
      entries: [
        {
          id: "tool-group:read_file:tool-1:tool-2",
          kind: "readFileGroup",
          messages: [
            createToolMessage("tool-1", "read_file", "Read README.md"),
            createToolMessage("tool-2", "read_file", "Read package.json"),
          ],
        },
        {
          kind: "message",
          message: createToolMessage("tool-3", "grep", 'Searched for "Transcript" in src'),
        },
        {
          kind: "message",
          message: createToolMessage("tool-4", "shell", "Ran pnpm test"),
        },
      ],
    },
    {
      kind: "message",
      message: createAssistantMessage("Done."),
    },
  ]);
});

test("namespaced exploration tools collapse into activity groups", () => {
  const grouped = groupToolMessagesForTranscript([
    createToolMessage("tool-1", "functions.read_file", "Read README.md"),
    createToolMessage("tool-2", "functions.grep", 'Searched for "Timeline" in src'),
    createToolMessage("tool-3", "functions.exec_command", "Ran pnpm test"),
  ]);

  expect(plain(grouped)).toEqual([
    {
      id: "activity-group:tool-1:tool-3",
      kind: "activityGroup",
      summary: {
        commands: 1,
        files: 1,
        label: "Explored 1 file, 1 search, ran 1 command",
        searches: 1,
      },
      entries: [
        {
          kind: "message",
          message: createToolMessage("tool-1", "functions.read_file", "Read README.md"),
        },
        {
          kind: "message",
          message: createToolMessage("tool-2", "functions.grep", 'Searched for "Timeline" in src'),
        },
        {
          kind: "message",
          message: createToolMessage("tool-3", "functions.exec_command", "Ran pnpm test"),
        },
      ],
    },
  ]);
});

test("goal tool mechanics are omitted from transcript activity", () => {
  const grouped = groupToolMessagesForTranscript([
    createToolMessage("tool-0", "get_goal", "Goal active: Inspect this repo."),
    createToolMessage("tool-1", "create_goal", "Goal active: Inspect this repo."),
    createToolMessage("tool-1b", "update_goal", "Goal complete: Inspect this repo."),
    createToolMessage("tool-1c", "update_plan", "Continue investigating the resize path."),
    createToolMessage("tool-1d", "verification_review", "Verification completed: 1 changed files, 2 tests recorded"),
    createToolMessage("tool-2", "list_files", "Listed files in ."),
    createToolMessage("tool-3", "read_file", "Read README.md"),
  ]);

  expect(plain(grouped)).toEqual([
    {
      id: "activity-group:tool-2:tool-3",
      kind: "activityGroup",
      summary: {
        commands: 0,
        files: 2,
        label: "Explored 2 files",
        searches: 0,
      },
      entries: [
        {
          kind: "message",
          message: createToolMessage("tool-2", "list_files", "Listed files in ."),
        },
        {
          kind: "message",
          message: createToolMessage("tool-3", "read_file", "Read README.md"),
        },
      ],
    },
  ]);
});

test("write stdin commands collapse into completed activity groups", () => {
  const grouped = groupToolMessagesForTranscript([
    createToolMessage("tool-1", "read_file", "Read package.json"),
    createToolMessage("tool-2", "write_stdin", "Ran pnpm typecheck"),
    createToolMessage("tool-3", "shell", "Ran pnpm lint"),
  ]);

  expect(plain(grouped)).toEqual([
    {
      id: "activity-group:tool-1:tool-3",
      kind: "activityGroup",
      summary: {
        commands: 2,
        files: 1,
        label: "Explored 1 file, ran 2 commands",
        searches: 0,
      },
      entries: [
        {
          kind: "message",
          message: createToolMessage("tool-1", "read_file", "Read package.json"),
        },
        {
          kind: "message",
          message: createToolMessage("tool-2", "write_stdin", "Ran pnpm typecheck"),
        },
        {
          kind: "message",
          message: createToolMessage("tool-3", "shell", "Ran pnpm lint"),
        },
      ],
    },
  ]);
});

test("running tool runs stay expanded while progress is active", () => {
  const grouped = groupToolMessagesForTranscript([
    createToolMessage("tool-1", "read_file", "Read README.md"),
    {
      ...createToolMessage("tool-2", "read_file", "Reading package.json"),
      status: "streaming",
      toolStatus: "running",
    },
  ]);

  expect(plain(grouped)).toEqual([
    {
      id: "tool-group:read_file:tool-1:tool-2",
      kind: "readFileGroup",
      messages: [
        createToolMessage("tool-1", "read_file", "Read README.md"),
        {
          ...createToolMessage("tool-2", "read_file", "Reading package.json"),
          status: "streaming",
          toolStatus: "running",
        },
      ],
    },
  ]);
});

test("completed tools stay expanded while their turn is still active", () => {
  const grouped = groupToolMessagesForTranscript(
    [
      createToolMessage("tool-1", "read_file", "Read README.md", "turn-1"),
      createToolMessage("tool-2", "grep", 'Searched for "Transcript" in src', "turn-1"),
    ],
    { activeTurnId: "turn-1" },
  );

  expect(plain(grouped)).toEqual([
    {
      kind: "message",
      message: createToolMessage("tool-1", "read_file", "Read README.md", "turn-1"),
    },
    {
      kind: "message",
      message: createToolMessage("tool-2", "grep", 'Searched for "Transcript" in src', "turn-1"),
    },
  ]);
});

test("failed tool activity stays inside the completed exploration group", () => {
  const grouped = groupToolMessagesForTranscript([
    createToolMessage("tool-1", "read_file", "Read README.md"),
    createFailedToolMessage("tool-2", "read_file", "Failed to read package.json"),
    createToolMessage("tool-3", "grep", 'Searched for "Transcript" in src'),
  ]);

  expect(plain(grouped)).toEqual([
    {
      id: "activity-group:tool-1:tool-3",
      kind: "activityGroup",
      summary: {
        commands: 0,
        files: 2,
        label: "Explored 2 files, 1 search",
        searches: 1,
      },
      entries: [
        {
          id: "tool-group:read_file:tool-1:tool-2",
          kind: "readFileGroup",
          messages: [
            createToolMessage("tool-1", "read_file", "Read README.md"),
            createFailedToolMessage("tool-2", "read_file", "Failed to read package.json"),
          ],
        },
        {
          kind: "message",
          message: createToolMessage("tool-3", "grep", 'Searched for "Transcript" in src'),
        },
      ],
    },
  ]);
});

function createToolMessage(toolCallId, toolName, text, turnId) {
  return {
    id: `tool:${toolCallId}`,
    role: "tool",
    status: "complete",
    text,
    ...(turnId ? { turnId } : {}),
    toolCallId,
    toolName,
    toolStatus: "complete",
    toolSummary: text,
  };
}

function createFailedToolMessage(toolCallId, toolName, text, turnId) {
  return {
    ...createToolMessage(toolCallId, toolName, text, turnId),
    status: "failed",
    toolStatus: "failed",
  };
}

function createUserMessage(text) {
  return {
    id: "user-1",
    role: "user",
    status: "complete",
    text,
  };
}

function createAssistantMessage(text) {
  return {
    id: "assistant-1",
    role: "assistant",
    status: "complete",
    text,
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

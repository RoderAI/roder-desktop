import { expect, test } from "vitest";
import {
  buildTranscriptRows,
  transcriptRowDisclosureKeys,
  transcriptRowsSearchText,
} from "../src/lib/transcript-rows";
import type { ConversationMessage } from "../src/types/roder";

test("builds stable rows for collapsed activity groups", () => {
  const rows = buildTranscriptRows({
    messages: [
      createToolMessage("tool-1", "read_file", "Read README.md"),
      createToolMessage("tool-2", "read_file", "Read package.json"),
    ],
  });

  expect(plain(rows)).toEqual([
    {
      disclosureKey: "disclosure:activity-group:tool-1:tool-2",
      key: "activity-group:tool-1:tool-2",
      kind: "entry",
      entry: {
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
      entryIsTool: true,
      nextIsTool: false,
      previousIsTool: false,
    },
  ]);
  expect(transcriptRowDisclosureKeys(rows[0])).toEqual([
    "disclosure:activity-group:tool-1:tool-2",
    "disclosure:activity-group:tool-1:tool-2:nested:disclosure:tool-group:read_file:tool-1:tool-2",
  ]);
});

test("adds a stable thread review-change row without changing message keys", () => {
  const message = createUserMessage("Review this.");
  const withoutReviewRows = buildTranscriptRows({ messages: [message] });
  const withReviewRows = buildTranscriptRows({ messages: [message], threadChangeCount: 2 });

  expect(withoutReviewRows.map((row) => row.key)).toEqual(["message:user-1"]);
  expect(withReviewRows.map((row) => row.key)).toEqual(["thread-review-changes", "message:user-1"]);
  expect(withReviewRows[0]).toMatchObject({
    count: 2,
    key: "thread-review-changes",
    kind: "threadReviewChanges",
  });
});

test("adds turn review-change rows at the last row for each turn", () => {
  const rows = buildTranscriptRows({
    messages: [
      createUserMessage("First turn", "turn-1", "user-1"),
      createAssistantMessage("Answer one", "turn-1", "assistant-1"),
      createUserMessage("Second turn", "turn-2", "user-2"),
      createAssistantMessage("Answer two", "turn-2", "assistant-2"),
    ],
    turnChangeCounts: {
      "turn-1": 3,
      "turn-2": 1,
    },
  });

  expect(rows.map((row) => row.key)).toEqual([
    "message:user-1",
    "message:assistant-1",
    "turn-review-changes:turn-1",
    "message:user-2",
    "message:assistant-2",
    "turn-review-changes:turn-2",
  ]);
  expect(rows[2]).toMatchObject({ count: 3, kind: "turnReviewChanges", turnId: "turn-1" });
  expect(rows[5]).toMatchObject({ count: 1, kind: "turnReviewChanges", turnId: "turn-2" });
});

test("appends and removes the working row without changing existing keys", () => {
  const message = createAssistantMessage("Thinking", "turn-1");
  const idleRows = buildTranscriptRows({ messages: [message] });
  const workingRows = buildTranscriptRows({ messages: [message], showWorkingIndicator: true });

  expect(idleRows.map((row) => row.key)).toEqual(["message:assistant-1"]);
  expect(workingRows.map((row) => row.key)).toEqual(["message:assistant-1", "thread-working-indicator"]);
  expect(workingRows[1]).toMatchObject({ key: "thread-working-indicator", kind: "working" });
});

test("keeps inserted review rows visible before the stable working row", () => {
  const message = createAssistantMessage("Thinking", "turn-1");
  const rows = buildTranscriptRows({
    messages: [message],
    showWorkingIndicator: true,
    turnChangeCounts: {
      "turn-1": 1,
    },
  });

  expect(rows.map((row) => row.key)).toEqual([
    "message:assistant-1",
    "turn-review-changes:turn-1",
    "thread-working-indicator",
  ]);
});

test("uses a stable working row for an otherwise empty transcript", () => {
  expect(buildTranscriptRows({ messages: [], showWorkingIndicator: true }).map((row) => row.key)).toEqual([
    "thread-working-indicator",
  ]);
});

test("preserves disclosure keys for active-turn compact tool groups", () => {
  const rows = buildTranscriptRows({
    activeTurnId: "turn-1",
    messages: [
      createToolMessage("tool-1", "read_file", "Read README.md", "turn-1"),
      createToolMessage("tool-2", "read_file", "Reading package.json", "turn-1", {
        status: "streaming",
        toolStatus: "running",
      }),
    ],
  });

  expect(rows[0]).toMatchObject({
    disclosureKey: "disclosure:tool-group:read_file:tool-1:tool-2",
    key: "tool-group:read_file:tool-1:tool-2",
    kind: "entry",
  });
  expect(transcriptRowDisclosureKeys(rows[0])).toEqual(["disclosure:tool-group:read_file:tool-1:tool-2"]);
});

test("preserves disclosure keys for active-turn completed shell tools", () => {
  const rows = buildTranscriptRows({
    activeTurnId: "turn-1",
    messages: [
      createToolMessage("tool-1", "shell", "Ran ls", "turn-1", {
        toolInput: "ls",
        toolOutput: "README.md",
      }),
    ],
  });

  expect(rows[0]).toMatchObject({
    disclosureKey: "disclosure:message:tool:tool-1",
    key: "message:tool:tool-1",
    kind: "entry",
  });
  expect(transcriptRowDisclosureKeys(rows[0])).toEqual(["disclosure:message:tool:tool-1"]);
});

test("builds searchable text for virtualized rows that are not mounted", () => {
  const rows = buildTranscriptRows({
    messages: [
      createUserMessage("Find alpha", "turn-1"),
      createToolMessage("tool-1", "shell", "Ran rg", "turn-1", {
        toolInput: "rg alpha",
        toolOutput: "alpha.ts",
        toolSubject: "search alpha",
      }),
      createAssistantMessage("Found alpha in alpha.ts", "turn-1"),
    ],
  });
  const searchText = transcriptRowsSearchText(rows);

  expect(searchText).toContain("Find alpha");
  expect(searchText).toContain("$ rg alpha");
  expect(searchText).toContain("alpha.ts");
  expect(searchText).toContain("Found alpha in alpha.ts");
});

test("excludes mounted rows from the hidden search mirror text", () => {
  const rows = buildTranscriptRows({
    messages: [
      createUserMessage("Visible alpha", "turn-1"),
      createAssistantMessage("Hidden beta", "turn-1"),
    ],
  });
  const searchText = transcriptRowsSearchText(rows, {
    excludedRowKeys: new Set(["message:user-1"]),
  });

  expect(searchText).not.toContain("Visible alpha");
  expect(searchText).toContain("Hidden beta");
});

function createToolMessage(
  toolCallId: string,
  toolName: string,
  text: string,
  turnId?: string,
  options: Partial<ConversationMessage> = {},
): ConversationMessage {
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
    ...options,
  };
}

function createUserMessage(text: string, turnId?: string, id = "user-1"): ConversationMessage {
  return {
    id,
    role: "user",
    status: "complete",
    text,
    ...(turnId ? { turnId } : {}),
  };
}

function createAssistantMessage(text: string, turnId?: string, id = "assistant-1"): ConversationMessage {
  return {
    id,
    role: "assistant",
    status: "complete",
    text,
    ...(turnId ? { turnId } : {}),
  };
}

function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

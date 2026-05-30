import { expect, test } from "vitest";
import {
  changeCountsByTurn,
  groupHunksByFile,
  groupObservedChangesByFile,
  hunkPagesToReviewPatch,
  hunkToUnifiedPatch,
  latestChangedTurnId,
  mergeReviewChangedFiles,
  pagedHunkToUnifiedPatch,
  reviewTurnIdCandidate,
  summarizeReviewChanges,
  summarizeHunks,
} from "../src/lib/review-changes";
import type { HunkRecord, PagedHunkDiff, WorkspaceChangeObservation } from "../src/types/roder";

test("hunkToUnifiedPatch converts recorded hunk lines into a minimal unified patch", () => {
  const record = makeHunk({
    path: "src/app.ts",
    oldStart: 3,
    oldLines: 1,
    newStart: 3,
    newLines: 2,
    diff: [
      { kind: "removed", text: "old", oldLine: 3 },
      { kind: "added", text: "new", newLine: 3 },
      { kind: "added", text: "extra", newLine: 4 },
    ],
  });

  expect(hunkToUnifiedPatch(record)).toBe(
    [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -3,1 +3,2 @@",
      "-old",
      "+new",
      "+extra",
      "",
    ].join("\n"),
  );
});

test("pagedHunkToUnifiedPatch uses the page lines while preserving the hunk header", () => {
  const page: PagedHunkDiff = {
    hunk: makeHunk({
      path: "README.md",
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      diff: [{ kind: "removed", text: "old", oldLine: 1 }],
    }),
    offset: 1,
    limit: 1,
    totalLines: 2,
    lines: [{ kind: "added", text: "new", newLine: 1 }],
    nextOffset: null,
  };

  expect(pagedHunkToUnifiedPatch(page)).toContain("+new");
  expect(pagedHunkToUnifiedPatch(page)).not.toContain("-old");
});

test("hunkPagesToReviewPatch preserves hunk pagination metadata across hunks", () => {
  const first = makeHunk({
    id: "hunk-1",
    path: "src/app.ts",
    diff: [
      { kind: "removed", text: "old", oldLine: 1 },
      { kind: "added", text: "new", newLine: 1 },
    ],
  });
  const second = makeHunk({
    id: "hunk-2",
    path: "src/app.ts",
    oldStart: 8,
    newStart: 9,
    diff: [{ kind: "added", text: "hello", newLine: 1 }],
  });

  expect(
    hunkPagesToReviewPatch([
      {
        hunk: first,
        offset: 0,
        limit: 1,
        totalLines: 2,
        lines: [{ kind: "removed", text: "old", oldLine: 1 }],
        nextOffset: 1,
      },
      {
        hunk: second,
        offset: 0,
        limit: 10,
        totalLines: 1,
        lines: second.diff,
        nextOffset: null,
      },
    ]),
  ).toEqual({
    patch: [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,1 +1,1 @@",
      "-old",
      "@@ -8,1 +9,1 @@",
      "+hello",
      "",
    ].join("\n"),
    totalLines: 3,
    truncated: true,
  });
});

test("groupHunksByFile derives changed file summaries and statuses from recorded hunks", () => {
  const grouped = groupHunksByFile([
    makeHunk({
      id: "hunk-1",
      path: "src/app.ts",
      oldLines: 1,
      newLines: 2,
      diff: [
        { kind: "removed", text: "old", oldLine: 1 },
        { kind: "added", text: "new", newLine: 1 },
        { kind: "added", text: "extra", newLine: 2 },
      ],
    }),
    makeHunk({
      id: "hunk-2",
      path: "docs/intro.md",
      oldLines: 0,
      newLines: 1,
      diff: [{ kind: "added", text: "hello", newLine: 1 }],
    }),
    makeHunk({
      id: "hunk-3",
      path: "src/app.ts",
      oldStart: 8,
      newStart: 9,
      diff: [{ kind: "context", text: "same", oldLine: 8, newLine: 9 }],
    }),
  ]);

  expect(grouped).toEqual([
    {
      path: "docs/intro.md",
      status: "added",
      additions: 1,
      deletions: 0,
      hunkIds: ["hunk-2"],
      hunks: [expect.objectContaining({ id: "hunk-2" })],
    },
    {
      path: "src/app.ts",
      status: "modified",
      additions: 2,
      deletions: 1,
      hunkIds: ["hunk-1", "hunk-3"],
      hunks: [expect.objectContaining({ id: "hunk-1" }), expect.objectContaining({ id: "hunk-3" })],
    },
  ]);
});

test("one-sided hunks in existing files stay modified instead of becoming file adds or deletes", () => {
  const insertion = makeHunk({
    id: "hunk-insert",
    oldStart: 3,
    oldLines: 1,
    newStart: 3,
    newLines: 2,
    diff: [
      { kind: "context", text: "same", oldLine: 3, newLine: 3 },
      { kind: "added", text: "inserted", newLine: 4 },
    ],
  });
  const deletion = makeHunk({
    id: "hunk-delete",
    oldStart: 8,
    oldLines: 2,
    newStart: 8,
    newLines: 1,
    diff: [
      { kind: "context", text: "same", oldLine: 8, newLine: 8 },
      { kind: "removed", text: "removed", oldLine: 9 },
    ],
  });

  expect(groupHunksByFile([insertion, deletion])).toEqual([
    expect.objectContaining({
      path: "src/app.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
    }),
  ]);
  expect(hunkPagesToReviewPatch([{ hunk: insertion, offset: 0, limit: 2, totalLines: 2, lines: insertion.diff }])).toEqual(
    expect.objectContaining({
      patch: expect.stringContaining("--- a/src/app.ts\n+++ b/src/app.ts"),
    }),
  );
  expect(hunkPagesToReviewPatch([{ hunk: deletion, offset: 0, limit: 2, totalLines: 2, lines: deletion.diff }])).toEqual(
    expect.objectContaining({
      patch: expect.stringContaining("--- a/src/app.ts\n+++ b/src/app.ts"),
    }),
  );
});

test("changeCountsByTurn counts files changed per turn rather than raw hunks", () => {
  expect(
    changeCountsByTurn([
      makeHunk({ id: "hunk-1", turnId: "turn-1", path: "src/app.ts" }),
      makeHunk({ id: "hunk-2", turnId: "turn-1", path: "src/app.ts" }),
      makeHunk({ id: "hunk-3", turnId: "turn-1", path: "README.md" }),
      makeHunk({ id: "hunk-4", turnId: "turn-2", path: "README.md" }),
    ]),
  ).toEqual({
    "turn-1": 2,
    "turn-2": 1,
  });
});

test("latestChangedTurnId chooses the latest turn represented by recorded hunks", () => {
  expect(
    latestChangedTurnId([
      makeHunk({ id: "hunk-1", turnId: "turn-1", path: "src/app.ts" }),
      makeHunk({ id: "hunk-2", turnId: "turn-1", path: "README.md" }),
      makeHunk({ id: "hunk-3", turnId: "turn-2", path: "src/app.ts" }),
    ]),
  ).toBe("turn-2");
});

test("reviewTurnIdCandidate falls back to the thread hunk cache for scopes without hunk files", () => {
  expect(reviewTurnIdCandidate("", "", "thread-latest-turn")).toBe("thread-latest-turn");
  expect(reviewTurnIdCandidate("", "scoped-latest-turn", "thread-latest-turn")).toBe("scoped-latest-turn");
  expect(reviewTurnIdCandidate("selected-turn", "scoped-latest-turn", "thread-latest-turn")).toBe("selected-turn");
});

test("summarizeHunks derives thread-level review metadata once", () => {
  expect(
    summarizeHunks([
      makeHunk({ id: "hunk-1", turnId: "turn-1", path: "src/app.ts" }),
      makeHunk({ id: "hunk-2", turnId: "turn-1", path: "src/app.ts" }),
      makeHunk({ id: "hunk-3", turnId: "turn-2", path: "README.md" }),
    ]),
  ).toEqual({
    fileCount: 2,
    latestTurnId: "turn-2",
    turnChangeCounts: {
      "turn-1": 1,
      "turn-2": 1,
    },
  });
});

test("summarizeReviewChanges combines exact hunks with observed workspace changes", () => {
  expect(
    summarizeReviewChanges(
      [
        makeHunk({ id: "hunk-1", turnId: "turn-1", path: "src/app.ts" }),
        makeHunk({ id: "hunk-2", turnId: "turn-1", path: "src/app.ts" }),
      ],
      [
        makeObservedChange({
          turnId: "turn-2",
          files: [
            { path: "src/app.ts", status: "modified", additions: 2, deletions: 1, binary: false },
            { path: "README.md", status: "untracked", additions: 4, deletions: 0, binary: false },
          ],
        }),
      ],
    ),
  ).toEqual({
    fileCount: 2,
    latestTurnId: "turn-2",
    turnChangeCounts: {
      "turn-1": 1,
      "turn-2": 2,
    },
  });
});

test("observed file summaries use the latest vs-head counts instead of summing observations", () => {
  expect(
    groupObservedChangesByFile([
      makeObservedChange({
        id: "observed-1",
        createdAt: "2026-05-29T00:00:00Z",
        files: [{ path: "src/app.ts", status: "modified", additions: 2, deletions: 0, binary: false }],
      }),
      makeObservedChange({
        id: "observed-2",
        createdAt: "2026-05-29T00:01:00Z",
        files: [{ path: "src/app.ts", status: "modified", additions: 5, deletions: 1, binary: false }],
      }),
    ]),
  ).toEqual([
    expect.objectContaining({
      path: "src/app.ts",
      additions: 5,
      deletions: 1,
      observedFiles: [
        expect.objectContaining({ additions: 2, deletions: 0 }),
        expect.objectContaining({ additions: 5, deletions: 1 }),
      ],
    }),
  ]);
});

test("mixed hunk and observed file summaries display observed vs-head counts as authoritative", () => {
  const hunkFile = groupHunksByFile([
    makeHunk({
      id: "hunk-1",
      path: "src/app.ts",
      diff: Array.from({ length: 10 }, (_, index) => ({ kind: "added" as const, text: `line ${index}` })),
    }),
  ]);
  const observedFile = groupObservedChangesByFile([
    makeObservedChange({
      files: [{ path: "src/app.ts", status: "modified", additions: 12, deletions: 1, binary: false }],
    }),
  ]);

  expect(mergeReviewChangedFiles(hunkFile, observedFile)).toEqual([
    expect.objectContaining({
      path: "src/app.ts",
      source: "mixed",
      additions: 12,
      deletions: 1,
    }),
  ]);
});

function makeHunk(overrides: Partial<HunkRecord> = {}): HunkRecord {
  return {
    id: "hunk-1",
    threadId: "thread-1",
    turnId: "turn-1",
    path: "src/app.ts",
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: 1,
    diff: [],
    toolCallId: "tool-1",
    toolName: "apply_patch",
    planReviewId: null,
    planStepId: null,
    timelineEventId: null,
    checkpointId: null,
    rollback: "available",
    reversePatch: null,
    createdAt: "2026-05-29T00:00:00Z",
    ...overrides,
  };
}

function makeObservedChange(overrides: Partial<WorkspaceChangeObservation> = {}): WorkspaceChangeObservation {
  return {
    id: "observed-1",
    threadId: "thread-1",
    turnId: "turn-1",
    toolCallId: "tool-1",
    toolName: "shell",
    source: "gitReconciled",
    confidence: "observedAfterTool",
    files: [],
    createdAt: "2026-05-29T00:00:00Z",
    ...overrides,
  };
}

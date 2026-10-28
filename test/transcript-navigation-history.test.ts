import { expect, test, vi } from "vitest";
import {
  scanTranscriptNavigationHistory,
  type TranscriptNavigationHistoryOptions,
  type TranscriptNavigationHistoryPage,
} from "../src/lib/transcript-navigation-history";
import type { TranscriptNavigationItem } from "../src/lib/transcript-navigation";
import type { RoderItem, RoderThread } from "../src/types/roder";

function thread(items: RoderItem[] = [], id = "thread"): RoderThread {
  return {
    id,
    preview: "",
    modelProvider: "test",
    model: "test",
    createdAt: 0,
    updatedAt: 0,
    cwd: "/workspace",
    status: { type: "idle", activeTurnId: null, activeFlags: [] },
    turns: [{ id: "turn", items, itemsView: "full", status: "completed" }],
  };
}

function page(items: RoderItem[] = [], before: string | null = null): TranscriptNavigationHistoryPage {
  return { thread: thread(items), before, hasMore: before !== null };
}

function setup(pages: TranscriptNavigationHistoryPage[]) {
  const onPage = vi.fn<(items: TranscriptNavigationItem[]) => void>();
  const readPage = vi.fn<TranscriptNavigationHistoryOptions["readPage"]>();
  for (const value of pages) readPage.mockResolvedValueOnce(value);
  return {
    threadId: "thread",
    before: "latest",
    readPage,
    isCancelled: () => false,
    onPage,
  };
}

test("indexes actual users only, excluding inbox deliveries and all other roles", async () => {
  const options = setup([
    page([
      { id: "question", type: "userMessage", text: "  Heading\n\n  List item  " },
      { id: "answer", type: "agentMessage", text: "An answer" },
      { id: "tool", type: "toolExecution", toolCallId: "call", toolName: "read_file", status: "completed" },
      { id: "system", type: "error", message: "A system error" },
      { id: "compaction", type: "compaction", summary: "Summary" },
      ...(["MESSAGE", "NEW_TASK", "FINAL_ANSWER"] as const).map((kind): RoderItem => ({
        id: kind,
        type: "userMessage",
        text: `Message Type: ${kind}\nTask name: /root\nSender: /root/reviewer\nPayload:\nHidden delivery`,
      })),
      { id: "blank", type: "userMessage", text: " \n " },
      { id: "image", type: "userMessage", text: "", images: [{ imageUrl: "data:image/png;base64,example" }] },
      { id: "long", type: "userMessage", text: "x".repeat(1_000) },
    ]),
  ]);
  await scanTranscriptNavigationHistory(options);
  expect(options.onPage.mock.calls).toEqual([
    [
      [
        { id: "question", role: "user", preview: "Heading\n\n  List item", rowIndex: -1 },
        { id: "image", role: "user", preview: "Image attachment", rowIndex: -1 },
        { id: "long", role: "user", preview: "x".repeat(640), rowIndex: -1 },
      ],
    ],
  ]);
});

test("reads older pages sequentially with bounded requests and chronological page summaries", async () => {
  const options = setup([
    page(
      [
        { id: "middle", type: "userMessage", text: "Middle" },
        { id: "newer", type: "userMessage", text: "Newer" },
      ],
      "older",
    ),
    page([{ id: "oldest", type: "userMessage", text: "Oldest" }]),
  ]);
  options.onPage.mockImplementation(() => {
    expect(options.readPage).toHaveBeenCalledTimes(options.onPage.mock.calls.length);
  });
  await scanTranscriptNavigationHistory(options);
  expect(options.readPage.mock.calls).toEqual([
    ["thread", { before: "latest", limit: 200, maxBytes: 2_097_152 }],
    ["thread", { before: "older", limit: 200, maxBytes: 2_097_152 }],
  ]);
  expect(options.onPage.mock.calls.map(([items]) => items.map((item) => item.id))).toEqual([
    ["middle", "newer"],
    ["oldest"],
  ]);
});

test("publishes empty summary pages and continues past non-user history", async () => {
  const options = setup([
    page([{ id: "answer", type: "agentMessage", text: "Answer" }], "older"),
    page([{ id: "question", type: "userMessage", text: "Question" }]),
  ]);
  await scanTranscriptNavigationHistory(options);
  expect(options.onPage.mock.calls[0]).toEqual([[]]);
  expect(options.onPage.mock.calls[1][0][0].id).toBe("question");
});

test("does not read when already cancelled or the initial cursor is exhausted", async () => {
  for (const override of [{ isCancelled: () => true }, { before: null }]) {
    const options = setup([]);
    await scanTranscriptNavigationHistory({ ...options, ...override });
    expect(options.readPage).not.toHaveBeenCalled();
    expect(options.onPage).not.toHaveBeenCalled();
  }
});

test("discards a pending response if cancelled before it resolves", async () => {
  const options = setup([]);
  let cancelled = false;
  let resolvePage: ((value: TranscriptNavigationHistoryPage) => void) | undefined;
  options.readPage.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePage = resolve;
      }),
  );
  const scan = scanTranscriptNavigationHistory({ ...options, isCancelled: () => cancelled });
  expect(options.readPage).toHaveBeenCalledTimes(1);
  cancelled = true;
  resolvePage?.({ thread: null, before: "older", hasMore: true });
  await scan;
  expect(options.onPage).not.toHaveBeenCalled();
});

test("stops immediately if the page callback cancels the scan", async () => {
  const options = setup([page([], "older"), page()]);
  let cancelled = false;
  options.onPage.mockImplementation(() => {
    cancelled = true;
  });
  await scanTranscriptNavigationHistory({ ...options, isCancelled: () => cancelled });
  expect(options.readPage).toHaveBeenCalledTimes(1);
});

test.each(["latest", null])("rejects a non-advancing continuation cursor %s", async (before) => {
  const options = setup([{ ...page(), before, hasMore: true }]);
  await expect(scanTranscriptNavigationHistory(options)).rejects.toThrow("pagination cursor did not advance");
  expect(options.onPage).not.toHaveBeenCalled();
  expect(options.readPage).toHaveBeenCalledTimes(1);
});

test("rejects cursor cycles across multiple pages", async () => {
  const options = setup([page([], "older"), page([], "oldest"), page([], "older")]);
  await expect(scanTranscriptNavigationHistory(options)).rejects.toThrow("pagination cursor did not advance");
  expect(options.readPage).toHaveBeenCalledTimes(3);
  expect(options.onPage).toHaveBeenCalledTimes(2);
});

test.each([
  { response: { ...page(), thread: null }, error: "page has no thread" },
  { response: { ...page(), thread: thread([], "another") }, error: "received thread another" },
])("rejects invalid pages: $error", async ({ response, error }) => {
  const options = setup([response]);
  await expect(scanTranscriptNavigationHistory(options)).rejects.toThrow(error);
  expect(options.onPage).not.toHaveBeenCalled();
});

test("stops at a final page even when its cursor repeats", async () => {
  const options = setup([{ ...page(), before: "latest", hasMore: false }]);
  await scanTranscriptNavigationHistory(options);
  expect(options.readPage).toHaveBeenCalledTimes(1);
  expect(options.onPage).toHaveBeenCalledWith([]);
});

test("propagates read failures without publishing a page", async () => {
  const options = setup([]);
  options.readPage.mockRejectedValueOnce(new Error("Read failed"));
  await expect(scanTranscriptNavigationHistory(options)).rejects.toThrow("Read failed");
  expect(options.onPage).not.toHaveBeenCalled();
});

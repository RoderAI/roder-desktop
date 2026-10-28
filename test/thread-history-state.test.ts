import { expect, test } from "vitest";
import {
  emptyThreadHistoryState,
  mergeInitialThreadHistory,
  mergeOlderThreadHistory,
  recentThreadItems,
} from "../src/lib/thread-history-state";
import type { RoderItem, RoderThread, RoderTurn } from "../src/types/roder";

function item(id: string, text = id): RoderItem {
  return { id, type: "agentMessage", text, status: "inProgress" };
}

function turn(id: string, items: RoderItem[], status: RoderTurn["status"] = "inProgress"): RoderTurn {
  return { id, items, itemsView: "full", status };
}

function thread(turns: RoderTurn[]): RoderThread {
  return {
    id: "thread",
    preview: "",
    modelProvider: "mock",
    model: "mock",
    createdAt: 0,
    updatedAt: 0,
    cwd: "/tmp",
    status: { type: "idle", activeTurnId: null, activeFlags: [] },
    turns,
  };
}

function ids(value: RoderThread) {
  return value.turns?.flatMap((entry) => entry.items.map((value) => value.id));
}

test("history starts unloaded and idle", () => {
  expect(emptyThreadHistoryState).toEqual({
    before: null,
    hasMore: false,
    loading: false,
    loadingOlder: false,
    loaded: false,
    error: null,
    requestId: 0,
  });
});

test("bounds one huge turn by items, keeps empty trailing turns and does not mutate", () => {
  const large = turn(
    "large",
    Array.from({ length: 1000 }, (_, index) => item(`${index}`)),
  );
  const empty = turn("empty", []);
  const source = thread([large, empty]);
  Object.freeze(large.items);
  Object.freeze(source.turns);
  const bounded = recentThreadItems(source);
  expect(ids(bounded)).toHaveLength(160);
  expect(ids(bounded)?.[0]).toBe("840");
  expect(bounded.turns?.[1]).toBe(empty);
  expect(large.items).toHaveLength(1000);
  expect(recentThreadItems(bounded)).toBe(bounded);
  expect(recentThreadItems(source, 0).turns).toEqual([empty]);
});

test("tail trimming preserves turn chronology and references for complete turns", () => {
  const source = thread([turn("old", [item("a"), item("b")]), turn("new", [item("c")])]);
  const bounded = recentThreadItems(source, 2);
  expect(ids(bounded)).toEqual(["b", "c"]);
  expect(bounded.turns?.[1]).toBe(source.turns?.[1]);
});

test("older partial turns prepend missing IDs and current live metadata wins", () => {
  const live = item("b", "live");
  const current = thread([turn("shared", [live, item("c")], "completed"), turn("new", [item("d")])]);
  const older = thread([turn("old", [item("old")]), turn("shared", [item("a"), item("b", "stale")])]);
  Object.freeze(current.turns);
  Object.freeze(current.turns![0].items);
  const merged = mergeOlderThreadHistory(current, older);
  expect(ids(merged)).toEqual(["old", "a", "b", "c", "d"]);
  expect(merged.turns?.[1].items[1]).toBe(live);
  expect(merged.turns?.[1].status).toBe("completed");
  expect(merged.turns?.[2]).toBe(current.turns?.[1]);
  expect(merged.status).toBe(current.status);
  expect(mergeOlderThreadHistory(current, thread([turn("shared", [item("b")])]))).toBe(current);
  expect(mergeOlderThreadHistory(undefined, older)).toBe(older);
});

test("initial page never restores unchanged cached turns or items", () => {
  const old = turn("old", [item("old")]);
  const cached = item("cached");
  const recent = item("recent");
  const baseline = thread([old, turn("active", [cached, recent])]);
  const incoming = thread([turn("active", [recent])]);
  expect(mergeInitialThreadHistory(incoming, baseline, baseline)).toBe(incoming);
  const current = { ...baseline, turns: [old, { ...baseline.turns![1], items: [cached, recent, item("live")] }] };
  expect(ids(mergeInitialThreadHistory(incoming, current, baseline))).toEqual(["recent", "live"]);
});

test("notifications during initial loading preserve new turns, live status and changed items", () => {
  const original = item("a", "start");
  const baseline = thread([turn("active", [original])]);
  const completedItem = { ...item("a", "start live"), status: "completed" as const };
  const current = {
    ...baseline,
    status: { ...baseline.status, type: "busy", activeTurnId: "next" },
    turns: [turn("active", [completedItem], "completed"), turn("next", [item("new")])],
  };
  const incoming = thread([turn("active", [item("a", "start")])]);
  const merged = mergeInitialThreadHistory(incoming, current, baseline);
  expect(ids(merged)).toEqual(["a", "new"]);
  expect(merged.turns?.[0].items[0]).toBe(completedItem);
  expect(merged.turns?.[0].status).toBe("completed");
  expect(merged.status).toBe(current.status);
  expect(baseline.turns?.[0].items[0]).toBe(original);
});

test("longer prefix-consistent loaded text/output beats incomplete deltas, but divergent live content wins", () => {
  const baseline = thread([turn("active", [item("text", "")])]);
  const current = thread([
    turn("active", [
      item("text", "hello"),
      { id: "tool", type: "toolExecution", toolCallId: "call", toolName: "exec", output: "one", status: "inProgress" },
      item("divergent", "live alternative"),
    ]),
  ]);
  const incoming = thread([
    turn(
      "active",
      [
        { ...item("text", "hello world"), status: "completed" },
        {
          id: "tool",
          type: "toolExecution",
          toolCallId: "call",
          toolName: "exec",
          output: "one two",
          status: "completed",
        },
        item("divergent", "snapshot"),
      ],
      "completed",
    ),
  ]);
  const merged = mergeInitialThreadHistory(incoming, current, baseline);
  expect(merged.turns?.[0]).toMatchObject({
    status: "completed",
    items: [
      { text: "hello world", status: "completed" },
      { output: "one two", status: "completed" },
      { text: "live alternative" },
    ],
  });
});

test("unchanged live turn references do not override incoming terminal state or metadata", () => {
  const baseline = thread([turn("active", [item("a")])]);
  const current = { ...baseline, updatedAt: 10 };
  const incoming = { ...thread([turn("active", [{ ...item("a"), status: "completed" }], "completed")]), model: "new" };
  const merged = mergeInitialThreadHistory(incoming, current, baseline);
  expect(merged.turns?.[0]).toBe(incoming.turns?.[0]);
  expect(merged.model).toBe("new");
  expect(merged.updatedAt).toBe(10);
});

test("changed cached entries keep chronology without restoring their unchanged neighbors", () => {
  const baseline = thread([
    turn("old", [item("old-changed"), item("omit-old")]),
    turn("active", [item("changed-before"), item("omit-middle"), item("recent")]),
  ]);
  const current = {
    ...baseline,
    turns: [
      { ...baseline.turns![0], items: [item("old-changed", "updated"), baseline.turns![0].items[1]] },
      {
        ...baseline.turns![1],
        items: [
          item("changed-before", "updated"),
          baseline.turns![1].items[1],
          baseline.turns![1].items[2],
          item("new"),
        ],
      },
    ],
  };
  const incoming = thread([turn("active", [item("recent")])]);
  expect(ids(mergeInitialThreadHistory(incoming, current, baseline))).toEqual([
    "old-changed",
    "changed-before",
    "recent",
    "new",
  ]);
});

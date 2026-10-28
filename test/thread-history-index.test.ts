import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test, vi } from "vitest";
import { createThreadHistoryIndexService } from "../electron/threads/thread-history-index";
import type { ThreadHistoryPage, ThreadHistoryParams } from "../electron/threads/thread-history";
import type { RoderThread } from "../src/types/roder";

const directories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function cursor(offset: number, thread = "thread") {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      thread,
      turn: "turn",
      source: offset % 2,
      item: `item-${offset}`,
    }),
  ).toString("hex");
}

function fixture(size = 1000) {
  vi.stubEnv("RODER_SESSION_STORE", "");
  const root = mkdtempSync(join(tmpdir(), "roder-history-index-"));
  directories.push(root);
  const directory = join(root, "threads", "thread");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "metadata.json"), JSON.stringify({ thread_id: "thread" }));
  const path = join(directory, "history.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE offsets(source INTEGER PRIMARY KEY,pos INTEGER NOT NULL);
    CREATE TABLE turns(id TEXT PRIMARY KEY,ns INTEGER NOT NULL,payload TEXT NOT NULL,terminal INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE items(
      key INTEGER PRIMARY KEY AUTOINCREMENT,turn_id TEXT NOT NULL,source INTEGER NOT NULL,
      item_id TEXT NOT NULL,raw_id TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0,
      visible INTEGER NOT NULL DEFAULT 1,bytes INTEGER NOT NULL DEFAULT 0,signature TEXT NOT NULL,
      turn_ns INTEGER NOT NULL,ns INTEGER NOT NULL,UNIQUE(turn_id,source,item_id));
    CREATE INDEX history_item_order ON items(turn_ns,turn_id,ns,source,key) WHERE visible=1;
    CREATE TABLE records(seq INTEGER PRIMARY KEY AUTOINCREMENT,item_key INTEGER NOT NULL,payload TEXT NOT NULL);
    BEGIN;
  `);
  const insert = db.prepare(
    "INSERT INTO items(turn_id,source,item_id,raw_id,signature,turn_ns,ns) VALUES('turn',?,?,?,'hash',?,?)",
  );
  for (let i = 0; i < size; i++)
    insert.run(i % 2, `item-${i}`, `item-${i}`, 1770000000000000000n, 1770000000000000000n + BigInt(i));
  db.exec("COMMIT");
  db.close();
  let cap = Infinity;
  const request = vi.fn<(method: string, params: ThreadHistoryParams) => Promise<ThreadHistoryPage>>(
    async (_method, params) => {
      const end = params.before
        ? Number(JSON.parse(Buffer.from(params.before, "hex").toString()).item.replace("item-", ""))
        : size;
      const start = Math.max(0, end - Math.min(params.limit ?? 160, cap));
      const thread: RoderThread = {
        id: "thread",
        preview: "",
        modelProvider: "mock",
        model: "mock",
        createdAt: 0,
        updatedAt: 0,
        cwd: "/tmp",
        status: { type: "idle", activeTurnId: null, activeFlags: [] },
        turns: [
          {
            id: "turn",
            status: "completed",
            itemsView: "full",
            items: Array.from({ length: end - start }, (_, i) => ({
              id: `item-${start + i}`,
              type: "agentMessage",
              text: "message",
              status: "completed",
            })),
          },
        ],
      };
      return { thread, before: start ? cursor(start) : null, hasMore: start > 0 };
    },
  );
  return {
    root,
    directory,
    path,
    request,
    service: createThreadHistoryIndexService({ request, configDir: root }),
    cap(value: number) {
      cap = value;
    },
  };
}

test("counts metadata and jumps directly into a large thread without predecessor reads", async () => {
  const f = fixture(20000);
  expect(await f.service.index({ threadId: "thread", before: cursor(19840) })).toEqual({
    supported: true,
    threadId: "thread",
    before: cursor(19840),
    olderCount: 19840,
    totalCount: 20000,
  });
  const page = await f.service.read({
    threadId: "thread",
    before: cursor(19840),
    olderCount: 19840,
    start: 4000,
    end: 4064,
  });
  expect(page.start).toBe(4000);
  expect(page.end).toBe(4064);
  expect(page.thread.turns![0].items[0].id).toBe("item-4000");
  expect(f.request).toHaveBeenCalledTimes(2);
  expect(f.request.mock.calls[1]).toEqual([
    "thread/history/read",
    {
      threadId: "thread",
      before: cursor(4064),
      limit: 64,
      maxBytes: 2 * 1024 * 1024,
    },
  ]);
});

test("byte-capped pages report their actual suffix range", async () => {
  const f = fixture();
  f.cap(3);
  const result = await f.service.read({
    threadId: "thread",
    before: cursor(840),
    olderCount: 840,
    start: 100,
    end: 164,
  });
  expect({ start: result.start, end: result.end }).toEqual({ start: 161, end: 164 });
});

test("rejects malformed cursors, traversal, and cross-thread identity", async () => {
  const f = fixture();
  for (const params of [
    { threadId: "../thread", before: null },
    { threadId: "thread", before: cursor(840, "other") },
    { threadId: "thread", before: "not-hex" },
  ])
    expect((await f.service.index(params)).supported).toBe(false);
  expect(f.request).not.toHaveBeenCalled();
  writeFileSync(join(f.directory, "metadata.json"), '{"thread_id":"other"}');
  expect((await f.service.index({ threadId: "thread", before: cursor(840) })).supported).toBe(false);
});

test("rejects symlinked thread directories", async () => {
  const f = fixture();
  symlinkSync(f.directory, join(f.root, "threads", "alias"));
  expect((await f.service.index({ threadId: "alias", before: null })).supported).toBe(false);
});

test("rejects unsupported schemas and missing databases without creating files", async () => {
  const f = fixture();
  const db = new DatabaseSync(f.path);
  db.exec("PRAGMA user_version=1");
  db.close();
  expect((await f.service.index({ threadId: "thread", before: null })).supported).toBe(false);
  rmSync(f.path);
  expect((await f.service.index({ threadId: "thread", before: null })).supported).toBe(false);
});

test("rejects incompatible column layout even for user_version zero", async () => {
  const f = fixture();
  const db = new DatabaseSync(f.path);
  db.exec("ALTER TABLE items ADD COLUMN unknown TEXT");
  db.close();
  expect((await f.service.index({ threadId: "thread", before: null })).supported).toBe(false);
});

test("supports explicit JSONL TOML config and rejects SQL backends and malformed config", async () => {
  const f = fixture();
  for (const config of ['[sessions]\nstore="postgres"', 'sessions = {store = "mysql"}', "not valid toml"]) {
    writeFileSync(join(f.root, "config.toml"), config);
    expect((await f.service.index({ threadId: "thread", before: cursor(840) })).supported).toBe(false);
  }
  expect(f.request).not.toHaveBeenCalled();
  writeFileSync(join(f.root, "config.toml"), '[sessions]\nstore="jsonl"');
  expect((await f.service.index({ threadId: "thread", before: cursor(840) })).supported).toBe(true);
  vi.stubEnv("RODER_SESSION_STORE", "postgres");
  expect((await f.service.index({ threadId: "thread", before: cursor(840) })).supported).toBe(false);
  writeFileSync(join(f.root, "config.toml"), '[sessions]\nstore="mysql"');
  vi.stubEnv("RODER_SESSION_STORE", "jsonl");
  expect((await f.service.index({ threadId: "thread", before: cursor(840) })).supported).toBe(true);
});

test("rejects stale tail identities instead of trusting a local database", async () => {
  const f = fixture();
  const native = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (method, params) => {
    const result = await native(method, params);
    result.thread.turns![0].items[0].id = "mismatch";
    return result;
  });
  expect((await f.service.index({ threadId: "thread", before: cursor(840) })).supported).toBe(false);
});

test("rejects invalid ranges before RPC and changed index boundaries", async () => {
  const f = fixture();
  for (const [start, end] of [
    [0, 65],
    [-1, 2],
    [5, 5],
    [800, 841],
    [1.5, 2],
  ]) {
    await expect(
      f.service.read({
        threadId: "thread",
        before: cursor(840),
        olderCount: 840,
        start,
        end,
      }),
    ).rejects.toThrow("Invalid indexed history range");
  }
  await expect(
    f.service.read({
      threadId: "thread",
      before: cursor(840),
      olderCount: 839,
      start: 0,
      end: 32,
    }),
  ).rejects.toThrow("boundary changed");
  expect(f.request).not.toHaveBeenCalled();
});

test("detects concurrent metadata mutations during range RPC", async () => {
  const f = fixture();
  const native = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (method, params) => {
    const result = await native(method, params);
    const db = new DatabaseSync(f.path);
    db.exec("UPDATE items SET visible=0 WHERE item_id='item-1'");
    db.close();
    return result;
  });
  await expect(
    f.service.read({
      threadId: "thread",
      before: cursor(840),
      olderCount: 840,
      start: 100,
      end: 132,
    }),
  ).rejects.toThrow("boundary changed");
});

test("environment config directory precedence matches the harness", async () => {
  const f = fixture();
  vi.stubEnv("RODER_CONFIG_DIR", f.root);
  vi.stubEnv("RODER_DATA_DIR", "/nonexistent-roder-data");
  const service = createThreadHistoryIndexService({ request: f.request });
  expect((await service.index({ threadId: "thread", before: cursor(840) })).supported).toBe(true);
});

test("a complete or empty transcript has no unloaded prefix", async () => {
  const f = fixture(0);
  expect(await f.service.index({ threadId: "thread", before: null })).toEqual({
    supported: true,
    threadId: "thread",
    before: null,
    olderCount: 0,
    totalCount: 0,
  });
});

test("rejects a native range page with unrelated item identities", async () => {
  const f = fixture();
  const native = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (method, params) => {
    const result = await native(method, params);
    result.thread!.turns![0].items[0].id = "other";
    return result;
  });
  await expect(
    f.service.read({
      threadId: "thread",
      before: cursor(840),
      olderCount: 840,
      start: 100,
      end: 132,
    }),
  ).rejects.toThrow("identity mismatch");
});

test("cursor encoding retains the saved-item source namespace", async () => {
  const f = fixture();
  await f.service.read({
    threadId: "thread",
    before: cursor(840),
    olderCount: 840,
    start: 100,
    end: 131,
  });
  const boundary = f.request.mock.calls[0][1].before!;
  expect(JSON.parse(Buffer.from(boundary, "hex").toString())).toEqual({
    version: 1,
    thread: "thread",
    turn: "turn",
    source: 1,
    item: "item-131",
  });
});

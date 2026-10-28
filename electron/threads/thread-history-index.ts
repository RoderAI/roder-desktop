import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "smol-toml";
import type { RoderThread } from "../../src/types/roder";
import type { ThreadHistoryPage, ThreadHistoryParams } from "./thread-history";

type Identity = { turn_id: string; source: number; item_id: string };
type Cursor = { version: number; thread: string; turn: string; source: number; item: string };
export type ThreadHistoryIndexParams = { threadId: string; before: string | null };
export type ThreadHistoryIndexResult =
  | { supported: true; threadId: string; before: string | null; olderCount: number; totalCount: number }
  | { supported: false; reason: string };
export type ThreadHistoryIndexedReadParams = ThreadHistoryIndexParams & {
  olderCount: number;
  start: number;
  end: number;
};
export type ThreadHistoryIndexedPage = { thread: RoderThread; start: number; end: number };

const ORDER = "turn_ns,turn_id,ns,source,key";
const COLUMNS = {
  offsets: ["source", "pos"],
  turns: ["id", "ns", "payload", "terminal"],
  items: [
    "key",
    "turn_id",
    "source",
    "item_id",
    "raw_id",
    "completed",
    "visible",
    "bytes",
    "signature",
    "turn_ns",
    "ns",
  ],
  records: ["seq", "item_key", "payload"],
};

function validateThreadId(threadId: string) {
  if (!threadId || threadId === "." || threadId === ".." || /[/\\\0]/.test(threadId)) {
    throw new Error("Invalid history thread id");
  }
}

function decode(before: string, threadId: string): Cursor {
  if (before.length > 16384 || !/^(?:[a-fA-F0-9]{2})+$/.test(before)) {
    throw new Error("Invalid history cursor");
  }
  const value = JSON.parse(Buffer.from(before, "hex").toString("utf8")) as Cursor;
  if (
    value.version !== 1 ||
    value.thread !== threadId ||
    typeof value.turn !== "string" ||
    typeof value.item !== "string" ||
    ![0, 1].includes(value.source)
  ) {
    throw new Error("Invalid history cursor identity");
  }
  return value;
}

function encode(threadId: string, row: Identity) {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      thread: threadId,
      turn: row.turn_id,
      source: row.source,
      item: row.item_id,
    }),
  ).toString("hex");
}

function assertJsonl(configDir: string) {
  let config: Record<string, unknown> = {};
  try {
    config = parse(readFileSync(join(configDir, "config.toml"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const sessions = config.sessions;
  if (sessions !== undefined && (!sessions || typeof sessions !== "object" || Array.isArray(sessions))) {
    throw new Error("Unsupported session configuration");
  }
  const configured =
    sessions && typeof sessions === "object" && !Array.isArray(sessions)
      ? (sessions as Record<string, unknown>).store
      : undefined;
  const override = process.env.RODER_SESSION_STORE;
  const store = override?.trim() ? override : configured;
  if (store !== undefined && store !== "jsonl") throw new Error("Unsupported session store");
}

function openIndex(configDir: string, threadId: string): DatabaseSync {
  validateThreadId(threadId);
  assertJsonl(configDir);
  const root = realpathSync(join(configDir, "threads"));
  const directory = realpathSync(join(root, threadId));
  if (directory !== join(root, threadId) || !directory.startsWith(root + sep)) {
    throw new Error("Invalid history directory");
  }
  const metadataPath = join(directory, "metadata.json");
  const databasePath = join(directory, "history.sqlite");
  if (realpathSync(metadataPath) !== metadataPath || realpathSync(databasePath) !== databasePath) {
    throw new Error("Invalid history file path");
  }
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as { thread_id?: string };
  if (metadata.thread_id !== threadId) throw new Error("History metadata identity mismatch");
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=1000; BEGIN");
    // The pinned harness uses unversioned (user_version=0) derived indexes.
    if (db.prepare("PRAGMA user_version").get()?.user_version !== 0) {
      throw new Error("Unsupported history schema version");
    }
    for (const [table, columns] of Object.entries(COLUMNS)) {
      const actual = db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => row.name);
      if (actual.join(",") !== columns.join(",")) throw new Error("Unsupported history schema");
    }
    const index = db
      .prepare("PRAGMA index_info(history_item_order)")
      .all()
      .map((row) => row.name);
    if (index.join(",") !== ORDER) throw new Error("Unsupported history order index");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function count(db: DatabaseSync) {
  return Number(db.prepare("SELECT count(*) AS count FROM items WHERE visible=1").get()!.count);
}

function ordinal(db: DatabaseSync, threadId: string, before: string | null) {
  if (!before) return 0;
  const cursor = decode(before, threadId);
  const anchor = db.prepare(
    "SELECT turn_ns,turn_id,ns,source,key FROM items WHERE visible=1 AND turn_id=? AND source=? AND item_id=?",
  );
  // Rust persists nanoseconds as i64, far beyond JavaScript's safe number range.
  anchor.setReadBigInts(true);
  const row = anchor.get(cursor.turn, cursor.source, cursor.item);
  if (!row) throw new Error("History cursor no longer exists");
  return Number(
    db
      .prepare(`SELECT count(*) AS count FROM items WHERE visible=1 AND (${ORDER}) < (?,?,?,?,?)`)
      .get(row.turn_ns, row.turn_id, row.ns, row.source, row.key)!.count,
  );
}

function identities(db: DatabaseSync, start: number, end: number): Identity[] {
  return db
    .prepare(`SELECT turn_id,source,item_id FROM items WHERE visible=1 ORDER BY ${ORDER} LIMIT ? OFFSET ?`)
    .all(end - start, start) as Identity[];
}

function pageItems(thread: RoderThread | null, threadId: string) {
  if (!thread || thread.id !== threadId) throw new Error("History page thread mismatch");
  return (thread.turns ?? []).flatMap((turn) =>
    turn.items.map((item) => ({
      turn_id: turn.id,
      item_id: item.id,
    })),
  );
}

function verifyPage(thread: RoderThread | null, threadId: string, rows: Identity[]) {
  const actual = pageItems(thread, threadId);
  if (
    actual.length !== rows.length ||
    actual.some((item, i) => item.turn_id !== rows[i].turn_id || item.item_id !== rows[i].item_id)
  ) {
    throw new Error("History index changed or page identity mismatch");
  }
}

export function createThreadHistoryIndexService(options: {
  request: (method: string, params: ThreadHistoryParams) => Promise<ThreadHistoryPage>;
  configDir?: string;
}) {
  const configDir = resolve(
    options.configDir ?? process.env.RODER_CONFIG_DIR ?? process.env.RODER_DATA_DIR ?? join(homedir(), ".roder"),
  );
  return {
    async index(params: ThreadHistoryIndexParams): Promise<ThreadHistoryIndexResult> {
      try {
        validateThreadId(params.threadId);
        assertJsonl(configDir);
        if (params.before) decode(params.before, params.threadId);
        // Let the owner synchronize its disposable index before inspecting metadata.
        const tail = await options.request("thread/history/read", {
          threadId: params.threadId,
          limit: 160,
          maxBytes: 2 * 1024 * 1024,
        });
        const db = openIndex(configDir, params.threadId);
        try {
          const totalCount = count(db);
          const length = pageItems(tail.thread, params.threadId).length;
          if (length > totalCount || (!length && totalCount > 0)) {
            throw new Error("History index count mismatch");
          }
          verifyPage(tail.thread, params.threadId, identities(db, totalCount - length, totalCount));
          const olderCount = ordinal(db, params.threadId, params.before);
          return { supported: true, ...params, olderCount, totalCount };
        } finally {
          db.close();
        }
      } catch (error) {
        return { supported: false, reason: error instanceof Error ? error.message : "History index unavailable" };
      }
    },
    async read(params: ThreadHistoryIndexedReadParams): Promise<ThreadHistoryIndexedPage> {
      const { threadId, before, olderCount, start, end } = params;
      if (
        ![olderCount, start, end].every(Number.isSafeInteger) ||
        start < 0 ||
        end <= start ||
        end > olderCount ||
        end - start > 64
      ) {
        throw new Error("Invalid indexed history range");
      }
      let rows: Identity[];
      let endpoint: string;
      const db = openIndex(configDir, threadId);
      try {
        if (ordinal(db, threadId, before) !== olderCount) throw new Error("History index boundary changed");
        rows = identities(db, start, end);
        const anchor = identities(db, end, end + 1)[0];
        if (!anchor || rows.length !== end - start) throw new Error("History range unavailable");
        endpoint = encode(threadId, anchor);
      } finally {
        db.close();
      }
      const page = await options.request("thread/history/read", {
        threadId,
        before: endpoint,
        limit: end - start,
        maxBytes: 2 * 1024 * 1024,
      });
      const length = pageItems(page.thread, threadId).length;
      if (!length || length > rows.length) throw new Error("Invalid indexed history page size");
      const actualStart = end - length;
      verifyPage(page.thread, threadId, rows.slice(rows.length - length));
      const current = openIndex(configDir, threadId);
      try {
        if (ordinal(current, threadId, before) !== olderCount) throw new Error("History index boundary changed");
        const refreshed = identities(current, start, end);
        if (JSON.stringify(refreshed) !== JSON.stringify(rows)) throw new Error("History index changed");
        verifyPage(page.thread, threadId, identities(current, actualStart, end));
      } finally {
        current.close();
      }
      return { thread: page.thread!, start: actualStart, end };
    },
  };
}

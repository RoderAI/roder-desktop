export type RoderAgentWake = { id: string; at: number; reason: string };
export type RoderAgent = {
  id: string;
  name: string;
  /** One-line summary for lists. It mirrors the opening paragraph of INSTRUCTIONS.md once that is written. */
  mission: string;
  workspaceId: string;
  threadId: string;
  modelProvider?: string;
  model?: string;
  reasoning?: string;
  enabled: boolean;
  intervalMinutes: number;
  eventMethods: string[];
  maxRunsPerDay: number;
  maxRunMinutes: number;
  runs: number[];
  wakes: RoderAgentWake[];
  active: { turnId: string | null; startedAt: number } | null;
  lastError: string | null;
  lastRunAt: number | null;
  sprite: RoderAgentSprite | null;
  /** Worker threads running at once (1-32); more delegates wait in the queue. */
  maxConcurrentWorkers: number;
  /** Automatic messages a worker takes before the Roder must ask the user (0-32). */
  maxFollowups: number;
  /** Permission mode for worker turns (decision D7). */
  workerPolicyMode: RoderWorkerPolicyMode;
  workers: RoderWorker[];
  /** Worker deliveries not yet made, oldest first. */
  outbox: RoderWorkerDelivery[];
};

export const roderWorkerPolicyModes = ["bypass", "accept_all", "default"] as const;
export type RoderWorkerPolicyMode = (typeof roderWorkerPolicyModes)[number];

/**
 * A thread doing work for a Roder in its own git worktree.
 * - `queued`: delegated, waiting for a free slot to start its objective.
 * - `running`: a turn is in progress; it holds one of `maxConcurrentWorkers`.
 * - `idle`: its last turn ended; messageWorker sends it more work.
 */
export type RoderWorkerState = "queued" | "running" | "idle";
export type RoderWorker = {
  threadId: string;
  /** The issue it was delegated, if any. */
  issueId: string | null;
  objective: string;
  /** Its checkout, on `branch` made from `base`. */
  worktreePath: string;
  branch: string;
  base: string;
  state: RoderWorkerState;
  /** Place in the delegate queue, 1 starts next. Null unless waiting for a slot. */
  queuePosition: number | null;
  /** Automatic messages since the user last spoke to it. */
  followups: number;
  /** Who stopped it: the user's stop needs the user before automatic messages resume. */
  hold: "user" | "roder" | null;
  delegatedAt: number;
  lastError: string | null;
};
export type RoderWorkerDelivery = {
  id: string;
  threadId: string;
  kind: "start" | "message" | "stop";
  text: string;
  createdAt: number;
  /** `sending` survives a crash mid-delivery so it is checked, not sent twice. */
  phase: "pending" | "sending";
  /** The thread's turn count before sending, to tell whether a `sending` delivery arrived. */
  turnsBefore: number | null;
  attempts: number;
};

/** The five reserved files every Roder has, in display order. */
export const roderFilePaths = ["INSTRUCTIONS.md", "AGENTS.md", "NOTES.md", "WORKERS.md", "DIGEST.md"] as const;
export type RoderFilePath = (typeof roderFilePaths)[number];
/** Who wrote a version: the user (UI) or the Roder's own thread. */
export type RoderFileAuthor = "user" | "roder";
export type RoderFileVersion = {
  path: RoderFilePath;
  version: number;
  bytes: number;
  author: RoderFileAuthor;
  writtenAt: number;
  /** The version this one copied, when it was written by a restore. */
  restoredFrom: number | null;
};
export type RoderFile = RoderFileVersion & { content: string };

export type RoderAgentDetail = RoderAgent & { files: RoderFileVersion[] };
export type RoderAgentCreate = Pick<
  RoderAgent,
  "name" | "mission" | "workspaceId" | "modelProvider" | "model" | "reasoning"
>;
export type RoderAgentPromote = RoderAgentCreate & { threadId: string };
export type RoderAgentUpdate = Partial<
  Pick<
    RoderAgent,
    | "name"
    | "enabled"
    | "intervalMinutes"
    | "eventMethods"
    | "maxRunsPerDay"
    | "maxRunMinutes"
    | "maxConcurrentWorkers"
    | "maxFollowups"
    | "workerPolicyMode"
  >
> & { id: string };
export type RoderFileWrite = { id: string; path: RoderFilePath; content: string; expectedVersion: number };
export type RoderFileRestore = { id: string; path: RoderFilePath; version: number; expectedVersion: number };
import type { RoderAgentSprite } from "./roder-agent-sprite";

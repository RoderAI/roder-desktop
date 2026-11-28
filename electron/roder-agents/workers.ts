// A Roder's worker threads, modelled on Zuse's worker registry, outbox and
// `admit` (crates/engine/src/zappers.rs, zappers/supervision.rs).
//
// `delegate` makes a git worktree on its own branch and a thread in it, then
// registers the thread as a worker with a `start` delivery in the Roder's
// outbox. Nothing is sent to a thread directly: the pump walks the outbox in
// order and starts a turn only while fewer than `maxConcurrentWorkers` workers
// are running, so extra delegates wait with a queue position and start when a
// running worker goes idle. `messageWorker` adds a `message` delivery, bounded
// by `maxFollowups` for automatic messages; `stopWorker` cancels what is still
// pending and interrupts a running turn; `releaseWorker` forgets the thread.
//
// Every function here runs inside the Roder service's serialized queue and
// mutates the Roder record in place; the service persists it.
//
// Supervision (slice 7) plugs in at `onTurnSettled`: it is called once a
// worker's turn ends, before the pump hands the slot to the next delivery.
import { randomUUID } from "node:crypto";
import type { Issue } from "../../src/types/issues";
import {
  roderWorkerPolicyModes,
  type RoderAgent,
  type RoderWorker,
  type RoderWorkerDelivery,
  type RoderWorkerPolicyMode,
} from "../../src/types/roder-agents";
import { RODER_RULES_PROMPT_MAX_BYTES, RODER_WORKERS_FILE, roderFileExcerpt, type RoderFileStore } from "./files";
import { roderWorkerContext, roderWorkerMessage } from "./worker-brief";
import type { IssuesService } from "../issues/service";
import type { DesktopWorktrees } from "../worktrees/desktop-worktrees";
import type { Workspace } from "../../src/types/roder";

export const RODER_WORKER_DEFAULTS = {
  maxConcurrentWorkers: 2,
  maxFollowups: 3,
  workerPolicyMode: "bypass",
} as const satisfies Partial<RoderAgent>;
export const RODER_MAX_CONCURRENT_WORKERS = 32;
export const RODER_MAX_FOLLOWUPS = 32;
/** Workers a Roder keeps at once; release finished ones to delegate more. */
export const RODER_WORKER_LIMIT = 64;
/** Attempts to deliver one message before it is dropped with an error on the worker. */
export const RODER_DELIVERY_ATTEMPTS = 3;
const OBJECTIVE_MAX = 32_000;

/** What a host does to give a worker its own checkout and thread. */
export type StartWorkerThread = (spec: {
  workspaceId: string;
  branch: string;
  /** A branch, tag or commit; omitted means the repository's default branch at origin. */
  base?: string;
  modelProvider?: string;
  model?: string;
  reasoning?: string;
}) => Promise<{ threadId: string; worktreePath: string; branch: string; base: string }>;

type ObjectValue = Record<string, unknown>;
type Options = {
  request: (method: string, params: unknown) => Promise<unknown>;
  startThread?: StartWorkerThread;
  files: RoderFileStore;
  issues?: Pick<IssuesService, "request">;
  persist: () => Promise<void>;
  /** Slice 7 seam: a worker's turn ended (completed, failed or interrupted). */
  onTurnSettled?: (roder: RoderAgent, worker: RoderWorker, params: ObjectValue) => Promise<void> | void;
};

function object(value: unknown, label: string): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as ObjectValue;
}
function whole(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max)
    throw new Error(`Invalid ${label}: use a whole number from ${min} to ${max}`);
  return value as number;
}
function string(value: unknown, label: string, max = 4000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Invalid ${label}`);
  return value;
}
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Fill worker fields missing from records written before workers existed, and check the rest. */
export function loadRoderWorkerState(entry: ObjectValue): void {
  entry.maxConcurrentWorkers ??= RODER_WORKER_DEFAULTS.maxConcurrentWorkers;
  entry.maxFollowups ??= RODER_WORKER_DEFAULTS.maxFollowups;
  entry.workerPolicyMode ??= RODER_WORKER_DEFAULTS.workerPolicyMode;
  entry.workers ??= [];
  entry.outbox ??= [];
  whole(entry.maxConcurrentWorkers, "worker concurrency", 1, RODER_MAX_CONCURRENT_WORKERS);
  whole(entry.maxFollowups, "follow-up limit", 0, RODER_MAX_FOLLOWUPS);
  if (!roderWorkerPolicyModes.includes(entry.workerPolicyMode as RoderWorkerPolicyMode))
    throw new Error("Invalid worker permission mode");
  if (!Array.isArray(entry.workers) || entry.workers.length > RODER_WORKER_LIMIT)
    throw new Error("Invalid Roder workers");
  const threads = new Set<string>();
  for (const value of entry.workers) {
    const worker = object(value, "Roder worker");
    const threadId = string(worker.threadId, "worker thread id", 500);
    if (threads.has(threadId) || threadId === entry.threadId) throw new Error("Duplicate Roder worker");
    threads.add(threadId);
    if (worker.issueId !== null) string(worker.issueId, "worker issue id", 500);
    string(worker.objective, "worker objective", OBJECTIVE_MAX);
    string(worker.worktreePath, "worker worktree", 4000);
    string(worker.branch, "worker branch", 500);
    string(worker.base, "worker base", 500);
    if (!["queued", "running", "idle"].includes(worker.state as string)) throw new Error("Invalid worker state");
    if (worker.queuePosition !== null) whole(worker.queuePosition, "queue position", 1, RODER_WORKER_LIMIT);
    whole(worker.followups, "worker follow-ups", 0, RODER_MAX_FOLLOWUPS);
    if (worker.hold !== null && worker.hold !== "user" && worker.hold !== "roder")
      throw new Error("Invalid worker hold");
    whole(worker.delegatedAt, "worker timestamp", 0, Number.MAX_SAFE_INTEGER);
    if (worker.lastError !== null && typeof worker.lastError !== "string") throw new Error("Invalid worker error");
  }
  if (!Array.isArray(entry.outbox) || entry.outbox.length > RODER_WORKER_LIMIT * 4)
    throw new Error("Invalid Roder outbox");
  for (const value of entry.outbox) {
    const delivery = object(value, "Roder delivery");
    string(delivery.id, "delivery id", 500);
    if (!threads.has(delivery.threadId as string)) throw new Error("Roder delivery for an unknown worker");
    if (!["start", "message", "stop"].includes(delivery.kind as string)) throw new Error("Invalid delivery kind");
    if (typeof delivery.text !== "string") throw new Error("Invalid delivery text");
    whole(delivery.createdAt, "delivery timestamp", 0, Number.MAX_SAFE_INTEGER);
    if (delivery.phase !== "pending" && delivery.phase !== "sending") throw new Error("Invalid delivery phase");
    if (delivery.turnsBefore !== null) whole(delivery.turnsBefore, "delivery turn count", 0, Number.MAX_SAFE_INTEGER);
    whole(delivery.attempts, "delivery attempts", 0, RODER_DELIVERY_ATTEMPTS);
  }
}

/** Apply the worker settings in a `desktop/roders/update` request to `next`. */
export function applyRoderWorkerSettings(next: RoderAgent, params: ObjectValue): void {
  if (params.maxConcurrentWorkers !== undefined)
    next.maxConcurrentWorkers = whole(
      params.maxConcurrentWorkers,
      "worker concurrency",
      1,
      RODER_MAX_CONCURRENT_WORKERS,
    );
  if (params.maxFollowups !== undefined)
    next.maxFollowups = whole(params.maxFollowups, "follow-up limit", 0, RODER_MAX_FOLLOWUPS);
  if (params.workerPolicyMode !== undefined) {
    if (!roderWorkerPolicyModes.includes(params.workerPolicyMode as RoderWorkerPolicyMode))
      throw new Error(`workerPolicyMode must be one of ${roderWorkerPolicyModes.join(", ")}`);
    next.workerPolicyMode = params.workerPolicyMode as RoderWorkerPolicyMode;
  }
}

function branchName(issue: Issue | null): string {
  const suffix = randomUUID().slice(0, 8);
  return issue ? `roder/issue-${issue.number}-${suffix}` : `roder/worker-${suffix}`;
}

export function createRoderWorkers(options: Options) {
  const running = (roder: RoderAgent) => roder.workers.filter((worker) => worker.state === "running").length;

  function requireWorker(roder: RoderAgent, threadId: unknown): RoderWorker {
    const worker = roder.workers.find((entry) => entry.threadId === threadId);
    if (!worker)
      throw new Error(
        `Thread ${JSON.stringify(threadId)} is not one of this Roder's workers. Read your workers in the Roder detail or delegate a new one.`,
      );
    return worker;
  }

  /**
   * Queue positions, derived from the outbox: delegates whose start would not
   * fit in the free slots wait at 1, 2, ... in delegation order.
   */
  function markQueue(roder: RoderAgent) {
    let free = Math.max(0, roder.maxConcurrentWorkers - running(roder));
    let position = 0;
    const waiting = new Map<string, number | null>();
    for (const delivery of roder.outbox) {
      if (delivery.kind !== "start" || waiting.has(delivery.threadId)) continue;
      const worker = roder.workers.find((entry) => entry.threadId === delivery.threadId);
      if (worker?.state !== "queued") continue;
      if (free > 0) {
        free--;
        waiting.set(delivery.threadId, null);
      } else waiting.set(delivery.threadId, ++position);
    }
    for (const worker of roder.workers) worker.queuePosition = waiting.get(worker.threadId) ?? null;
  }

  function enqueue(roder: RoderAgent, worker: RoderWorker, kind: RoderWorkerDelivery["kind"], text: string) {
    roder.outbox.push({
      id: randomUUID(),
      threadId: worker.threadId,
      kind,
      text,
      createdAt: Date.now(),
      phase: "pending",
      turnsBefore: null,
      attempts: 0,
    });
    markQueue(roder);
  }

  async function linkedIssues(threadId: string): Promise<Issue[]> {
    if (!options.issues) return [];
    return (await options.issues.request("desktop/issues/list", { threadId })).issues;
  }

  async function context(roder: RoderAgent, worker: RoderWorker): Promise<string> {
    const rules = (await options.files.read(roder.id, RODER_WORKERS_FILE)).content;
    return roderWorkerContext({
      roder,
      worker,
      workersFile: roderFileExcerpt(RODER_WORKERS_FILE, rules, RODER_RULES_PROMPT_MAX_BYTES),
      issues: await linkedIssues(worker.threadId),
    });
  }

  const remove = (roder: RoderAgent, delivery: RoderWorkerDelivery) => {
    roder.outbox = roder.outbox.filter((entry) => entry !== delivery);
  };

  async function threadSnapshot(threadId: string, includeTurns: boolean) {
    const result = object(await options.request("thread/read", { threadId, includeTurns }), "thread/read result");
    if (!result.thread) throw new Error(`Worker thread ${threadId} is missing`);
    const thread = object(result.thread, "thread");
    return {
      idle: object(thread.status, "thread status").type === "idle",
      turns: Array.isArray(thread.turns) ? thread.turns.length : 0,
    };
  }

  /** Start one turn on an idle worker. Returns false when it has to wait. */
  async function deliver(roder: RoderAgent, worker: RoderWorker, delivery: RoderWorkerDelivery): Promise<boolean> {
    const snapshot = await threadSnapshot(worker.threadId, true);
    if (delivery.phase === "sending" && delivery.turnsBefore !== null && snapshot.turns > delivery.turnsBefore) {
      // An earlier attempt reached the thread before its result was recorded.
      remove(roder, delivery);
      worker.state = snapshot.idle ? "idle" : "running";
      return true;
    }
    if (!snapshot.idle) {
      // Someone else started a turn here (the user, in the thread's composer).
      worker.state = "running";
      return false;
    }
    delivery.phase = "sending";
    delivery.turnsBefore = snapshot.turns;
    delivery.attempts++;
    await options.persist();
    try {
      await options.request("turn/start", {
        threadId: worker.threadId,
        input: [{ type: "text", text: delivery.text }],
        developerContext: await context(roder, worker),
      });
    } catch (error) {
      worker.lastError = `Could not deliver to the worker (attempt ${delivery.attempts} of ${RODER_DELIVERY_ATTEMPTS}): ${message(error)}`;
      if (delivery.attempts >= RODER_DELIVERY_ATTEMPTS) {
        remove(roder, delivery);
        if (worker.state === "queued") worker.state = "idle";
      }
      return false;
    }
    remove(roder, delivery);
    worker.state = "running";
    worker.lastError = null;
    return true;
  }

  /** Make every delivery that may go out now, oldest first. */
  async function pump(roder: RoderAgent): Promise<void> {
    const waiting = new Set<string>();
    for (const delivery of roder.outbox) {
      const worker = roder.workers.find((entry) => entry.threadId === delivery.threadId);
      if (!worker) {
        remove(roder, delivery);
        continue;
      }
      if (delivery.kind === "stop") {
        try {
          await options.request("turn/interrupt", { threadId: worker.threadId });
        } catch (error) {
          worker.lastError = `Could not stop the worker: ${message(error)}`;
        }
        remove(roder, delivery);
        continue;
      }
      // Deliveries to one thread go in order; a busy thread takes the next one when it settles.
      if (waiting.has(worker.threadId) || worker.state === "running") {
        waiting.add(worker.threadId);
        continue;
      }
      if (running(roder) >= roder.maxConcurrentWorkers) {
        waiting.add(worker.threadId);
        continue;
      }
      try {
        if (!(await deliver(roder, worker, delivery))) waiting.add(worker.threadId);
      } catch (error) {
        // The thread couldn't be read: count it as an attempt so a missing thread doesn't retry forever.
        delivery.attempts++;
        worker.lastError = `Could not deliver to the worker (attempt ${delivery.attempts} of ${RODER_DELIVERY_ATTEMPTS}): ${message(error)}`;
        if (delivery.attempts >= RODER_DELIVERY_ATTEMPTS) {
          remove(roder, delivery);
          if (worker.state === "queued") worker.state = "idle";
        }
        waiting.add(worker.threadId);
      }
    }
    markQueue(roder);
    await options.persist();
  }

  return {
    pump,
    markQueue,
    context,

    /** The worker a thread is, with its Roder. */
    find(roders: RoderAgent[], threadId: unknown): { roder: RoderAgent; worker: RoderWorker } | null {
      for (const roder of roders) {
        const worker = roder.workers.find((entry) => entry.threadId === threadId);
        if (worker) return { roder, worker };
      }
      return null;
    },

    /**
     * Give a worker its own worktree and thread, register it and queue its
     * objective. The caller links the issue and pumps the outbox afterwards.
     */
    async delegate(
      roder: RoderAgent,
      input: {
        issue: Issue | null;
        objective: unknown;
        base?: unknown;
        model?: { modelProvider: string; model: string; reasoning?: string };
      },
    ): Promise<RoderWorker> {
      if (!options.startThread) throw new Error("Delegation to worker threads is unavailable in this build");
      const objective = string(input.objective, "worker objective", OBJECTIVE_MAX).trim();
      if (input.base !== undefined) string(input.base, "base", 200);
      if (roder.workers.length >= RODER_WORKER_LIMIT)
        throw new Error(
          `This Roder has ${RODER_WORKER_LIMIT} workers; release finished workers with releaseWorker before delegating more`,
        );
      const model = input.model ?? {
        ...(roder.modelProvider && roder.model ? { modelProvider: roder.modelProvider, model: roder.model } : {}),
        ...(roder.reasoning ? { reasoning: roder.reasoning } : {}),
      };
      const started = await options.startThread({
        workspaceId: roder.workspaceId,
        branch: branchName(input.issue),
        ...(input.base === undefined ? {} : { base: input.base as string }),
        ...model,
      });
      const threadId = string(started.threadId, "worker thread id", 500);
      if (threadId === roder.threadId || roder.workers.some((entry) => entry.threadId === threadId))
        throw new Error("The engine returned a thread that already works for this Roder");
      const worker: RoderWorker = {
        threadId,
        issueId: input.issue?.id ?? null,
        objective,
        worktreePath: started.worktreePath,
        branch: started.branch,
        base: started.base,
        state: "queued",
        queuePosition: null,
        followups: 0,
        hold: null,
        delegatedAt: Date.now(),
        lastError: null,
      };
      roder.workers.push(worker);
      enqueue(roder, worker, "start", roderWorkerMessage(roder, objective));
      await options.persist();
      return worker;
    },

    /**
     * Send a worker more work. Automatic messages count against
     * `maxFollowups` and can't resume a thread the user stopped; a message the
     * user sends (or asks the Roder to relay) resets the count.
     */
    async message(
      roder: RoderAgent,
      input: { threadId: unknown; text: unknown; automatic: unknown },
      from: "roder" | "user",
    ): Promise<RoderWorker> {
      const worker = requireWorker(roder, input.threadId);
      const text = string(input.text, "message", OBJECTIVE_MAX).trim();
      if (typeof input.automatic !== "boolean") throw new Error("automatic must be true or false");
      if (input.automatic) {
        if (worker.hold === "user")
          throw new Error(
            "The user stopped this worker, so only they can restart it. Don't retry; askUser on its issue whether to continue it. Once the user messages it, this clears",
          );
        if (worker.followups >= roder.maxFollowups)
          throw new Error(
            `automatic follow-up limit reached (${worker.followups} of ${roder.maxFollowups}); askUser before sending this thread more work`,
          );
        worker.followups++;
      } else {
        worker.followups = 0;
        worker.objective = text;
      }
      worker.hold = null;
      enqueue(roder, worker, "message", from === "user" ? text : roderWorkerMessage(roder, text));
      await options.persist();
      return worker;
    },

    /** Cancel what is still pending for a worker and interrupt its running turn. */
    async stop(roder: RoderAgent, threadId: unknown, by: "roder" | "user"): Promise<RoderWorker> {
      const worker = requireWorker(roder, threadId);
      // A stop by the user outranks one by the Roder.
      worker.hold = worker.hold === "user" ? "user" : by;
      roder.outbox = roder.outbox.filter((entry) => entry.threadId !== worker.threadId);
      if (worker.state === "running") enqueue(roder, worker, "stop", "");
      else worker.state = "idle";
      markQueue(roder);
      await options.persist();
      return worker;
    },

    /** Forget a worker. Its thread, worktree and issue links stay as they are. */
    async release(roder: RoderAgent, threadId: unknown): Promise<RoderWorker> {
      const worker = requireWorker(roder, threadId);
      roder.workers = roder.workers.filter((entry) => entry !== worker);
      roder.outbox = roder.outbox.filter((entry) => entry.threadId !== worker.threadId);
      markQueue(roder);
      await options.persist();
      return worker;
    },

    /** The user started a turn in a worker's own composer: that is a user message. */
    userTurn(roder: RoderAgent, worker: RoderWorker): void {
      worker.followups = 0;
      worker.hold = null;
      worker.state = "running";
      markQueue(roder);
    },

    /**
     * Track worker turns from engine notifications. Returns the Roder whose
     * worker changed; its outbox has been pumped.
     */
    async onNotification(roders: RoderAgent[], method: string, params: ObjectValue): Promise<RoderAgent | null> {
      if (method !== "turn/started" && method !== "turn/completed") return null;
      const found = this.find(roders, params.threadId);
      if (!found) return null;
      const { roder, worker } = found;
      if (method === "turn/started") {
        worker.state = "running";
        markQueue(roder);
        return roder;
      }
      worker.state = "idle";
      await options.onTurnSettled?.(roder, worker, params);
      await pump(roder);
      return roder;
    },

    /** Catch up on missed notifications: a running worker whose thread is idle has settled. */
    async reconcile(roder: RoderAgent): Promise<void> {
      for (const worker of roder.workers) {
        if (worker.state !== "running") continue;
        try {
          if ((await threadSnapshot(worker.threadId, false)).idle) {
            worker.state = "idle";
            await options.onTurnSettled?.(roder, worker, { threadId: worker.threadId });
          }
        } catch (error) {
          worker.lastError = message(error);
        }
      }
      await pump(roder);
    },
  };
}

export type RoderWorkers = ReturnType<typeof createRoderWorkers>;

/**
 * The host's `StartWorkerThread`: a new checkout on its own branch in the
 * Roder workspace's default folder, registered as a workspace folder, with a
 * persisted thread started in it. The primary checkout is not touched.
 */
export function roderWorkerThreadStarter(host: {
  worktrees: Pick<DesktopWorktrees, "startThreadInNewWorktree">;
  request: (method: string, params: unknown) => Promise<unknown>;
  /** Adds the desktop tools to the thread, as for every new thread. */
  threadStartParams?: (params: unknown) => Record<string, unknown>;
}): StartWorkerThread {
  return async (spec) => {
    const { workspaces } = (await host.request("workspace/list", {})) as { workspaces: Workspace[] };
    const workspace = workspaces.find((entry) => entry.id === spec.workspaceId);
    if (!workspace) throw new Error("The Roder's workspace no longer exists; link it to a workspace first");
    const started = await host.worktrees.startThreadInNewWorktree(
      { workspaceId: workspace.id, rootId: workspace.defaultRootId },
      { branch: spec.branch, ...(spec.base === undefined ? {} : { base: spec.base }) },
      (root) => {
        const params = {
          workspaceId: workspace.id,
          rootId: root.id,
          cwd: root.path,
          ephemeral: false,
          ...(spec.modelProvider && spec.model ? { modelProvider: spec.modelProvider, model: spec.model } : {}),
          ...(spec.reasoning ? { reasoning: spec.reasoning } : {}),
        };
        return host.request("thread/start", host.threadStartParams ? host.threadStartParams(params) : params);
      },
    );
    const thread = object(object(started.result, "thread/start result").thread, "started thread");
    return {
      threadId: string(thread.id, "worker thread id", 500),
      worktreePath: started.checkout.path,
      branch: started.checkout.branch ?? spec.branch,
      base: started.base,
    };
  };
}

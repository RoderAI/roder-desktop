import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { roderFilePaths, type RoderAgent, type RoderAgentDetail } from "../../src/types/roder-agents";
import { RODER_TURN_CONTEXT_START } from "../../src/lib/roder-turn-message";
import { roderThreadInstructions } from "./brief";
import {
  RODER_INSTRUCTIONS_FILE,
  RODER_NOTES_FILE,
  RODER_RULES_FILE,
  createRoderFileStore,
  roderInstructionsSummary,
} from "./files";
import { isRoderGuidePath, roderGuideFile, roderGuides, roderGuidePaths } from "./guide";
import { composeRoderTurn, createRoderTurnLedgers } from "./turn-prompt";
import type { createRoderAgentSpriteManager } from "./sprites";
import { roderCommandDescription, roderCommandToolSchema } from "./actions";
import { createRoderCommands } from "./commands";
import {
  RODER_WORKER_DEFAULTS,
  applyRoderWorkerSettings,
  createRoderWorkers,
  loadRoderWorkerState,
  type StartWorkerThread,
} from "./workers";
import type { Issue } from "../../src/types/issues";
import type { IssuesService } from "../issues/service";

type Options = {
  directory: string;
  request: (method: string, params: unknown) => Promise<unknown>;
  notify?: () => void;
  sprites?: ReturnType<typeof createRoderAgentSpriteManager>;
  /** The issue service a Roder's issue commands go through. */
  issues?: Pick<IssuesService, "request">;
  /** Makes a worker's git worktree and thread; without it, delegation is refused. */
  startWorker?: StartWorkerThread;
};
type ObjectValue = Record<string, unknown>;
/** The sprite manager's limit on persona name and mission text. */
const SPRITE_TEXT_MAX = 16000;
/** `value` cut to at most `max` UTF-16 units without splitting a surrogate pair. */
function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
  return value as ObjectValue;
}
function text(value: unknown, label: string, maximum = 16000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error(`Invalid ${label}`);
  return value;
}
function number(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`Invalid ${label}`);
  return value;
}

function runAllowance(value: unknown): number {
  if (!Number.isInteger(value)) throw new Error("Invalid daily budget: use a whole run count");
  return number(value, "daily budget", 1, 100);
}
function modelChoice(params: ObjectValue): Pick<RoderAgent, "modelProvider" | "model" | "reasoning"> {
  const choice: Pick<RoderAgent, "modelProvider" | "model" | "reasoning"> = {};
  if (params.modelProvider !== undefined) choice.modelProvider = text(params.modelProvider, "model provider", 500);
  if (params.model !== undefined) choice.model = text(params.model, "model", 500);
  if (params.reasoning !== undefined) choice.reasoning = text(params.reasoning, "reasoning", 100);
  if (!!choice.model !== !!choice.modelProvider) throw new Error("Choose both model and model provider");
  return choice;
}

export const roderAgentToolDefinitions = [
  {
    name: "roder_files",
    description:
      "Read your Roder's versioned files: INSTRUCTIONS.md (your purpose), AGENTS.md (the user's rules; only the user edits it), NOTES.md (your notes), WORKERS.md (rules for workers) and DIGEST.md, and the app's read-only guides under guide/. With no path, list every file with its current version and every guide. With path, read that file or guide, or an older version of a file with version. With path and history: true, list a file's versions newest first.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", enum: [...roderFilePaths, ...roderGuidePaths] },
        version: { type: "integer", minimum: 1 },
        history: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "roder_memory_read",
    description: "Read your Roder's NOTES.md and its current version.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "roder_command",
    description: roderCommandDescription(),
    parameters: roderCommandToolSchema(),
  },
  {
    name: "roder_issue",
    description:
      "Read your Roder's issue board: supply roderId to get every issue (descriptions shortened, recent activity) and the current revision. Supply roderId and issueId (its id or number) to read one issue in full, including its whole description and activity.",
    parameters: {
      type: "object",
      properties: {
        roderId: { type: "string", description: "Your Roder id." },
        issueId: { type: "string", description: "An issue id or number. Omit to read the whole board." },
      },
      required: ["roderId"],
      additionalProperties: false,
    },
  },
  {
    name: "roder_wake_schedule",
    description:
      "Persist a future wake for your Roder. Only runs when the user has enabled proactive work; user budgets always apply.",
    parameters: {
      type: "object",
      properties: { at: { type: "number", description: "Unix milliseconds" }, reason: { type: "string" } },
      required: ["at", "reason"],
      additionalProperties: false,
    },
  },
  {
    name: "roder_memory_query",
    description: "Search native project memory for your Roder's context.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "roder_memory_save",
    description: "Save a durable fact to your Roder's native thread memory for later semantic retrieval.",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
  },
] as const;

/** The thread an `item/completed` notification says was compacted, if that is what it reports. */
function compactedThread(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const params = value as ObjectValue;
  const event = params.event && typeof params.event === "object" ? (params.event as ObjectValue) : params;
  const item = event.item && typeof event.item === "object" ? (event.item as ObjectValue) : null;
  return item?.type === "compaction" && typeof params.threadId === "string" ? params.threadId : null;
}

export function createRoderAgentService(options: Options) {
  let roderAgents: RoderAgent[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let initialized = false;
  let persisted = "";
  let chain: Promise<unknown> = Promise.resolve();
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const result = chain.then(work);
    chain = result.catch(() => {});
    return result;
  }
  // Earlier builds kept memory in `<id>.md` beside roders.json. Those files are left on disk untouched and unread.
  const files = createRoderFileStore(join(options.directory, "files"));
  async function persist() {
    const contents = JSON.stringify({ version: 1, roders: roderAgents }, null, 2);
    if (contents === persisted) return;
    await writeFile(join(options.directory, "roders.json.tmp"), contents, { mode: 0o600 });
    await rename(join(options.directory, "roders.json.tmp"), join(options.directory, "roders.json"));
    persisted = contents;
    options.notify?.();
  }
  function find(id: unknown) {
    const c = roderAgents.find((entry) => entry.id === id);
    if (!c) throw new Error("Roder not found");
    return c;
  }
  const workers = createRoderWorkers({
    request: options.request,
    startThread: options.startWorker,
    files,
    issues: options.issues,
    persist,
  });
  // What each Roder's thread was sent last (turn-prompt.ts).
  const turns = createRoderTurnLedgers(join(options.directory, "turns"));
  const commands = createRoderCommands({
    directory: join(options.directory, "commands"),
    files,
    issues: options.issues,
    workers,
    async pause(c) {
      c.enabled = false;
      await persist();
    },
    async fileWritten(c, path) {
      const mission = c.mission;
      await syncMission(c, path);
      if (c.mission !== mission) await persist();
      else options.notify?.();
    },
    freshConversation,
  });
  async function detail(c: RoderAgent): Promise<RoderAgentDetail> {
    return structuredClone({
      ...c,
      sprite: options.sprites?.get(c.id) ?? null,
      files: await files.list(c.id),
    });
  }
  /** The turn for `message`: the brief and the board first, afterwards only what changed. Records what was sent. */
  async function composeTurn(c: RoderAgent, message: string, heading?: string): Promise<string> {
    const turn = composeRoderTurn({
      roder: c,
      previous: await turns.read(c.id, c.threadId),
      state: await commands.state(c),
      files: {
        rules: await files.read(c.id, RODER_RULES_FILE),
        instructions: await files.read(c.id, RODER_INSTRUCTIONS_FILE),
        notes: await files.read(c.id, RODER_NOTES_FILE),
      },
      message,
      heading,
    });
    await turns.write(c.id, turn.ledger);
    return turn.text;
  }
  /** One of the Roder's files, or one of the app's read-only guides. */
  async function readFileOrGuide(c: RoderAgent, path: unknown, version: unknown) {
    if (!isRoderGuidePath(path)) return files.read(c.id, path, version);
    if (version !== undefined) throw new Error("Guides have no versions");
    return roderGuideFile(path);
  }
  /**
   * Moves the Roder to a new thread started with the current tool set. Its
   * files, issues, budgets and wakes stay as they are; the old thread is kept
   * in `previousThreadIds` and is never changed.
   */
  async function freshConversation(c: RoderAgent): Promise<string> {
    const result = object(
      await options.request("thread/start", {
        workspaceId: c.workspaceId,
        ...(c.modelProvider ? { modelProvider: c.modelProvider } : {}),
        ...(c.model ? { model: c.model } : {}),
        ...(c.reasoning ? { reasoning: c.reasoning } : {}),
        ephemeral: false,
        developerInstructions: roderThreadInstructions,
      }),
    );
    const threadId = text(object(result.thread).id, "thread id", 500);
    if (roderAgents.some((entry) => entry.threadId === threadId || entry.previousThreadIds.includes(threadId)))
      throw new Error("The engine returned a thread a Roder already uses");
    const previous = c.threadId;
    // The Roder's board is the project linked to its thread, so the link moves with it.
    if (options.issues) {
      const { projects } = await options.issues.request("desktop/projects/list", {});
      for (const project of projects.filter((entry) => entry.roderThreadId === previous))
        await options.issues.request(
          "desktop/projects/update",
          { id: project.id, roderThreadId: threadId },
          { type: "user" },
        );
    }
    c.previousThreadIds.push(previous);
    c.threadId = threadId;
    // A run in the old thread no longer holds the Roder.
    c.active = null;
    await turns.forget(c.id);
    await persist();
    return threadId;
  }
  /**
   * Who the sprite is drawn from. The list `mission` can be empty (heading-only or cleared INSTRUCTIONS.md), but the
   * sprite manager needs non-empty text: use the full INSTRUCTIONS.md, else the name. Names are validated non-empty
   * on create and load, so a generic fallback can't be reached; null (skip generation) guards an unusable name.
   */
  async function spritePersona(c: RoderAgent) {
    const name = c.name.trim();
    if (!name || name.length > SPRITE_TEXT_MAX) return null;
    const instructions = (await files.read(c.id, RODER_INSTRUCTIONS_FILE)).content.trim();
    const mission = instructions ? clip(instructions, SPRITE_TEXT_MAX) : name;
    return { id: c.id, name, mission };
  }
  /** Keeps the list summary in step with INSTRUCTIONS.md; it is empty while that has no opening paragraph. */
  async function syncMission(c: RoderAgent, path: string) {
    if (path !== RODER_INSTRUCTIONS_FILE) return;
    c.mission = roderInstructionsSummary((await files.read(c.id, RODER_INSTRUCTIONS_FILE)).content);
  }
  function schedule(c: RoderAgent, params: ObjectValue) {
    if (c.wakes.length >= 50) throw new Error("At most 50 pending wakes per Roder");
    c.wakes.push({
      id: randomUUID(),
      at: number(params.at, "wake time", 0, Date.now() + 365 * 86400000),
      reason: text(params.reason, "reason", 2000),
    });
  }
  async function thread(c: RoderAgent) {
    const result = object(await options.request("thread/read", { threadId: c.threadId, includeTurns: true }));
    if (!result.thread)
      throw new Error("Roder thread is missing; history was not replaced. Restore it before running.");
    return object(result.thread);
  }
  async function interrupt(c: RoderAgent) {
    await options.request("turn/interrupt", {
      threadId: c.threadId,
      ...(c.active?.turnId ? { turnId: c.active.turnId } : {}),
    });
  }
  async function run(c: RoderAgent, reason: string, wakeIds: string[] = []) {
    c.runs = c.runs.filter((at) => at > Date.now() - 86400000);
    if (c.active) throw new Error("Roder already has an active run");
    if (c.runs.length >= c.maxRunsPerDay) throw new Error("Daily run budget reached (rolling 24 hours)");
    const snapshot = await thread(c);
    const status = object(snapshot.status);
    if (status.type !== "idle") throw new Error("Roder thread is busy; waiting for its current turn");
    let recall: unknown;
    try {
      recall = await options.request("memory/query", {
        scope: { Thread: c.threadId },
        text: c.mission ? `${c.mission}\n${reason}` : reason,
        limit: 5,
        includeGlobal: false,
      });
    } catch (error) {
      c.lastError = `Native memory recall unavailable: ${String(error)}`;
    }
    c.active = { turnId: null, startedAt: Date.now() };
    c.runs.push(Date.now());
    c.lastRunAt = Date.now();
    const consumedWakes = new Set(wakeIds);
    c.wakes = c.wakes.filter((w) => !consumedWakes.has(w.id));
    await persist();
    try {
      const turn = await composeTurn(
        c,
        `Roder wake: ${reason}\n\nNobody typed this: the app woke you. Review progress against your purpose and your board, do bounded useful work, record durable decisions in ${RODER_NOTES_FILE} with roder_command writeFile, and schedule a wake only when useful. Do not claim to run while the desktop is closed.`,
        "Wake",
      );
      const result = object(
        await options.request("turn/start", {
          threadId: c.threadId,
          policyMode: "bypass",
          ...(c.modelProvider ? { modelProvider: c.modelProvider } : {}),
          ...(c.model ? { model: c.model } : {}),
          ...(c.reasoning ? { reasoning: c.reasoning } : {}),
          input: [{ type: "text", text: turn }],
          developerContext: `Native memory recall:\n${JSON.stringify(recall ?? { unavailable: true })}`,
        }),
      );
      c.active.turnId = text(result.turnId, "turn id");
      await persist();
    } catch (error) {
      // The turn may never have reached the thread, so its next one starts over.
      await turns.forget(c.id).catch(() => {});
      c.lastError = `Run start is uncertain; paused for recovery: ${String(error)}`;
      c.enabled = false;
      await persist();
      throw error;
    }
  }
  async function tick() {
    return serial(async () => {
      if (!running) return;
      for (const c of roderAgents) {
        try {
          await workers.reconcile(c);
          if (c.active) {
            const snapshot = await thread(c);
            if (object(snapshot.status).type === "idle") c.active = null;
            else if (Date.now() - c.active.startedAt >= c.maxRunMinutes * 60000) {
              c.enabled = false;
              c.lastError = "Run time limit reached; paused. Interrupt requested; waiting for engine confirmation.";
              await interrupt(c);
            }
          }
          if (!c.enabled || c.active) continue;
          const due = c.wakes.filter((w) => w.at <= Date.now());
          const intervalDue = c.intervalMinutes > 0 && Date.now() - (c.lastRunAt ?? 0) >= c.intervalMinutes * 60000;
          if (!due.length && !intervalDue) continue;
          await run(
            c,
            due.length ? due.map((w) => w.reason).join("\n") : "Scheduled check-in",
            due.map((w) => w.id),
          );
        } catch (error) {
          c.lastError = String(error);
        }
      }
      await persist();
    });
  }
  async function handleRequest(method: string, value: unknown = {}): Promise<unknown> {
    return serial(async () => {
      const params = object(value);
      if (method === "desktop/roders/list")
        return structuredClone({
          roders: roderAgents.map((entry) => ({
            ...entry,
            sprite: options.sprites?.get(entry.id) ?? null,
          })),
        });
      if (method === "desktop/roders/create" || method === "desktop/roders/promote") {
        const name = text(params.name, "name", 120);
        const mission = text(params.mission, "mission");
        const workspaceId = text(params.workspaceId, "workspace id", 500);
        const choice = modelChoice(params);
        let snapshot: ObjectValue;
        if (method === "desktop/roders/promote") {
          const threadId = text(params.threadId, "thread id", 500);
          const existing = roderAgents.find((c) => c.threadId === threadId);
          if (existing) {
            if (existing.workspaceId !== workspaceId) throw new Error("Roder workspace does not match");
            return detail(existing);
          }
          const result = object(await options.request("thread/read", { threadId, includeTurns: false }));
          if (!result.thread) throw new Error("Existing persisted thread not found");
          snapshot = object(result.thread);
          if (snapshot.workspaceId !== workspaceId) throw new Error("Thread workspace does not match");
          if (object(snapshot.status).type !== "idle") throw new Error("Only an idle thread can become a Roder");
          const tools = new Set(
            Array.isArray(snapshot.externalTools) ? snapshot.externalTools.map((tool) => object(tool).name) : [],
          );
          if (roderAgentToolDefinitions.some((tool) => !tools.has(tool.name)))
            throw new Error(
              "This thread lacks Roder tools and cannot be upgraded in place by this engine. Create a new project Roder in the desktop; this existing thread and its history are unchanged.",
            );
          if (choice.model && choice.modelProvider) {
            const selected = object(
              await options.request("model/select", {
                threadId,
                selection: {
                  type: "manual",
                  provider: choice.modelProvider,
                  model: choice.model,
                  ...(choice.reasoning ? { reasoning: choice.reasoning } : {}),
                },
              }),
            );
            snapshot = { ...snapshot, reasoning: selected.reasoning };
          }
          snapshot = { ...snapshot, id: threadId };
        } else {
          const result = object(
            await options.request("thread/start", {
              workspaceId,
              ...choice,
              ephemeral: false,
              developerInstructions: roderThreadInstructions,
            }),
          );
          snapshot = {
            ...object(result.thread),
            ...modelChoice({ modelProvider: result.modelProvider, model: result.model, reasoning: result.reasoning }),
          };
        }
        const effectiveChoice = modelChoice({
          modelProvider: choice.modelProvider ?? snapshot.modelProvider,
          model: choice.model ?? snapshot.model,
          reasoning: choice.reasoning ?? snapshot.reasoning,
        });
        const c: RoderAgent = {
          id: randomUUID(),
          name,
          // The list summary, the same one later INSTRUCTIONS.md writes produce.
          mission: roderInstructionsSummary(mission),
          workspaceId,
          threadId: text(snapshot.id, "thread id"),
          previousThreadIds: [],
          ...effectiveChoice,
          enabled: false,
          intervalMinutes: 0,
          eventMethods: [],
          maxRunsPerDay: 5,
          maxRunMinutes: 10,
          runs: [],
          wakes: [],
          active: null,
          lastError: null,
          lastRunAt: null,
          sprite: null,
          ...RODER_WORKER_DEFAULTS,
          workers: [],
          outbox: [],
        };
        // New Roders start with every reserved file at version 1; INSTRUCTIONS.md holds the mission given at creation.
        await files.ensure(c.id, { [RODER_INSTRUCTIONS_FILE]: mission });
        roderAgents.push(c);
        await persist();
        const persona = options.sprites ? await spritePersona(c) : null;
        if (persona) await options.sprites?.enqueue(persona);
        return detail(c);
      }
      const c = find(params.id);
      if (method === "desktop/roders/sprite/read")
        return { image: (await options.sprites?.read(c.id)) ?? null, sprite: options.sprites?.get(c.id) ?? null };
      if (method === "desktop/roders/sprite/retry") {
        if (!options.sprites) throw Error("Character generation is unavailable");
        if (params.provider !== undefined && params.provider !== "codex" && params.provider !== "openai")
          throw Error("Invalid character generation provider");
        const persona = await spritePersona(c);
        if (!persona) return options.sprites.get(c.id) ?? null;
        return options.sprites.retry(persona, params.provider === "openai" ? "openai" : "codex");
      }
      if (method === "desktop/roders/read") return detail(c);
      if (method === "desktop/roders/files/list") return { files: await files.list(c.id) };
      if (method === "desktop/roders/files/read") return readFileOrGuide(c, params.path, params.version);
      if (method === "desktop/roders/files/history") return { versions: await files.history(c.id, params.path) };
      if (method === "desktop/roders/files/write" || method === "desktop/roders/files/restore") {
        const written =
          method === "desktop/roders/files/write"
            ? await files.write(c.id, {
                path: params.path,
                content: params.content,
                expectedVersion: params.expectedVersion,
                author: "user",
              })
            : await files.restore(c.id, {
                path: params.path,
                version: params.version,
                expectedVersion: params.expectedVersion,
                author: "user",
              });
        const mission = c.mission;
        await syncMission(c, written.path);
        if (c.mission !== mission) await persist();
        else options.notify?.();
        return written;
      }
      if (method === "desktop/roders/update") {
        if (params.mission !== undefined || params.memory !== undefined)
          throw new Error(
            "Mission and memory are Roder files now: write INSTRUCTIONS.md or NOTES.md with desktop/roders/files/write",
          );
        const next = { ...c };
        if (params.name !== undefined) next.name = text(params.name, "name", 120);
        if (params.enabled !== undefined) {
          if (typeof params.enabled !== "boolean") throw new Error("Invalid enabled state");
          next.enabled = params.enabled;
        }
        if (params.intervalMinutes !== undefined)
          next.intervalMinutes = number(params.intervalMinutes, "interval", 0, 525600);
        if (params.maxRunsPerDay !== undefined) next.maxRunsPerDay = runAllowance(params.maxRunsPerDay);
        if (params.maxRunMinutes !== undefined)
          next.maxRunMinutes = number(params.maxRunMinutes, "run time limit", 1, 60);
        if (params.eventMethods !== undefined) {
          if (!Array.isArray(params.eventMethods) || params.eventMethods.length > 20)
            throw new Error("Invalid event methods");
          next.eventMethods = params.eventMethods.map((m) => text(m, "event method", 120));
        }
        applyRoderWorkerSettings(next, params);
        Object.assign(c, next);
        await workers.pump(c);
        if (params.enabled === false && c.active) await interrupt(c);
      } else if (method === "desktop/roders/schedule") schedule(c, params);
      else if (method === "desktop/roders/cancelWake") c.wakes = c.wakes.filter((w) => w.id !== params.wakeId);
      else if (method === "desktop/roders/workers/message") {
        await workers.message(c, { threadId: params.threadId, text: params.text, automatic: false }, "user");
        await workers.pump(c);
      } else if (method === "desktop/roders/workers/stop") {
        await workers.stop(c, params.threadId, "user");
        await workers.pump(c);
      } else if (method === "desktop/roders/workers/release") await workers.release(c, params.threadId);
      else if (method === "desktop/roders/run")
        await run(c, text(params.reason ?? "User requested check-in", "reason", 2000));
      else if (method === "desktop/roders/compact") {
        if (c.active) throw new Error("Wait for the active run before compacting");
        const snapshot = await thread(c);
        const turnId = (snapshot.turns as { id: string }[] | undefined)?.at(-1)?.id;
        if (!turnId) throw new Error("No turn available to compact");
        const result = await options.request("thread/compact", {
          threadId: c.threadId,
          turnId,
          ...(c.mission ? { preserveHint: c.mission } : {}),
        });
        // The summary may have dropped the brief, so the next turn carries it again.
        await turns.forget(c.id);
        return result;
      } else if (method === "desktop/roders/freshConversation") {
        if (c.active) throw new Error("Wait for the active run, or pause it, before starting a fresh conversation");
        // A missing thread is a reason to start a fresh one; a busy one is not.
        const current = object(await options.request("thread/read", { threadId: c.threadId, includeTurns: false }));
        if (current.thread && object(object(current.thread).status).type !== "idle")
          throw new Error("Roder thread is busy; wait for its current turn before starting a fresh conversation");
        await freshConversation(c);
      } else throw new Error(`Unknown Roder request: ${method}`);
      await persist();
      return detail(c);
    });
  }
  /** A user turn in a worker's own composer: reset its follow-ups and give it the worker context. */
  async function workerTurnContext(threadId: string): Promise<string | null> {
    if (!workers.find(roderAgents, threadId)) return null;
    const found = await serial(async () => {
      const current = workers.find(roderAgents, threadId);
      if (current) {
        workers.userTurn(current.roder, current.worker);
        await persist();
      }
      return current;
    });
    return found ? workers.context(found.roder, found.worker) : null;
  }
  return {
    /** The permission mode for a worker thread's turns (decision D7); undefined for other threads. */
    policyModeForThread(threadId: unknown) {
      return workers.find(roderAgents, threadId)?.roder.workerPolicyMode;
    },
    /**
     * `issues_launch` on a Roder's project: the same path as delegate. Called
     * from inside the issue service's queue, which links the thread, makes it
     * the owner and moves the issue to in_progress itself, so the objective is
     * sent afterwards. Returns null when no Roder owns `roderThreadId`.
     */
    async launchIssue(roderThreadId: string, issue: Issue): Promise<{ threadId: string } | null> {
      return serial(async () => {
        const c = roderAgents.find((entry) => entry.threadId === roderThreadId);
        if (!c) return null;
        const worker = await workers.delegate(c, {
          issue,
          objective: `Work on issue #${issue.number}: ${issue.title}\n\n${issue.description}`.trim(),
        });
        void serial(() => workers.pump(c)).catch(() => {});
        return { threadId: worker.threadId };
      });
    },
    /**
     * Wraps a turn the user starts in a Roder's thread: its text becomes the
     * Roder turn (the brief and the board first, afterwards what changed, then
     * the user's message). Other threads' params are returned as they are. Call
     * `turnStartFailed` if the engine then refuses the turn.
     */
    async turnStartParams(params: unknown): Promise<unknown> {
      if (!params || typeof params !== "object" || Array.isArray(params)) return params;
      const input = params as ObjectValue;
      if (typeof input.threadId === "string") {
        // A turn in a worker's own thread: the user's message, with the worker context.
        const worker = await workerTurnContext(input.threadId);
        if (worker !== null) {
          const existing = typeof input.developerContext === "string" ? input.developerContext : "";
          return { ...input, developerContext: existing ? `${worker}\n\n${existing}` : worker };
        }
      }
      if (!roderAgents.some((entry) => entry.threadId === input.threadId)) return params;
      return serial(async () => {
        const c = roderAgents.find((entry) => entry.threadId === input.threadId);
        if (!c) return params;
        const items: unknown[] = Array.isArray(input.input) ? input.input : [];
        const at = items.findIndex(
          (item) => !!item && typeof item === "object" && (item as ObjectValue).type === "text",
        );
        const typed = at >= 0 ? (items[at] as ObjectValue).text : input.prompt;
        const message = typeof typed === "string" ? typed : "";
        if (message.startsWith(RODER_TURN_CONTEXT_START)) return { ...input, policyMode: "bypass" };
        const turn = await composeTurn(c, message);
        if (at >= 0)
          return {
            ...input,
            policyMode: "bypass",
            input: items.map((item, index) => (index === at ? { ...(item as ObjectValue), text: turn } : item)),
          };
        if (items.length) return { ...input, policyMode: "bypass", input: [{ type: "text", text: turn }, ...items] };
        return { ...input, policyMode: "bypass", prompt: turn };
      });
    },
    /** A turn prepared by `turnStartParams` never started: forget what it claimed to send. */
    async turnStartFailed(params: unknown): Promise<void> {
      const threadId = params && typeof params === "object" ? (params as ObjectValue).threadId : undefined;
      if (!roderAgents.some((entry) => entry.threadId === threadId)) return;
      await serial(async () => {
        const c = roderAgents.find((entry) => entry.threadId === threadId);
        if (c) await turns.forget(c.id);
      });
    },
    handleRequest,
    tick,
    async start() {
      if (running) return;
      await mkdir(options.directory, { recursive: true, mode: 0o700 });
      await options.sprites?.initialize();
      try {
        const saved = JSON.parse(await readFile(join(options.directory, "roders.json"), "utf8"));
        if (saved.version !== 1 || !Array.isArray(saved.roders))
          throw new Error("Invalid Roder state; refusing to overwrite it");
        const loaded: RoderAgent[] = saved.roders;
        const ids = new Set<string>();
        const threads = new Set<string>();
        for (const entry of loaded) {
          const c = object(entry);
          if (typeof c.id !== "string" || !/^[a-f0-9-]{36}$/.test(c.id) || ids.has(c.id))
            throw new Error("Invalid or duplicate Roder id");
          ids.add(c.id);
          const threadId = text(c.threadId, "thread id", 500);
          // Roders saved before fresh conversations existed have no previous threads.
          c.previousThreadIds ??= [];
          if (!Array.isArray(c.previousThreadIds)) throw new Error("Invalid Roder previous threads");
          for (const id of [threadId, ...c.previousThreadIds.map((v) => text(v, "previous thread id", 500))]) {
            if (threads.has(id)) throw new Error("Duplicate Roder thread");
            threads.add(id);
          }
          text(c.name, "name", 120);
          // Empty while INSTRUCTIONS.md has no opening paragraph.
          if (typeof c.mission !== "string" || c.mission.length > 16000) throw new Error("Invalid mission");
          text(c.workspaceId, "workspace id", 500);
          modelChoice(c);
          if (typeof c.enabled !== "boolean") throw new Error("Invalid Roder enabled state");
          number(c.intervalMinutes, "interval", 0, 525600);
          runAllowance(c.maxRunsPerDay);
          number(c.maxRunMinutes, "run time limit", 1, 60);
          if (!Array.isArray(c.eventMethods) || c.eventMethods.length > 20) throw new Error("Invalid Roder events");
          c.eventMethods.forEach((v) => text(v, "event method", 120));
          if (!Array.isArray(c.runs)) throw new Error("Invalid Roder budget ledger");
          c.runs.forEach((v) => number(v, "run timestamp", 0, Number.MAX_SAFE_INTEGER));
          if (!Array.isArray(c.wakes) || c.wakes.length > 50) throw new Error("Invalid Roder wakes");
          c.wakes.forEach((w) => {
            const wake = object(w);
            text(wake.id, "wake id", 500);
            number(wake.at, "wake timestamp", 0, Number.MAX_SAFE_INTEGER);
            text(wake.reason, "wake reason", 2000);
          });
          if (c.active !== null) {
            const active = object(c.active);
            if (active.turnId !== null) text(active.turnId, "active turn id", 500);
            number(active.startedAt, "active timestamp", 0, Number.MAX_SAFE_INTEGER);
          }
          if (c.lastRunAt !== null) number(c.lastRunAt, "last run", 0, Number.MAX_SAFE_INTEGER);
          if (c.lastError !== null && typeof c.lastError !== "string") throw new Error("Invalid Roder error");
          loadRoderWorkerState(c);
        }
        roderAgents = loaded;
        persisted = JSON.stringify({ version: 1, roders: roderAgents }, null, 2);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      running = true;
      initialized = true;
      await tick();
      timer = setInterval(() => {
        void tick().catch(() => {});
      }, 15000);
      timer.unref?.();
    },
    async stop() {
      if (!initialized) return;
      options.sprites?.stop();
      running = false;
      clearInterval(timer);
      await serial(async () => {
        for (const c of roderAgents)
          if (c.active) {
            try {
              await interrupt(c);
            } catch (error) {
              c.lastError = `Shutdown interrupt failed: ${String(error)}`;
            }
          }
        await persist();
      });
    },
    async onNotification(method: string, value: unknown) {
      // The engine compacted a Roder's thread: the summary may have dropped the brief.
      const compacted = method === "item/completed" ? compactedThread(value) : null;
      if (compacted !== null) {
        const c = roderAgents.find((entry) => entry.threadId === compacted);
        if (c) await serial(() => turns.forget(c.id));
      }
      const forWorker =
        method === "turn/started" && !!workers.find(roderAgents, (value as ObjectValue | null)?.threadId);
      if (
        method !== "turn/completed" &&
        !forWorker &&
        !roderAgents.some((c) => c.enabled && c.eventMethods.includes(method))
      )
        return;
      return serial(async () => {
        const params = object(value);
        await workers.onNotification(roderAgents, method, params);
        for (const c of roderAgents) {
          if (params.threadId === c.threadId) {
            if (
              method === "turn/completed" &&
              c.active &&
              (!c.active.turnId || object(params.turn).id === c.active.turnId)
            )
              c.active = null;
            continue;
          }
          if (
            c.enabled &&
            c.eventMethods.includes(method) &&
            !c.wakes.some((w) => w.reason === `Event: ${method}`) &&
            c.wakes.length < 50
          )
            schedule(c, { at: Date.now(), reason: `Event: ${method}` });
        }
        await persist();
      });
    },
    async handleTool(name: string, value: unknown, context: { threadId: string }): Promise<unknown> {
      return serial(async () => {
        const c = roderAgents.find((entry) => entry.threadId === context.threadId);
        const params = object(value);
        if (!c) {
          const found = workers.find(roderAgents, context.threadId);
          if (!found) {
            const moved = roderAgents.find((entry) => entry.previousThreadIds.includes(context.threadId));
            if (moved)
              throw new Error(
                `This thread is a previous conversation of the Roder ${moved.name}. Its tools work only in its current thread; end your turn`,
              );
            throw new Error("Tool requires an owning Roder thread");
          }
          if (name !== "roder_command")
            throw new Error(
              `A worker thread may use only roder_command (commentIssue and linkIssuePullRequest on its own issues); ${name} is the Roder's`,
            );
          return commands.command(found.roder, params, { type: "worker", threadId: context.threadId });
        }
        if (name === "roder_files") {
          if (params.path === undefined) {
            if (params.history !== undefined || params.version !== undefined)
              throw new Error("history and version need a path");
            return {
              files: await files.list(c.id),
              guides: roderGuides().map(({ path, when }) => ({ path, readOnly: true, when })),
            };
          }
          if (params.history === true) {
            if (isRoderGuidePath(params.path)) throw new Error("Guides have no versions");
            if (params.version !== undefined) throw new Error("Use either history or version, not both");
            return { path: params.path, versions: await files.history(c.id, params.path) };
          }
          return readFileOrGuide(c, params.path, params.version);
        }
        if (name === "roder_memory_read") {
          const notes = await files.read(c.id, RODER_NOTES_FILE);
          return { memory: notes.content, path: notes.path, version: notes.version };
        }
        if (name === "roder_command") {
          const result = await commands.command(c, params);
          if (c.outbox.length) await workers.pump(c).catch((error) => (c.lastError = String(error)));
          return result;
        }
        if (name === "roder_issue") return commands.issue(c, params);
        if (name === "roder_wake_schedule") {
          schedule(c, params);
          await persist();
          return { scheduled: true };
        }
        if (name === "roder_memory_query")
          return options.request("memory/query", {
            scope: { Thread: c.threadId },
            text: text(params.query, "query", 2000),
            limit: 5,
            includeGlobal: false,
          });
        if (name === "roder_memory_save")
          return options.request("memory/save", {
            scope: { Thread: c.threadId },
            text: text(params.text, "memory text", 16000),
            metadata: { source: "desktop-roder", roderId: c.id },
          });
        throw new Error(`Unknown Roder tool: ${name}`);
      });
    },
  };
}

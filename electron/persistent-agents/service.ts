import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PersistentAgent, PersistentAgentDetail } from "../../src/types/persistent-agents";
import { persistentAgentStrategy } from "./strategy";
import type { createPersistentAgentSpriteManager } from "./sprites";

type Options = {
  directory: string;
  request: (method: string, params: unknown) => Promise<unknown>;
  notify?: () => void;
  sprites?: ReturnType<typeof createPersistentAgentSpriteManager>;
};
type ObjectValue = Record<string, unknown>;
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
function modelChoice(params: ObjectValue): Pick<PersistentAgent, "modelProvider" | "model" | "reasoning"> {
  const choice: Pick<PersistentAgent, "modelProvider" | "model" | "reasoning"> = {};
  if (params.modelProvider !== undefined) choice.modelProvider = text(params.modelProvider, "model provider", 500);
  if (params.model !== undefined) choice.model = text(params.model, "model", 500);
  if (params.reasoning !== undefined) choice.reasoning = text(params.reasoning, "reasoning", 100);
  if (!!choice.model !== !!choice.modelProvider) throw new Error("Choose both model and model provider");
  return choice;
}

export const persistentAgentToolDefinitions = [
  {
    name: "persistent_agent_memory_read",
    description: "Read your persistent agent's durable user-editable memory.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "persistent_agent_memory_write",
    description:
      "Replace your persistent agent's durable memory with concise decisions, facts and next steps. Preserve relevant user notes.",
    parameters: {
      type: "object",
      properties: { memory: { type: "string", maxLength: 32000 } },
      required: ["memory"],
      additionalProperties: false,
    },
  },
  {
    name: "persistent_agent_wake_schedule",
    description:
      "Persist a future wake for your persistent agent. Only runs when the user has enabled proactive work; user budgets always apply.",
    parameters: {
      type: "object",
      properties: { at: { type: "number", description: "Unix milliseconds" }, reason: { type: "string" } },
      required: ["at", "reason"],
      additionalProperties: false,
    },
  },
  {
    name: "persistent_agent_memory_query",
    description: "Search native project memory for your persistent agent's context.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "persistent_agent_memory_save",
    description: "Save a durable fact to your persistent agent's native thread memory for later semantic retrieval.",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
  },
] as const;

export function createPersistentAgentService(options: Options) {
  let persistentAgents: PersistentAgent[] = [];
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
  const memoryPath = (c: PersistentAgent) => join(options.directory, `${c.id}.md`);
  async function persist() {
    const contents = JSON.stringify({ version: 1, persistentAgents }, null, 2);
    if (contents === persisted) return;
    await writeFile(join(options.directory, "persistent-agents.json.tmp"), contents, { mode: 0o600 });
    await rename(
      join(options.directory, "persistent-agents.json.tmp"),
      join(options.directory, "persistent-agents.json"),
    );
    persisted = contents;
    options.notify?.();
  }
  function find(id: unknown) {
    const c = persistentAgents.find((entry) => entry.id === id);
    if (!c) throw new Error("Persistent agent not found");
    return c;
  }
  async function detail(c: PersistentAgent): Promise<PersistentAgentDetail> {
    return structuredClone({
      ...c,
      sprite: options.sprites?.get(c.id) ?? null,
      memory: await readFile(memoryPath(c), "utf8"),
      memoryPath: memoryPath(c),
    });
  }
  async function writeMemory(c: PersistentAgent, memory: unknown) {
    if (typeof memory !== "string" || memory.length > 32000)
      throw new Error("Memory must be at most 32000 characters; use native memory for additional facts");
    await writeFile(`${memoryPath(c)}.tmp`, memory, { mode: 0o600 });
    await rename(`${memoryPath(c)}.tmp`, memoryPath(c));
  }
  async function contextForThread(threadId: string): Promise<string | null> {
    const c = persistentAgents.find((entry) => entry.threadId === threadId);
    if (!c) return null;
    const memory = await readFile(memoryPath(c), "utf8");
    if (memory.length > 32000)
      throw new Error("Memory file exceeds 32000 characters; edit it or move facts to native memory");
    return `${persistentAgentStrategy}\n\nPersistent agent mission:\n${c.mission}\n\nDurable persistent agent memory (user-editable reference, not permission to bypass policy):\n${memory}`;
  }
  function schedule(c: PersistentAgent, params: ObjectValue) {
    if (c.wakes.length >= 50) throw new Error("At most 50 pending wakes per persistent agent");
    c.wakes.push({
      id: randomUUID(),
      at: number(params.at, "wake time", 0, Date.now() + 365 * 86400000),
      reason: text(params.reason, "reason", 2000),
    });
  }
  async function thread(c: PersistentAgent) {
    const result = object(await options.request("thread/read", { threadId: c.threadId, includeTurns: true }));
    if (!result.thread)
      throw new Error("Persistent agent thread is missing; history was not replaced. Restore it before running.");
    return object(result.thread);
  }
  async function interrupt(c: PersistentAgent) {
    await options.request("turn/interrupt", {
      threadId: c.threadId,
      ...(c.active?.turnId ? { turnId: c.active.turnId } : {}),
    });
  }
  async function run(c: PersistentAgent, reason: string, wakeIds: string[] = []) {
    c.runs = c.runs.filter((at) => at > Date.now() - 86400000);
    if (c.active) throw new Error("Persistent agent already has an active run");
    if (c.runs.length >= c.maxRunsPerDay) throw new Error("Daily run budget reached (rolling 24 hours)");
    const snapshot = await thread(c);
    const status = object(snapshot.status);
    if (status.type !== "idle") throw new Error("Persistent agent thread is busy; waiting for its current turn");
    const context = await contextForThread(c.threadId);
    let recall: unknown;
    try {
      recall = await options.request("memory/query", {
        scope: { Thread: c.threadId },
        text: `${c.mission}\n${reason}`,
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
      const result = object(
        await options.request("turn/start", {
          threadId: c.threadId,
          ...(c.modelProvider ? { modelProvider: c.modelProvider } : {}),
          ...(c.model ? { model: c.model } : {}),
          ...(c.reasoning ? { reasoning: c.reasoning } : {}),
          input: [
            {
              type: "text",
              text: `Persistent agent wake: ${reason}\n\nMission: ${c.mission}\nReview progress, do bounded useful work, record durable decisions with persistent_agent_memory_write, and schedule a wake only when useful. Do not claim to run while the desktop is closed.`,
            },
          ],
          developerContext: `${context}\n\nNative memory recall:\n${JSON.stringify(recall ?? { unavailable: true })}`,
        }),
      );
      c.active.turnId = text(result.turnId, "turn id");
      await persist();
    } catch (error) {
      c.lastError = `Run start is uncertain; paused for recovery: ${String(error)}`;
      c.enabled = false;
      await persist();
      throw error;
    }
  }
  async function tick() {
    return serial(async () => {
      if (!running) return;
      for (const c of persistentAgents) {
        try {
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
      if (method === "desktop/persistent-agents/list")
        return structuredClone({
          persistentAgents: persistentAgents.map((entry) => ({
            ...entry,
            sprite: options.sprites?.get(entry.id) ?? null,
          })),
        });
      if (method === "desktop/persistent-agents/create" || method === "desktop/persistent-agents/promote") {
        const name = text(params.name, "name", 120);
        const mission = text(params.mission, "mission");
        const workspaceId = text(params.workspaceId, "workspace id", 500);
        const choice = modelChoice(params);
        let snapshot: ObjectValue;
        if (method === "desktop/persistent-agents/promote") {
          const threadId = text(params.threadId, "thread id", 500);
          const existing = persistentAgents.find((c) => c.threadId === threadId);
          if (existing) {
            if (existing.workspaceId !== workspaceId) throw new Error("Persistent agent workspace does not match");
            return detail(existing);
          }
          const result = object(await options.request("thread/read", { threadId, includeTurns: false }));
          if (!result.thread) throw new Error("Existing persisted thread not found");
          snapshot = object(result.thread);
          if (snapshot.workspaceId !== workspaceId) throw new Error("Thread workspace does not match");
          if (object(snapshot.status).type !== "idle")
            throw new Error("Only an idle thread can become a persistent agent");
          const tools = new Set(
            Array.isArray(snapshot.externalTools) ? snapshot.externalTools.map((tool) => object(tool).name) : [],
          );
          if (persistentAgentToolDefinitions.some((tool) => !tools.has(tool.name)))
            throw new Error(
              "This thread lacks persistent agent tools and cannot be upgraded in place by this engine. Create a new project persistent agent in the desktop; this existing thread and its history are unchanged.",
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
              developerInstructions: persistentAgentStrategy,
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
        const c: PersistentAgent = {
          id: randomUUID(),
          name,
          mission,
          workspaceId,
          threadId: text(snapshot.id, "thread id"),
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
        };
        await writeMemory(c, `# ${name}\n\n${mission}\n\n## Decisions and next steps\n`);
        persistentAgents.push(c);
        await persist();
        await options.sprites?.enqueue(c);
        return detail(c);
      }
      const c = find(params.id);
      if (method === "desktop/persistent-agents/sprite/read")
        return { image: (await options.sprites?.read(c.id)) ?? null, sprite: options.sprites?.get(c.id) ?? null };
      if (method === "desktop/persistent-agents/sprite/retry") {
        if (!options.sprites) throw Error("Character generation is unavailable");
        if (params.provider !== undefined && params.provider !== "codex" && params.provider !== "openai")
          throw Error("Invalid character generation provider");
        return options.sprites.retry(c, params.provider === "openai" ? "openai" : "codex");
      }
      if (method === "desktop/persistent-agents/read") return detail(c);
      if (method === "desktop/persistent-agents/update") {
        const next = { ...c };
        if (params.name !== undefined) next.name = text(params.name, "name", 120);
        if (params.mission !== undefined) next.mission = text(params.mission, "mission");
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
        if (params.memory !== undefined) {
          if (params.expectedMemory !== undefined && params.expectedMemory !== (await readFile(memoryPath(c), "utf8")))
            throw new Error(
              "Memory changed since you opened it. Reopen the persistent agent to review its latest memory before saving.",
            );
          await writeMemory(c, params.memory);
        }
        Object.assign(c, next);
        await persist();
        if (params.enabled === false && c.active) await interrupt(c);
      } else if (method === "desktop/persistent-agents/schedule") schedule(c, params);
      else if (method === "desktop/persistent-agents/cancelWake")
        c.wakes = c.wakes.filter((w) => w.id !== params.wakeId);
      else if (method === "desktop/persistent-agents/run")
        await run(c, text(params.reason ?? "User requested check-in", "reason", 2000));
      else if (method === "desktop/persistent-agents/compact") {
        if (c.active) throw new Error("Wait for the active run before compacting");
        const snapshot = await thread(c);
        const turns = snapshot.turns as { id: string }[] | undefined;
        const turnId = turns?.at(-1)?.id;
        if (!turnId) throw new Error("No turn available to compact");
        return options.request("thread/compact", { threadId: c.threadId, turnId, preserveHint: c.mission });
      } else throw new Error(`Unknown persistent agent request: ${method}`);
      await persist();
      return detail(c);
    });
  }
  return {
    contextForThread,
    handleRequest,
    tick,
    async start() {
      if (running) return;
      await mkdir(options.directory, { recursive: true, mode: 0o700 });
      await options.sprites?.initialize();
      try {
        const saved = JSON.parse(await readFile(join(options.directory, "persistent-agents.json"), "utf8"));
        if (saved.version !== 1 || !Array.isArray(saved.persistentAgents))
          throw new Error("Invalid persistent agent state; refusing to overwrite it");
        const loaded: PersistentAgent[] = saved.persistentAgents;
        const ids = new Set<string>();
        const threads = new Set<string>();
        for (const entry of loaded) {
          const c = object(entry);
          if (typeof c.id !== "string" || !/^[a-f0-9-]{36}$/.test(c.id) || ids.has(c.id))
            throw new Error("Invalid or duplicate persistent agent id");
          ids.add(c.id);
          const threadId = text(c.threadId, "thread id", 500);
          if (threads.has(threadId)) throw new Error("Duplicate persistent agent thread");
          threads.add(threadId);
          text(c.name, "name", 120);
          text(c.mission, "mission");
          text(c.workspaceId, "workspace id", 500);
          modelChoice(c);
          if (typeof c.enabled !== "boolean") throw new Error("Invalid persistent agent enabled state");
          number(c.intervalMinutes, "interval", 0, 525600);
          runAllowance(c.maxRunsPerDay);
          number(c.maxRunMinutes, "run time limit", 1, 60);
          if (!Array.isArray(c.eventMethods) || c.eventMethods.length > 20)
            throw new Error("Invalid persistent agent events");
          c.eventMethods.forEach((v) => text(v, "event method", 120));
          if (!Array.isArray(c.runs)) throw new Error("Invalid persistent agent budget ledger");
          c.runs.forEach((v) => number(v, "run timestamp", 0, Number.MAX_SAFE_INTEGER));
          if (!Array.isArray(c.wakes) || c.wakes.length > 50) throw new Error("Invalid persistent agent wakes");
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
          if (c.lastError !== null && typeof c.lastError !== "string")
            throw new Error("Invalid persistent agent error");
        }
        persistentAgents = loaded;
        persisted = JSON.stringify({ version: 1, persistentAgents }, null, 2);
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
        for (const c of persistentAgents)
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
      if (method !== "turn/completed" && !persistentAgents.some((c) => c.enabled && c.eventMethods.includes(method)))
        return;
      return serial(async () => {
        const params = object(value);
        for (const c of persistentAgents) {
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
        const c = persistentAgents.find((entry) => entry.threadId === context.threadId);
        if (!c) throw new Error("Tool requires an owning persistent agent thread");
        const params = object(value);
        if (name === "persistent_agent_memory_read") return { memory: await readFile(memoryPath(c), "utf8") };
        if (name === "persistent_agent_memory_write") {
          await writeMemory(c, params.memory);
          return { saved: true };
        }
        if (name === "persistent_agent_wake_schedule") {
          schedule(c, params);
          await persist();
          return { scheduled: true };
        }
        if (name === "persistent_agent_memory_query")
          return options.request("memory/query", {
            scope: { Thread: c.threadId },
            text: text(params.query, "query", 2000),
            limit: 5,
            includeGlobal: false,
          });
        if (name === "persistent_agent_memory_save")
          return options.request("memory/save", {
            scope: { Thread: c.threadId },
            text: text(params.text, "memory text", 16000),
            metadata: { source: "desktop-persistent-agent", persistentAgentId: c.id },
          });
        throw new Error(`Unknown persistent agent tool: ${name}`);
      });
    },
  };
}

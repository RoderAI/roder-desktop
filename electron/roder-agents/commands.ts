// `roder_command` and `roder_issue`, modelled on Zuse's `command_as` and
// `check_revision` (crates/engine/src/zappers.rs). Decision D5: no SQLite. Each
// Roder has one JSON ledger holding its revision, the revision at which each
// target last changed, and a bounded ledger of receipts. The Roder service
// calls in here from its one serialized queue, so commands never interleave.
//
// A command records a pending receipt, applies its action through the issue
// service or the file store, then records the result. A failed action leaves
// nothing behind and may be retried with the same commandId. A crash between
// applying and recording leaves the receipt pending: a retry is refused with
// what to re-read, rather than applied twice.
//
// Revisions cover every change to what a Roder works on, not only its own
// commands: before each command or read, the current issues and files are
// compared with what the ledger saw last, so a person's edit in the app moves
// the revision too and stale writes against it conflict.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Issue, IssueActor, IssueProject } from "../../src/types/issues";
import type { RoderAgent, RoderFilePath } from "../../src/types/roder-agents";
import {
  fileTarget,
  issueTarget,
  parseRoderAction,
  roderActionScope,
  roderIssueDetailsSchema,
  type RoderAction,
  type RoderActionType,
} from "./actions";
import type { RoderFileStore } from "./files";
import type { RoderWorkers } from "./workers";
import type { IssuesService } from "../issues/service";

/** Receipts kept per Roder; the oldest are dropped first. */
export const RODER_RECEIPT_LIMIT = 256;
const BOARD_DESCRIPTION_MAX = 500;
const BOARD_ACTIVITY = 3;
const RESULT_ACTIVITY = 5;

type Receipt = { commandId: string; input: string; state: "pending" | "applied"; result?: unknown };
type Ledger = {
  version: 1;
  revision: number;
  /** For each issue and file: the revision it last changed at, and what it looked like then. */
  targets: Record<string, { revision: number; fingerprint: string }>;
  receipts: Receipt[];
};
type Outcome = Record<string, unknown> & { summary: string };
type ObjectValue = Record<string, unknown>;

export type RoderCommandOptions = {
  directory: string;
  files: RoderFileStore;
  issues?: Pick<IssuesService, "request">;
  /** Pause the Roder and persist it. */
  pause: (roder: RoderAgent) => Promise<void>;
  /** Called after a Roder's command writes one of its files. */
  fileWritten: (roder: RoderAgent, path: RoderFilePath) => Promise<void>;
  /** The Roder's worker registry (electron/roder-agents/workers.ts). */
  workers?: Pick<RoderWorkers, "delegate" | "message" | "stop" | "release">;
};

/** What a worker thread may do with roder_command (Zuse `crates/engine/src/rpc/zappers.rs`). */
export const RODER_WORKER_ACTIONS: readonly RoderActionType[] = ["commentIssue", "linkIssuePullRequest"];

/** Who sends a command: the Roder's own thread, or one of its worker threads. */
export type RoderCommandCaller = { type: "roder" } | { type: "worker"; threadId: string };

function object(value: unknown, label: string): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as ObjectValue;
}

/** JSON with object keys sorted, so equal inputs compare equal whatever their key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .filter((key) => (value as ObjectValue)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical((value as ObjectValue)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex").slice(0, 32);

/** What an issue's revision tracks: its details, not its activity or links (Zuse `record_changes`). */
const issueFingerprint = (issue: Issue) =>
  digest({
    projectId: issue.projectId,
    title: issue.title,
    description: issue.description,
    status: issue.status,
    priority: issue.priority,
    owner: issue.owner,
    doneCriteria: issue.doneCriteria,
    outOfScope: issue.outOfScope,
    parent: issue.parent,
  });

/** Issue-service errors name the issues_* tools; a Roder uses roder_command actions. */
function roderIssueError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(
    message
      .replaceAll("issues_ask_user", "roder_command askUser")
      .replaceAll("issues_close", "roder_command closeIssue")
      .replaceAll("issues_link_pull_request", "roder_command linkIssuePullRequest"),
  );
}

function boardIssue(issue: Issue) {
  const { activity, description, ...rest } = issue;
  return {
    ...rest,
    description:
      description.length > BOARD_DESCRIPTION_MAX
        ? `${description.slice(0, BOARD_DESCRIPTION_MAX)}… [read it in full with roder_issue {issueId: "${issue.id}"}]`
        : description,
    activityCount: activity.length,
    recentActivity: activity.slice(-BOARD_ACTIVITY),
  };
}

function resultIssue(issue: Issue) {
  const { activity, ...rest } = issue;
  return { ...rest, activityCount: activity.length, recentActivity: activity.slice(-RESULT_ACTIVITY) };
}

export function createRoderCommands(options: RoderCommandOptions) {
  const ledgers = new Map<string, Ledger>();
  const ledgerPath = (roderId: string) => join(options.directory, `${roderId}.json`);

  async function load(roder: RoderAgent): Promise<Ledger> {
    const cached = ledgers.get(roder.id);
    if (cached) return cached;
    let ledger: Ledger;
    try {
      ledger = JSON.parse(await readFile(ledgerPath(roder.id), "utf8")) as Ledger;
      if (
        ledger?.version !== 1 ||
        !Number.isSafeInteger(ledger.revision) ||
        !ledger.targets ||
        typeof ledger.targets !== "object" ||
        !Array.isArray(ledger.receipts)
      )
        throw new Error("Invalid Roder command ledger; refusing to overwrite it");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // Tracking starts here: what exists now is the baseline at revision 0.
      ledger = { version: 1, revision: 0, targets: {}, receipts: [] };
      for (const [target, fingerprint] of await fingerprints(roder))
        ledger.targets[target] = { revision: 0, fingerprint };
      await save(roder, ledger);
    }
    ledgers.set(roder.id, ledger);
    return ledger;
  }
  async function save(roder: RoderAgent, ledger: Ledger) {
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    const path = ledgerPath(roder.id);
    await writeFile(`${path}.tmp`, JSON.stringify(ledger, null, 2), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  }

  function issues() {
    if (!options.issues) throw new Error("Issues are unavailable in this build");
    return options.issues;
  }
  /** The Roder's board: the project created with it, linked by its thread. */
  async function project(roder: RoderAgent): Promise<IssueProject | null> {
    if (!options.issues) return null;
    const { projects } = await options.issues.request("desktop/projects/list", {});
    const linked = projects.filter((entry) => entry.roderThreadId === roder.threadId);
    return linked.find((entry) => !entry.archived) ?? linked[0] ?? null;
  }
  async function requireProject(roder: RoderAgent): Promise<IssueProject> {
    const found = await project(roder);
    if (!found)
      throw new Error("This Roder has no issue board: no project is linked to its thread. Ask the user to link one.");
    return found;
  }
  async function board(roder: RoderAgent): Promise<{ project: IssueProject | null; issues: Issue[] }> {
    const found = await project(roder);
    if (!found) return { project: null, issues: [] };
    const { issues: list } = await issues().request("desktop/issues/list", { projectId: found.id });
    return { project: found, issues: list };
  }
  async function fingerprints(roder: RoderAgent): Promise<Map<string, string>> {
    const current = new Map<string, string>();
    for (const issue of (await board(roder)).issues) current.set(issueTarget(issue.id), issueFingerprint(issue));
    for (const file of await options.files.list(roder.id)) current.set(fileTarget(file.path), String(file.version));
    return current;
  }
  /**
   * Stamp every target that changed since the ledger last looked. With no
   * `revision`, changes made outside this Roder's commands get a revision of
   * their own; returns whether anything changed.
   */
  async function observe(roder: RoderAgent, ledger: Ledger, revision?: number): Promise<boolean> {
    const current = await fingerprints(roder);
    const changed: [string, string][] = [];
    for (const [target, fingerprint] of current)
      if (ledger.targets[target]?.fingerprint !== fingerprint) changed.push([target, fingerprint]);
    for (const [target, entry] of Object.entries(ledger.targets))
      if (!current.has(target) && entry.fingerprint !== "absent") changed.push([target, "absent"]);
    if (!changed.length) return false;
    const at = revision ?? ++ledger.revision;
    for (const [target, fingerprint] of changed) ledger.targets[target] = { revision: at, fingerprint };
    return true;
  }

  async function resolveIssue(roder: RoderAgent, reference: unknown): Promise<Issue> {
    const ref = typeof reference === "number" ? String(reference) : reference;
    if (typeof ref !== "string" || !ref.trim()) throw new Error("issueId must be an issue id or number");
    const number = /^#?\d+$/.test(ref.trim()) ? Number(ref.trim().replace("#", "")) : null;
    const found = (await board(roder)).issues.find((issue) => issue.id === ref || issue.number === number);
    if (!found)
      throw new Error(
        `Issue ${ref} is not on this Roder's board. Read the board with roder_issue {roderId: "${roder.id}"}`,
      );
    return found;
  }

  /** Zuse `check_revision`: a stale revision conflicts only on what the action depends on. */
  function checkRevision(ledger: Ledger, expected: number | undefined, action: RoderAction, roder: RoderAgent) {
    if (expected === undefined || expected === ledger.revision) return;
    const current = ledger.revision;
    const scope = roderActionScope(action);
    if (expected > current || scope === "whole")
      throw new Error(
        `Roder revision conflict: expected ${expected}, current revision is ${current}. ${action.type} needs the exact current revision. Re-read the board with roder_issue {roderId: "${roder.id}"}, then retry with expectedRevision ${current} and a new commandId`,
      );
    for (const target of scope) {
      const changed = ledger.targets[target]?.revision;
      if (changed === undefined || changed <= expected) continue;
      const [kind, id] = [target.slice(0, target.indexOf(":")), target.slice(target.indexOf(":") + 1)];
      const reread =
        kind === "issue"
          ? `Re-read it with roder_issue {roderId: "${roder.id}", issueId: "${id}"}`
          : `Re-read it with roder_files {path: "${id}"}`;
      throw new Error(
        `Roder revision conflict: ${kind} ${id} changed at revision ${changed}, after your expectedRevision ${expected}. ${reread}, then retry with expectedRevision ${current} and a new commandId`,
      );
    }
  }

  function details(value: unknown): ObjectValue {
    const input = object(value, "details");
    const allowed = Object.keys(roderIssueDetailsSchema.properties as ObjectValue);
    for (const key of Object.keys(input))
      if (!allowed.includes(key)) throw new Error(`Unknown issue field ${key}; details takes ${allowed.join(", ")}`);
    return input;
  }

  async function issueAction(
    method: string,
    params: ObjectValue,
    actorThreadId: string,
    summary: (issue: Issue) => string,
  ) {
    const actor: IssueActor = { type: "agent", threadId: actorThreadId };
    try {
      const { issue } = (await issues().request(method, params, actor)) as { issue: Issue };
      return { issue: resultIssue(issue), summary: summary(issue) };
    } catch (error) {
      throw roderIssueError(error);
    }
  }

  async function fileAction(roder: RoderAgent, write: () => ReturnType<RoderFileStore["write"]>, verb: string) {
    const file = await write();
    await options.fileWritten(roder, file.path);
    return { file, summary: `${verb} ${file.path} as version ${file.version}` };
  }

  const handlers = {
    createIssue: async (roder, action, actor) => {
      const { id } = await requireProject(roder);
      return issueAction(
        "desktop/issues/create",
        { ...details(action.details), projectId: id },
        actor,
        (issue) => `Created issue #${issue.number} ${issue.title} (${issue.status})`,
      );
    },
    editIssue: (_roder, action, actor) =>
      issueAction(
        "desktop/issues/update",
        { ...details(action.details), id: action.issueId },
        actor,
        (issue) => `Edited issue #${issue.number} (${issue.status})`,
      ),
    commentIssue: (_roder, action, actor) =>
      issueAction(
        "desktop/issues/comment",
        { id: action.issueId, text: action.text },
        actor,
        (issue) => `Commented on issue #${issue.number}`,
      ),
    linkIssuePullRequest: (_roder, action, actor) =>
      issueAction(
        "desktop/issues/linkPullRequest",
        { id: action.issueId, url: action.url, ...(action.title === undefined ? {} : { title: action.title }) },
        actor,
        (issue) => `Linked ${String(action.url)} to issue #${issue.number}`,
      ),
    unlinkIssuePullRequest: (_roder, action, actor) =>
      issueAction(
        "desktop/issues/unlinkPullRequest",
        { id: action.issueId, url: action.url },
        actor,
        (issue) => `Unlinked ${String(action.url)} from issue #${issue.number}`,
      ),
    askUser: (_roder, action, actor) =>
      issueAction(
        "desktop/issues/askUser",
        {
          id: action.issueId,
          question: action.question,
          ...(action.recommendation === undefined ? {} : { recommendation: action.recommendation }),
        },
        actor,
        (issue) => `Asked the user about issue #${issue.number}; it needs them now`,
      ),
    closeIssue: (_roder, action, actor) =>
      issueAction(
        "desktop/issues/close",
        { id: action.issueId, outcome: action.outcome, note: action.note },
        actor,
        (issue) => `Closed issue #${issue.number} as ${String(action.outcome)} (${issue.status})`,
      ),
    writeFile: (roder, action) =>
      fileAction(
        roder,
        () =>
          options.files.write(roder.id, {
            path: action.path,
            content: action.content,
            expectedVersion: action.expectedVersion,
            author: "roder",
          }),
        "Wrote",
      ),
    restoreFile: (roder, action) =>
      fileAction(
        roder,
        () =>
          options.files.restore(roder.id, {
            path: action.path,
            version: action.version,
            expectedVersion: action.expectedVersion,
            author: "roder",
          }),
        `Restored version ${String(action.version)} of`,
      ),
    delegate: async (roder, action, actor) => {
      const workers = requireWorkers();
      const issue = await resolveIssue(roder, action.issueId);
      if (issue.status === "done" || issue.status === "cancelled")
        throw new Error(`Issue #${issue.number} is closed; reopen it with editIssue before delegating it`);
      if (issue.status === "needs_you")
        throw new Error(
          `Issue #${issue.number} waits on the user (needs_you); wait for their answer before delegating it`,
        );
      if (!issue.doneCriteria.trim())
        throw new Error(
          `Issue #${issue.number} has no doneCriteria; add them with editIssue so the worker knows what done means`,
        );
      const worker = object(action.worker, "worker");
      for (const key of Object.keys(worker))
        if (key !== "objective") throw new Error(`Unknown worker field ${key}; worker takes {objective}`);
      let model: { modelProvider: string; model: string; reasoning?: string } | undefined;
      if (action.model !== undefined) {
        const input = object(action.model, "model");
        for (const key of Object.keys(input))
          if (!["modelProvider", "model", "reasoning"].includes(key))
            throw new Error(`Unknown model field ${key}; model takes {modelProvider, model, reasoning?}`);
        if (typeof input.modelProvider !== "string" || !input.modelProvider.trim())
          throw new Error("model.modelProvider must be a provider id");
        if (typeof input.model !== "string" || !input.model.trim()) throw new Error("model.model must be a model id");
        if (input.reasoning !== undefined && typeof input.reasoning !== "string")
          throw new Error("model.reasoning must be a string");
        model = {
          modelProvider: input.modelProvider,
          model: input.model,
          ...(input.reasoning === undefined ? {} : { reasoning: input.reasoning as string }),
        };
      }
      const delegated = await workers.delegate(roder, {
        issue,
        objective: worker.objective,
        ...(action.base === undefined ? {} : { base: action.base }),
        ...(model ? { model } : {}),
      });
      let linked: Awaited<ReturnType<typeof issueAction>>;
      try {
        linked = await issueAction(
          "desktop/issues/update",
          { id: issue.id, owner: { type: "thread", threadId: delegated.threadId }, status: "in_progress" },
          actor,
          (updated) => `Delegated issue #${updated.number}`,
        );
      } catch (error) {
        await workers.release(roder, delegated.threadId);
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}. The worker thread ${delegated.threadId} and its worktree ${delegated.worktreePath} were made but released, so nothing was sent to it`,
          { cause: error },
        );
      }
      const queued = delegated.queuePosition
        ? `; it is queued at position ${delegated.queuePosition} and starts when a running worker goes idle`
        : "; it starts now";
      return {
        ...linked,
        worker: structuredClone(delegated),
        summary: `Delegated issue #${issue.number} to thread ${delegated.threadId} on branch ${delegated.branch} from ${delegated.base}${queued}`,
      };
    },
    messageWorker: async (roder, action) => {
      const worker = await requireWorkers().message(
        roder,
        { threadId: action.threadId, text: action.text, automatic: action.automatic },
        "roder",
      );
      return {
        worker: structuredClone(worker),
        summary: `Queued a message to worker ${worker.threadId} (${worker.followups} of ${roder.maxFollowups} automatic follow-ups used)`,
      };
    },
    stopWorker: async (roder, action) => {
      const worker = await requireWorkers().stop(roder, action.threadId, "roder");
      return { worker: structuredClone(worker), summary: `Stopped worker ${worker.threadId}` };
    },
    releaseWorker: async (roder, action) => {
      const worker = await requireWorkers().release(roder, action.threadId);
      return {
        worker: structuredClone(worker),
        summary: `Released worker ${worker.threadId}; its thread and worktree are kept`,
      };
    },
    setStatus: async (roder, action) => {
      if (action.status === "active") {
        if (!roder.enabled)
          throw new Error(
            "Only the user makes a Roder active. Ask them to resume you on the Roders page if you should run on your own.",
          );
        return { status: "active", summary: "Already active" };
      }
      if (action.status !== "paused") throw new Error('status must be "active" or "paused"');
      if (roder.enabled) await options.pause(roder);
      return { status: "paused", summary: "Paused: no automatic turns until the user resumes you" };
    },
  } satisfies Record<RoderActionType, (roder: RoderAgent, action: RoderAction, actor: string) => Promise<Outcome>>;

  function requireWorkers() {
    if (!options.workers) throw new Error("Delegation to worker threads is unavailable in this build");
    return options.workers;
  }

  /** A worker may only comment on, or link a pull request to, an issue linked to its own thread. */
  async function authorizeWorker(roder: RoderAgent, action: RoderAction, threadId: string) {
    if (!RODER_WORKER_ACTIONS.includes(action.type))
      throw new Error(
        `A worker thread may use roder_command only for ${RODER_WORKER_ACTIONS.join(" and ")} on its own linked issues; ${action.type} is the Roder's. Say what you need in your report instead.`,
      );
    const issue = await resolveIssue(roder, action.issueId);
    if (!issue.threadIds.includes(threadId))
      throw new Error(
        `Issue #${issue.number} is not linked to this thread; a worker comments only on its own linked issues`,
      );
  }

  function roderIdOf(input: ObjectValue, roder: RoderAgent) {
    if (input.roderId !== roder.id)
      throw new Error(`roderId must be this thread's Roder id, "${roder.id}"; a Roder acts only on itself`);
  }

  return {
    /** Apply one command for the Roder that owns the calling thread, or one of its workers. */
    async command(roder: RoderAgent, value: unknown, caller: RoderCommandCaller = { type: "roder" }): Promise<unknown> {
      const input = object(value, "roder_command input");
      const commandId = input.commandId;
      if (typeof commandId !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/.test(commandId))
        throw new Error("commandId must be 1-160 letters, digits, '.', '_', ':' or '-'");
      roderIdOf(input, roder);
      const expected = input.expectedRevision;
      if (expected !== undefined && (!Number.isSafeInteger(expected) || (expected as number) < 0))
        throw new Error("expectedRevision must be a non-negative whole number");
      const action = parseRoderAction(input.action);
      if (caller.type === "worker") await authorizeWorker(roder, action, caller.threadId);
      const actor = caller.type === "worker" ? caller.threadId : roder.threadId;
      const fingerprint = canonical({
        commandId,
        roderId: roder.id,
        expectedRevision: expected,
        action,
        ...(caller.type === "worker" ? { worker: caller.threadId } : {}),
      });

      const ledger = await load(roder);
      const receipt = ledger.receipts.find((entry) => entry.commandId === commandId);
      if (receipt) {
        if (receipt.input !== fingerprint)
          throw new Error(
            `commandId ${commandId} was already used with different input. Use a new commandId for a new command`,
          );
        if (receipt.state === "pending")
          throw new Error(
            `Command ${commandId} was interrupted before its result was recorded, so it may have been applied. Re-read the board with roder_issue and your files with roder_files, then send a new commandId if it is still needed`,
          );
        return structuredClone(receipt.result);
      }

      if (await observe(roder, ledger)) await save(roder, ledger);
      const resolved: RoderAction =
        "issueId" in action ? { ...action, issueId: (await resolveIssue(roder, action.issueId)).id } : action;
      checkRevision(ledger, expected as number | undefined, resolved, roder);

      const pending: Receipt = { commandId, input: fingerprint, state: "pending" };
      ledger.receipts.push(pending);
      if (ledger.receipts.length > RODER_RECEIPT_LIMIT)
        ledger.receipts.splice(0, ledger.receipts.length - RODER_RECEIPT_LIMIT);
      await save(roder, ledger);
      let outcome: Outcome;
      try {
        outcome = await handlers[resolved.type](roder, resolved, actor);
      } catch (error) {
        // A refused action wrote nothing; forget it so the same commandId can be retried.
        ledger.receipts = ledger.receipts.filter((entry) => entry !== pending);
        await save(roder, ledger);
        throw error;
      }
      ledger.revision++;
      await observe(roder, ledger, ledger.revision);
      const { summary, ...changed } = outcome;
      const result = { revision: ledger.revision, action: resolved.type, summary, ...changed };
      pending.state = "applied";
      pending.result = result;
      await save(roder, ledger);
      return structuredClone(result);
    },

    /** The whole board, or one issue in full. */
    async issue(roder: RoderAgent, value: unknown): Promise<unknown> {
      const input = object(value, "roder_issue input");
      roderIdOf(input, roder);
      const ledger = await load(roder);
      if (await observe(roder, ledger)) await save(roder, ledger);
      if (input.issueId !== undefined) {
        const issue = await resolveIssue(roder, input.issueId);
        return { roderId: roder.id, revision: ledger.revision, issue };
      }
      const current = await board(roder);
      return {
        roderId: roder.id,
        revision: ledger.revision,
        project: current.project && { id: current.project.id, name: current.project.name },
        issues: current.issues.map(boardIssue),
      };
    },
  };
}

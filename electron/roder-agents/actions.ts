// The one table of `roder_command` actions, modelled on Zuse's `ZapperAction`
// (crates/protocol/src/zappers.rs). The JSON schema, the tool description and
// the action parser are all generated from it, so they can't drift from what
// the command runner accepts. Slice 5 generates the commands guide from it too.
import { issuePriorities, issueStatuses } from "../../src/types/issues";
import { roderFilePaths } from "../../src/types/roder-agents";

type JsonSchema = Record<string, unknown>;

/**
 * What a command's `expectedRevision` protects (Zuse `ConflictScope`). Most
 * actions touch one issue or file, so changes elsewhere since the caller read
 * the state must not reject them.
 * - `whole`: order against every change matters; any newer revision conflicts.
 * - targets: conflicts only when one of these changed after the expected
 *   revision. Empty means the action commutes with everything (append-only or
 *   set-like changes the services validate against the current state).
 */
export type RoderConflictScope = "whole" | string[];

export const issueTarget = (issueId: string) => `issue:${issueId}`;
export const fileTarget = (path: string) => `file:${path}`;

type Field = { name: string; required: boolean; schema: JsonSchema };
type Action = Record<string, unknown> & { type: string };
type ActionSpec = {
  type: string;
  /** One line for the tool description and the commands guide. */
  summary: string;
  fields: Field[];
  scope: (action: Action) => RoderConflictScope;
};

const string = (description?: string): JsonSchema => ({
  type: "string",
  ...(description ? { description } : {}),
});
const required = (name: string, schema: JsonSchema): Field => ({ name, required: true, schema });
const optional = (name: string, schema: JsonSchema): Field => ({ name, required: false, schema });
const issueId = required(
  "issueId",
  string("The issue's id, or its number (such as 12). Read the board with roder_issue to find it."),
);
const threadId = required("threadId", string("The worker's thread id, from delegate's result."));
const version = (description: string): JsonSchema => ({ type: "integer", minimum: 0, description });

/** The fields of an issue a Roder writes. editIssue changes only the fields given. */
export const roderIssueDetailsSchema: JsonSchema = {
  type: "object",
  properties: {
    title: string(),
    description: string(),
    status: { type: "string", enum: issueStatuses },
    priority: { type: "string", enum: issuePriorities },
    owner: {
      type: "object",
      description:
        'Who holds the issue: {type: "roder"} (you) or {type: "thread", threadId} (a thread doing the work, which also links it). Hand an issue to the user with askUser instead.',
      properties: { type: { type: "string", enum: ["roder", "thread"] }, threadId: string() },
      required: ["type"],
      additionalProperties: false,
    },
    doneCriteria: string("What must be true for the issue to be done. Required unless the issue is in backlog."),
    outOfScope: string("What the issue deliberately leaves alone."),
    parent: { type: ["string", "null"], description: "ID of the issue this one is part of." },
  },
  additionalProperties: false,
};

const issueScope = (action: Action): RoderConflictScope => [issueTarget(String(action.issueId))];
const fileScope = (action: Action): RoderConflictScope => [fileTarget(String(action.path))];
const commutes = (): RoderConflictScope => [];

export const roderActions = [
  {
    type: "createIssue",
    summary: "Create an issue on your board, in backlog (default) or todo; todo needs doneCriteria.",
    fields: [required("details", { ...roderIssueDetailsSchema, required: ["title"] })],
    scope: commutes,
  },
  {
    type: "editIssue",
    summary:
      "Change the given fields of an issue. in_progress needs a linked thread, in_review a linked pull request; doneCriteria can't be cleared.",
    fields: [issueId, required("details", roderIssueDetailsSchema)],
    scope: issueScope,
  },
  {
    type: "commentIssue",
    summary: "Add progress, findings or a blocker to an issue's activity.",
    fields: [issueId, required("text", string())],
    scope: commutes,
  },
  {
    type: "linkIssuePullRequest",
    summary: "Link a GitHub pull request (https://github.com/<owner>/<repo>/pull/<n>) to an issue.",
    fields: [issueId, required("url", string()), optional("title", string())],
    scope: commutes,
  },
  {
    type: "unlinkIssuePullRequest",
    summary: "Remove a linked pull request from an issue.",
    fields: [issueId, required("url", string())],
    scope: commutes,
  },
  {
    type: "askUser",
    summary:
      "Hand an issue to the user with one question: they own it (needs_you) until they answer, and their answer hands it back.",
    fields: [issueId, required("question", string()), optional("recommendation", string())],
    scope: issueScope,
  },
  {
    type: "closeIssue",
    summary: "Close an issue: merged (needs a linked pull request) or dropped, with a note saying what happened.",
    fields: [issueId, required("outcome", { type: "string", enum: ["merged", "dropped"] }), required("note", string())],
    scope: issueScope,
  },
  {
    type: "writeFile",
    summary: `Write one of your files (${roderFilePaths.join(", ")}) as a new version. expectedVersion is its current version. AGENTS.md is the user's; only they edit it.`,
    fields: [
      required("path", { type: "string", enum: roderFilePaths }),
      required("content", string()),
      required("expectedVersion", version("The file's current version, from roder_files.")),
    ],
    scope: fileScope,
  },
  {
    type: "restoreFile",
    summary: "Copy an older version of one of your files into a new version.",
    fields: [
      required("path", { type: "string", enum: roderFilePaths }),
      required("version", version("The version to restore.")),
      required("expectedVersion", version("The file's current version, from roder_files.")),
    ],
    scope: fileScope,
  },
  {
    type: "delegate",
    summary:
      "Hand an issue to a new worker thread in its own git worktree, on a new branch from base (default: the repository's default branch at origin). The thread becomes the issue's owner and the issue moves to in_progress. Over maxConcurrentWorkers the worker waits with a queue position and starts when a running worker goes idle. All repository writes go to workers.",
    fields: [
      issueId,
      required("worker", {
        type: "object",
        description: "objective: a self-contained brief: goal, relevant paths and facts, acceptance checks.",
        properties: { objective: string() },
        required: ["objective"],
        additionalProperties: false,
      }),
      optional("model", {
        type: "object",
        description: "The worker's model. Default: your own model.",
        properties: { modelProvider: string(), model: string(), reasoning: string() },
        required: ["modelProvider", "model"],
        additionalProperties: false,
      }),
      optional("base", string("Branch, tag or commit the worker's branch starts from, such as origin/main.")),
    ],
    scope: issueScope,
  },
  {
    type: "messageWorker",
    summary:
      "Send one of your workers more work. automatic: true for your own follow-ups, which are limited by maxFollowups; false only to relay the user's own words, which resets that count.",
    fields: [threadId, required("text", string()), required("automatic", { type: "boolean" })],
    scope: commutes,
  },
  {
    type: "stopWorker",
    summary: "Stop a worker: cancel its pending messages and interrupt its running turn. messageWorker resumes it.",
    fields: [threadId],
    scope: commutes,
  },
  {
    type: "releaseWorker",
    summary:
      "Stop tracking a worker. Its thread, worktree and issue links are kept; it no longer counts against your limits.",
    fields: [threadId],
    scope: commutes,
  },
  {
    type: "setStatus",
    summary: "Pause yourself: no automatic turns until the user resumes you. Only the user makes a Roder active.",
    fields: [required("status", { type: "string", enum: ["active", "paused"] })],
    scope: () => "whole",
  },
] as const satisfies readonly ActionSpec[];

export type RoderActionType = (typeof roderActions)[number]["type"];
export type RoderAction = Action & { type: RoderActionType };

function spec(type: string): ActionSpec | undefined {
  return (roderActions as readonly ActionSpec[]).find((entry) => entry.type === type);
}

/** `editIssue {issueId, details}`; optional fields end in `?`. */
export function roderActionSignature(action: { type: string; fields: readonly Field[] }): string {
  if (!action.fields.length) return action.type;
  return `${action.type} {${action.fields.map((f) => (f.required ? f.name : `${f.name}?`)).join(", ")}}`;
}

/** Every action's signature, in table order. */
export function roderActionCatalog(): string {
  return roderActions.map(roderActionSignature).join("; ");
}

/** One JSON schema variant per action, discriminated by `type`. */
export function roderActionSchema(): JsonSchema {
  return {
    anyOf: [
      ...roderActions.map((action) => ({
        type: "object",
        description: action.summary,
        properties: {
          type: { type: "string", const: action.type },
          ...Object.fromEntries(action.fields.map((field) => [field.name, field.schema])),
        },
        required: ["type", ...action.fields.filter((f) => f.required).map((f) => f.name)],
        additionalProperties: false,
      })),
      { type: "string", description: "The same action object, JSON-encoded as a string." },
    ],
  };
}

export const roderCommandToolSchema = (): JsonSchema => ({
  type: "object",
  properties: {
    commandId: string("New and unique for each command; reuse it only to retry a command whose result was lost."),
    roderId: string("Your Roder id."),
    expectedRevision: {
      type: "integer",
      minimum: 0,
      description:
        "Optional: the revision you last read. It conflicts only when what the action depends on changed since.",
    },
    action: roderActionSchema(),
  },
  required: ["commandId", "roderId", "action"],
  additionalProperties: false,
});

export function roderCommandDescription(): string {
  return [
    "Apply one Roder command: commandId (new and unique; reuse it only to retry a lost result), roderId, expectedRevision (optional: the revision you read; it conflicts only when what the action depends on changed since, such as the issue or file you edit) and action {type, ...fields} (an object, or the same object as a JSON string).",
    `Actions (? = optional): ${roderActionCatalog()}.`,
    ...roderActions.map((action) => `${action.type}: ${action.summary}`),
    "details = {title, description, status, priority, owner {type: roder | thread (threadId)}, doneCriteria, outOfScope, parent}.",
    "Retrying a commandId with the same input returns the original result and changes nothing; with different input it is refused.",
    "Returns the new revision, the changed issue, file or status, and a one-line summary.",
  ].join("\n");
}

/**
 * The action as an object, checked against its table entry: known type, every
 * required field, no unknown fields. Field values are validated by the
 * services that apply them.
 */
export function parseRoderAction(value: unknown): RoderAction {
  let action = value;
  if (typeof action === "string") {
    try {
      action = JSON.parse(action);
    } catch {
      throw new Error("action is not valid JSON");
    }
  }
  if (!action || typeof action !== "object" || Array.isArray(action))
    throw new Error(`action must be an object {type, ...fields}. Actions: ${roderActionCatalog()}`);
  const input = action as Record<string, unknown>;
  const entry = typeof input.type === "string" ? spec(input.type) : undefined;
  if (!entry) throw new Error(`Unknown action type ${JSON.stringify(input.type)}. Actions: ${roderActionCatalog()}`);
  const shape = `${entry.type} takes ${roderActionSignature(entry)}; put its fields directly in action`;
  for (const field of entry.fields)
    if (field.required && input[field.name] === undefined) throw new Error(`Missing ${field.name}. ${shape}`);
  for (const key of Object.keys(input))
    if (key !== "type" && !entry.fields.some((field) => field.name === key))
      throw new Error(`Unknown field ${key}. ${shape}`);
  return input as RoderAction;
}

export function roderActionScope(action: RoderAction): RoderConflictScope {
  return spec(action.type)!.scope(action);
}

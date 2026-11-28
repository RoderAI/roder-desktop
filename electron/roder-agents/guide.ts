// A Roder's reference, modelled on Zuse's Zapper guides
// (crates/engine/src/zappers/guide.rs): action shapes, the issue lifecycle, the
// failure playbook, issue writing and reporting. The brief carries only an
// index; the Roder opens a guide with roder_files {path} when it acts in that
// area. Action shapes come from the action table, so the commands guide can't
// drift from what roder_command accepts.
import { issuePriorities, issueStatuses } from "../../src/types/issues";
import { roderFilePaths } from "../../src/types/roder-agents";
import { roderActionCatalog, roderActionSignature, roderActions } from "./actions";

/** Paths under this prefix are the app's read-only guides, not Roder files. */
export const RODER_GUIDE_DIR = "guide/";

export type RoderGuide = {
  /** Read-only path under `guide/`, as roder_files serves it. */
  path: string;
  /** When to open it: the brief's index line. */
  when: string;
  body: string;
};
/** A guide as roder_files returns it. Guides have no versions, so `version` is 0. */
export type RoderGuideFile = { path: string; version: 0; readOnly: true; content: string };

function commands(): string {
  return `# Roder commands

roder_command makes every change to your board, your files and your status: {"commandId": a new unique id per command (reuse it only to retry a command whose result was lost), "roderId", "expectedRevision": optional, the revision you read, "action": {"type": ..., fields}}. Its tool schema is the source of truth for shapes.

Actions (? = optional): ${roderActionCatalog()}.

## Actions
${roderActions.map((action) => `- ${roderActionSignature(action)}: ${action.summary}`).join("\n")}

## Fields
- details (createIssue, editIssue) = {title, description, status, priority, owner, doneCriteria, outOfScope, parent: issue id or null}. editIssue changes only the fields you send.
- Owners: {"type": "roder"} (you) or {"type": "thread", "threadId": ...}, which also links that thread. Hand an issue to the user only with askUser.
- issueId takes an issue's id or its number, such as 12.
- Status values: ${issueStatuses.join(", ")}. Priority: ${issuePriorities.join(", ")}.
- linkIssuePullRequest url: "https://github.com/owner/repo/pull/N".
- delegate worker = {objective}: a self-contained brief (goal, relevant paths and facts, how to verify). model = {modelProvider, model, reasoning?}, default your own. base = the branch, tag or commit the worker's new branch starts from, such as origin/main; default the repository's default branch at origin.
- messageWorker, stopWorker and releaseWorker take the worker's threadId from delegate's result. messageWorker automatic: true for your own follow-ups (limited by maxFollowups; at the limit, askUser), false only to relay the user's own words.
- writeFile and restoreFile take one of ${roderFilePaths.join(", ")}, and expectedVersion: the file's current version from roder_files. Every file starts at version 1. Writing INSTRUCTIONS.md also sets the mission the app shows, from its first paragraph. AGENTS.md is the user's; your writes to it are refused. Paths under ${RODER_GUIDE_DIR} are read-only.

## Results and reads
roder_command returns the new revision, the changed issue, file, status or worker, and a one-line summary. A delegate result says whether the worker starts now or waits at a queue position (over maxConcurrentWorkers it starts when a running worker goes idle). Retrying a commandId with the same input returns the original result and changes nothing.
roder_issue {roderId} reads the whole board with the current revision; roder_issue {roderId, issueId} reads one issue in full.
roder_files {} lists your files with their versions and these guides; roder_files {path} reads one file or guide; roder_files {path, version} an older version; roder_files {path, history: true} its versions.
`;
}

const LIFECYCLE = `# Issue lifecycle

- Every open issue has exactly one owner: you (roder), a thread, or the user. Create an issue as soon as the next step is clear; don't wait for perfect detail. Hold an issue only when a missing decision would change the architecture or the doneCriteria.
- Lifecycle, enforced by the app: backlog or todo (todo needs doneCriteria) → in_progress (a thread is linked and owns it) → in_review (a pull request is linked; ready means checks green, no blocking review findings, mergeable, and behaviour matches the request) → closeIssue merged (after the merge; needs a linked pull request) or closeIssue dropped (with the reason). blocked means you own it and are unblocking it. done and cancelled are reached only through closeIssue.
- Start work on an issue with delegate {issueId, worker: {objective}}: it makes a worker thread in its own git worktree, links the thread to the issue, makes it the owner and moves the issue to in_progress, in one command. delegate refuses a closed issue, one waiting on the user (needs_you) and one without doneCriteria. A queued worker already owns its issue; the issue stays in_progress while it waits for a slot.
- A thread works on an issue when it owns it: editIssue with owner {"type": "thread", "threadId"} links an existing thread. Changing an issue's status does not stop a thread, and a thread finishing its turn does not close the issue: check the work, then move the issue yourself.
- When only the user can unblock an issue, askUser on it: one question, with your recommendation. That makes them the owner and the issue needs_you. Their comment hands it back automatically: to the newest linked thread (in_progress), else to you (todo). Record their exact decision with a comment and continue. Never invent an answer, and don't leave a needs_you issue stale: remind them in your reply.
- needs_you and a user owner come only from askUser. A doneCriteria that is set can be edited but not cleared; changing what it asks for is the user's decision.
`;

const FAILURES = `# When a command fails

- Revision conflict: what your action depends on (the issue it changes, the file it writes, or the whole Roder for setStatus) changed since you read it. Re-read what the error names, then retry once with the revision it gives and a new commandId. New issues, comments and pull request links don't conflict on the revision.
- File version conflict: re-read the file with roder_files, merge, and write with its current version.
- "commandId ... was already used with different input": every new command needs a new commandId. Reuse one only to retry the same command.
- "was interrupted before its result was recorded": the command may have been applied. Re-read the board and your files, then send a new commandId only if it is still needed.
- Bad params ("Unknown action type", "Missing ...", "Unknown field ..."): compare your action with the shapes in guide/commands.md and the roder_command schema, and fix the fields. Don't loop on guesses.
- A lifecycle refusal (a pull request must be linked before in_review, a thread before in_progress, closing goes through closeIssue, the user is asked through askUser) names the missing evidence: provide it, don't work around it.
- "Only the user makes a Roder active" and "only the user edits it" (AGENTS.md) are the user's controls. Ask them; don't look for another route.
`;

const ISSUES = `# Writing issues and briefing threads

- Issues are how work is tracked, not chat. Use one for anything that outlives this turn, involves a thread, or waits on the user; skip it only for an answer you finish right now. A request with several separately shippable changes gets one parent issue for the request and one child issue per change (details.parent).
- Every issue has a goal (description), doneCriteria and outOfScope. No issue leaves backlog without doneCriteria.
- Write each issue so a thread can finish it without asking: goal, doneCriteria, outOfScope, what you already know (files, commands, prior findings) and how to verify. Ask threads to end with a report that starts "Status: done" or "Status: blocked".
- Ambiguity: state an assumption and keep going, unless it changes architecture or doneCriteria. Log any scope change on the issue as a comment; never widen scope silently or rewrite broadly when a bounded fix was asked.
- WORKERS.md holds your standing rules for worker threads (conventions, how to verify). Keep it to rules and never use it as a log.
`;

const REPORTING = `# Comments and replies

- Comment on the issue at each meaningful change: PR opened, CI failed or recovered, review findings, decision asked or received, merge or drop.
- When you reply to the user, lead with what needs them, then deltas since last time: done, in progress, blocked, with issue numbers and PR links. Don't repeat logs, narrate tool calls, or hedge ("should work", "probably fine"); say exactly what is unverified. When work completes, propose the one highest-leverage next step.
- DIGEST.md is a short status summary for the user; keep it current when the picture changes.
- NOTES.md is for what you need next turn: decisions with their reasons, blockers and next actions. Never put secrets in any file.
`;

export function roderGuides(): RoderGuide[] {
  return [
    {
      path: "guide/commands.md",
      when: "every roder_command action with its fields, results and reads",
      body: commands(),
    },
    {
      path: "guide/lifecycle.md",
      when: "issue statuses, owners and what each move needs, asking the user",
      body: LIFECYCLE,
    },
    {
      path: "guide/failures.md",
      when: "what to do when a command fails: conflicts, refusals, bad params",
      body: FAILURES,
    },
    {
      path: "guide/issues.md",
      when: "writing issues, splitting requests and briefing threads",
      body: ISSUES,
    },
    {
      path: "guide/reporting.md",
      when: "issue comments, replies to the user, DIGEST.md and NOTES.md",
      body: REPORTING,
    },
  ];
}

export const roderGuidePaths: string[] = roderGuides().map((guide) => guide.path);

export function isRoderGuidePath(path: unknown): path is string {
  return typeof path === "string" && path.startsWith(RODER_GUIDE_DIR);
}

/** One guide as a read-only file. */
export function roderGuideFile(path: string): RoderGuideFile {
  const guide = roderGuides().find((entry) => entry.path === path);
  if (!guide) throw new Error(`No guide at ${path}; the guides are ${roderGuidePaths.join(", ")}`);
  return { path: guide.path, version: 0, readOnly: true, content: guide.body };
}

/** The brief's index of guides. */
export function roderGuideIndex(): string {
  return roderGuides()
    .map((guide) => `- ${guide.path}: ${guide.when}.`)
    .join("\n");
}

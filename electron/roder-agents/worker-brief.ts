// What every worker thread reads first, adapted from Zuse's `worker_brief` and
// `prepare_request` (crates/engine/src/zappers.rs). Each worker turn gets the
// brief, the Roder's WORKERS.md and the issues linked to the thread through
// `developerContext`, so the rules arrive with every turn, including turns the
// user starts in the worker's own composer.
import type { Issue } from "../../src/types/issues";
import type { RoderAgent, RoderWorker } from "../../src/types/roder-agents";

/** What a worker sees of each linked issue (Zuse `linked_issue`). */
export function linkedIssue(issue: Issue) {
  return {
    issueId: issue.id,
    number: issue.number,
    title: issue.title,
    description: issue.description,
    doneCriteria: issue.doneCriteria,
    outOfScope: issue.outOfScope,
    status: issue.status,
  };
}

/** The first lines of a worker's report must say one of these (slice 7 reads them). */
export const RODER_WORKER_REPORT_STATUSES = ["Status: done", "Status: blocked"] as const;

export function roderWorkerBrief(roder: Pick<RoderAgent, "id" | "name">, worker: RoderWorker): string {
  return `You are a thread working for the Roder "${roder.name}" (roderId ${roder.id}), which coordinates this work and reviews your report. You run in your own git worktree (${worker.worktreePath}, branch ${worker.branch} made from ${worker.base}); keep every change inside it.
- Finish the objective and stay within it. Don't stop at a plan or a partial change when you can complete it.
- Verify before you report: build, run the relevant tests or checks, and try the change the way a user would where you can. Say plainly what you could not verify.
- For issues linked to this thread, record a pull request with roder_command action linkIssuePullRequest {issueId, url, title}, and blockers or meaningful progress with commentIssue {issueId, text}. Use roderId "${roder.id}" and a new unique commandId for each command. Those are the only roder_command actions a worker may use, and only on its own linked issues.
- Build to the linked issue: its doneCriteria is the target and its outOfScope is off limits. If the work needs something out of scope, stop and say so in your report instead of widening it. Make the bounded change, not a broad rewrite.
- Only the Roder decides when an issue is done, so leave issue status alone. Never merge.
- End with a short report the Roder can act on. Its first line is exactly "${RODER_WORKER_REPORT_STATUSES[0]}" or "${RODER_WORKER_REPORT_STATUSES[1]}". Then: what changed (files, PR link), how you verified it, and anything left, unverified or risky. If blocked, say exactly what would unblock you. No filler, no "should work".`;
}

/** The developerContext for one worker turn. */
export function roderWorkerContext(input: {
  roder: Pick<RoderAgent, "id" | "name">;
  worker: RoderWorker;
  workersFile: string;
  issues: Issue[];
}): string {
  const rules = input.workersFile.trim();
  return [
    roderWorkerBrief(input.roder, input.worker),
    ...(rules ? [`Rules from your Roder (WORKERS.md):\n${rules}`] : []),
    `Linked issues: ${JSON.stringify(input.issues.map(linkedIssue))}`,
  ].join("\n\n");
}

/** The user-visible message that carries an objective or follow-up from the Roder. */
export function roderWorkerMessage(roder: Pick<RoderAgent, "name">, text: string): string {
  return `[From the Roder "${roder.name}"]\n\n${text}`;
}

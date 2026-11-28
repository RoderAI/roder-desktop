import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import { IssuesService } from "../electron/issues/service";
import {
  parseRoderAction,
  roderActionSignature,
  roderActions,
  roderCommandDescription,
} from "../electron/roder-agents/actions";
import { RODER_RECEIPT_LIMIT } from "../electron/roder-agents/commands";
import { createRoderAgentService, roderAgentToolDefinitions } from "../electron/roder-agents/service";
import type { Issue } from "../src/types/issues";
import type { RoderAgentDetail, RoderFile } from "../src/types/roder-agents";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});

type Result = { revision: number; action: string; summary: string; issue?: Issue; file?: RoderFile };
type Board = { revision: number; project: { id: string } | null; issues: (Issue & { activityCount: number })[] };

async function setup(directory?: string) {
  directory ??= await mkdtemp(join(tmpdir(), "roder-commands-test-"));
  if (!directories.includes(directory)) directories.push(directory);
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async (method) => {
    if (method === "thread/start") return { thread: { id: "roder-thread" } };
    if (method === "thread/read") return { thread: { id: "roder-thread", status: { type: "idle" }, turns: [] } };
    if (method === "memory/query") return { results: [] };
    if (method === "turn/start") return { turnId: "turn-1" };
    return {};
  });
  const issues = new IssuesService({ storagePath: join(directory, "issues", "issues.json") });
  const roders = createRoderAgentService({ directory: join(directory, "roders"), request, issues });
  await roders.start();
  const listed = (await roders.handleRequest("desktop/roders/list", {})) as { roders: RoderAgentDetail[] };
  let roder = listed.roders[0];
  if (!roder) {
    roder = (await roders.handleRequest("desktop/roders/create", {
      name: "Release",
      mission: "Ship releases",
      workspaceId: "ws",
    })) as RoderAgentDetail;
    // What the host does after create (electron/main/index.ts).
    await issues.request(
      "desktop/projects/ensureWorkspace",
      { workspaceId: "ws", name: "Release", roderThreadId: roder.threadId },
      { type: "user" },
    );
  }
  const thread = { threadId: roder.threadId };
  const command = (action: unknown, extra: Record<string, unknown> = {}) =>
    roders.handleTool(
      "roder_command",
      { commandId: randomUUID(), roderId: roder.id, action, ...extra },
      thread,
    ) as Promise<Result>;
  const board = () => roders.handleTool("roder_issue", { roderId: roder.id }, thread) as Promise<Board>;
  const read = async (id: string) => (await issues.request("desktop/issues/read", { id })).issue;
  const file = (path: string) =>
    roders.handleRequest("desktop/roders/files/read", { id: roder.id, path }) as Promise<RoderFile>;
  return { directory, roders, roder, issues, thread, command, board, read, file };
}

const todo = (title: string) => ({
  type: "createIssue",
  details: { title, status: "todo", doneCriteria: `${title} is done` },
});

test("replaying a commandId with identical input returns the original result and changes nothing", async () => {
  const { roders, roder, thread, board } = await setup();
  const input = { commandId: "create-1", roderId: roder.id, action: todo("Cut the release") };
  const first = (await roders.handleTool("roder_command", input, thread)) as Result;
  expect(first).toMatchObject({ revision: 1, action: "createIssue", issue: { title: "Cut the release" } });

  // Later commands change the board; the replay still answers as the first attempt did.
  await roders.handleTool(
    "roder_command",
    {
      commandId: "comment-1",
      roderId: roder.id,
      action: { type: "commentIssue", issueId: first.issue!.id, text: "x" },
    },
    thread,
  );
  const before = await board();
  // Same input with keys in another order, and the action as a JSON string, is the same command.
  const reordered = {
    action: JSON.stringify({
      details: { doneCriteria: "Cut the release is done", status: "todo", title: "Cut the release" },
      type: "createIssue",
    }),
    roderId: roder.id,
    commandId: "create-1",
  };
  expect(await roders.handleTool("roder_command", reordered, thread)).toEqual(first);
  expect(await roders.handleTool("roder_command", input, thread)).toEqual(first);
  const after = await board();
  expect(after.revision).toBe(before.revision);
  expect(after.issues).toHaveLength(1);
  expect(after.issues[0].activityCount).toBe(before.issues[0].activityCount);
  await roders.stop();
});

test("replaying a commandId with different input is refused and changes nothing", async () => {
  const { roders, roder, thread, board } = await setup();
  await roders.handleTool("roder_command", { commandId: "same", roderId: roder.id, action: todo("First") }, thread);
  const before = await board();
  await expect(
    roders.handleTool("roder_command", { commandId: "same", roderId: roder.id, action: todo("Second") }, thread),
  ).rejects.toThrow("commandId same was already used with different input. Use a new commandId");
  await expect(
    roders.handleTool(
      "roder_command",
      { commandId: "same", roderId: roder.id, expectedRevision: 0, action: todo("First") },
      thread,
    ),
  ).rejects.toThrow(/already used with different input/);
  expect(await board()).toEqual(before);
  await roders.stop();
});

test("a refused action leaves no receipt, so the same commandId can be retried", async () => {
  const { roders, roder, thread, board } = await setup();
  const refused = { type: "createIssue", details: { title: "No criteria", status: "todo" } };
  await expect(
    roders.handleTool("roder_command", { commandId: "retry", roderId: roder.id, action: refused }, thread),
  ).rejects.toThrow(/doneCriteria/);
  expect((await board()).revision).toBe(0);
  const fixed = (await roders.handleTool(
    "roder_command",
    { commandId: "retry", roderId: roder.id, action: todo("No criteria") },
    thread,
  )) as Result;
  expect(fixed).toMatchObject({ revision: 1, issue: { status: "todo" } });
  await roders.stop();
});

test("receipts survive a restart; an interrupted command is refused instead of applied twice", async () => {
  const first = await setup();
  const input = { commandId: "durable", roderId: first.roder.id, action: todo("Durable") };
  const result = await first.roders.handleTool("roder_command", input, first.thread);
  const pendingInput = { commandId: "interrupted", roderId: first.roder.id, action: todo("Interrupted") };
  await first.roders.handleTool("roder_command", pendingInput, first.thread);
  await first.roders.stop();

  // Simulate a crash after the action applied but before its result was recorded.
  const ledgerPath = join(first.directory, "roders", "commands", `${first.roder.id}.json`);
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  const receipt = ledger.receipts.find((entry: { commandId: string }) => entry.commandId === "interrupted");
  receipt.state = "pending";
  delete receipt.result;
  await writeFile(ledgerPath, JSON.stringify(ledger));

  const second = await setup(first.directory);
  expect(await second.roders.handleTool("roder_command", input, second.thread)).toEqual(result);
  await expect(second.roders.handleTool("roder_command", pendingInput, second.thread)).rejects.toThrow(
    /interrupted before its result was recorded.*Re-read the board with roder_issue/,
  );
  expect((await second.board()).issues.map((issue) => issue.title).sort()).toEqual(["Durable", "Interrupted"]);
  await second.roders.stop();
});

test("the receipt ledger is bounded; the oldest receipts go first", async () => {
  const { roders, roder, thread, directory } = await setup();
  const pause = { type: "setStatus", status: "paused" };
  for (let at = 0; at <= RODER_RECEIPT_LIMIT; at++)
    await roders.handleTool("roder_command", { commandId: `pause-${at}`, roderId: roder.id, action: pause }, thread);
  const ledger = JSON.parse(await readFile(join(directory, "roders", "commands", `${roder.id}.json`), "utf8"));
  expect(ledger.receipts).toHaveLength(RODER_RECEIPT_LIMIT);
  expect(ledger.receipts[0].commandId).toBe("pause-1");
  // pause-0 was forgotten, so new input under its id is a new command, not a mismatch.
  await expect(
    roders.handleTool("roder_command", { commandId: "pause-0", roderId: roder.id, action: todo("Fresh") }, thread),
  ).resolves.toMatchObject({ action: "createIssue" });
  await roders.stop();
});

test("a stale revision conflicts only when the targeted issue changed, and names what to re-read", async () => {
  const { roders, roder, command, board, issues } = await setup();
  const a = (await command(todo("Alpha"))).issue!;
  const b = (await command(todo("Beta"))).issue!;
  const seen = (await board()).revision;
  expect(seen).toBe(2);

  // Beta changes; edits to Alpha against the older revision still apply.
  await command({ type: "editIssue", issueId: b.id, details: { title: "Beta v2" } });
  await expect(
    command({ type: "editIssue", issueId: a.id, details: { priority: "high" } }, { expectedRevision: seen }),
  ).resolves.toMatchObject({ revision: 4, issue: { priority: "high" } });

  // Comments and links don't change an issue's details, so they don't conflict either.
  await expect(
    command({ type: "commentIssue", issueId: b.id, text: "progress" }, { expectedRevision: seen }),
  ).resolves.toMatchObject({ revision: 5 });

  // An edit to Beta from before its change conflicts, naming Beta and how to read it.
  const conflict = `Roder revision conflict: issue ${b.id} changed at revision 3, after your expectedRevision ${seen}. Re-read it with roder_issue {roderId: "${roder.id}", issueId: "${b.id}"}, then retry with expectedRevision 5 and a new commandId`;
  await expect(
    command({ type: "editIssue", issueId: b.id, details: { title: "Lost update" } }, { expectedRevision: seen }),
  ).rejects.toThrow(conflict);
  // The issue number resolves to the same target.
  await expect(
    command({ type: "askUser", issueId: String(b.number), question: "Ship?" }, { expectedRevision: seen }),
  ).rejects.toThrow(conflict);
  await expect(
    command({ type: "closeIssue", issueId: b.id, outcome: "dropped", note: "no" }, { expectedRevision: seen }),
  ).rejects.toThrow(conflict);
  expect((await board()).revision).toBe(5);

  // The user editing Alpha in the app moves the revision too.
  await issues.request("desktop/issues/update", { id: a.id, title: "Alpha (user)" }, { type: "user" });
  await expect(
    command({ type: "editIssue", issueId: a.id, details: { title: "Alpha (roder)" } }, { expectedRevision: 5 }),
  ).rejects.toThrow(`issue ${a.id} changed at revision 6, after your expectedRevision 5`);
  await expect(
    command({ type: "editIssue", issueId: a.id, details: { title: "Alpha (roder)" } }, { expectedRevision: 6 }),
  ).resolves.toMatchObject({ revision: 7, issue: { title: "Alpha (roder)" } });
  await roders.stop();
});

test("a stale revision conflicts on a file only when that file changed", async () => {
  const { roders, roder, command, board } = await setup();
  const seen = (await board()).revision;
  await roders.handleRequest("desktop/roders/files/write", {
    id: roder.id,
    path: "NOTES.md",
    content: "User note",
    expectedVersion: 1,
  });
  // WORKERS.md didn't change, so a write to it against the old revision applies.
  await expect(
    command(
      { type: "writeFile", path: "WORKERS.md", content: "Run tests.", expectedVersion: 1 },
      { expectedRevision: seen },
    ),
  ).resolves.toMatchObject({ file: { path: "WORKERS.md", version: 2 } });
  await expect(
    command(
      { type: "writeFile", path: "NOTES.md", content: "Roder note", expectedVersion: 2 },
      { expectedRevision: seen },
    ),
  ).rejects.toThrow(
    `Roder revision conflict: file NOTES.md changed at revision 1, after your expectedRevision 0. Re-read it with roder_files {path: "NOTES.md"}, then retry with expectedRevision 2 and a new commandId`,
  );
  await roders.stop();
});

test("setStatus needs the exact current revision, and no revision may be from the future", async () => {
  const { roders, command } = await setup();
  await command(todo("Bump"));
  await expect(command({ type: "setStatus", status: "paused" }, { expectedRevision: 0 })).rejects.toThrow(
    "Roder revision conflict: expected 0, current revision is 1. setStatus needs the exact current revision",
  );
  await expect(command({ type: "setStatus", status: "paused" }, { expectedRevision: 1 })).resolves.toMatchObject({
    revision: 2,
  });
  await expect(command(todo("Later"), { expectedRevision: 9 })).rejects.toThrow(/expected 9, current revision is 2/);
  await roders.stop();
});

test("every action reaches its service, acting as the Roder", async () => {
  const { roders, roder, command, read, file, board } = await setup();
  const pr = "https://github.com/team/repo/pull/7";

  const created = (await command(todo("Release 1.0"))).issue!;
  const project = (await board()).project!;
  expect(await read(created.id)).toMatchObject({ projectId: project.id, status: "todo", owner: { type: "roder" } });
  expect((await read(created.id)).activity[0]).toMatchObject({ kind: "created", actor: { type: "roder" } });

  await command({ type: "editIssue", issueId: created.id, details: { title: "Release 1.0.0", priority: "high" } });
  expect(await read(created.id)).toMatchObject({ title: "Release 1.0.0", priority: "high" });

  await command({ type: "commentIssue", issueId: created.id, text: "Changelog drafted" });
  expect((await read(created.id)).activity.at(-1)).toMatchObject({
    kind: "comment",
    text: "Changelog drafted",
    actor: { type: "roder" },
  });

  await command({ type: "linkIssuePullRequest", issueId: created.id, url: pr, title: "Release" });
  expect((await read(created.id)).pullRequests).toEqual([{ url: pr, title: "Release" }]);
  await command({ type: "unlinkIssuePullRequest", issueId: created.id, url: pr });
  expect((await read(created.id)).pullRequests).toEqual([]);

  await command({ type: "askUser", issueId: created.id, question: "Ship today?", recommendation: "Yes" });
  expect(await read(created.id)).toMatchObject({ status: "needs_you", owner: { type: "user" } });

  // The agent lifecycle still applies, with errors that name roder_command actions.
  const other = (await command(todo("Docs"))).issue!;
  await expect(command({ type: "editIssue", issueId: other.id, details: { status: "in_review" } })).rejects.toThrow(
    "link the pull request with roder_command linkIssuePullRequest before moving the issue to in_review",
  );
  await expect(command({ type: "closeIssue", issueId: other.id, outcome: "merged", note: "Merged" })).rejects.toThrow(
    /link the merged pull request/,
  );
  await command({ type: "linkIssuePullRequest", issueId: other.id, url: pr });
  await command({ type: "closeIssue", issueId: other.id, outcome: "merged", note: "Merged #7" });
  expect((await read(other.id)).status).toBe("done");

  await command({ type: "writeFile", path: "NOTES.md", content: "Decision: ship", expectedVersion: 1 });
  expect(await file("NOTES.md")).toMatchObject({ content: "Decision: ship", version: 2, author: "roder" });
  await command({ type: "restoreFile", path: "NOTES.md", version: 1, expectedVersion: 2 });
  expect(await file("NOTES.md")).toMatchObject({ content: "", version: 3, restoredFrom: 1 });
  await command({ type: "writeFile", path: "INSTRUCTIONS.md", content: "Ship monthly releases.", expectedVersion: 1 });
  expect(((await roders.handleRequest("desktop/roders/read", { id: roder.id })) as RoderAgentDetail).mission).toBe(
    "Ship monthly releases.",
  );
  await expect(
    command({ type: "writeFile", path: "AGENTS.md", content: "My rules", expectedVersion: 1 }),
  ).rejects.toThrow(/only the user edits it/);

  await roders.handleRequest("desktop/roders/update", { id: roder.id, enabled: true });
  await expect(command({ type: "setStatus", status: "paused" })).resolves.toMatchObject({ status: "paused" });
  expect(((await roders.handleRequest("desktop/roders/read", { id: roder.id })) as RoderAgentDetail).enabled).toBe(
    false,
  );
  await expect(command({ type: "setStatus", status: "active" })).rejects.toThrow(/Only the user makes a Roder active/);
  await roders.stop();
});

test("roder_issue returns the whole board or one issue in full", async () => {
  const { roders, roder, thread, command, board } = await setup();
  const long = "x".repeat(800);
  const issue = (await command({ type: "createIssue", details: { title: "Long", description: long } })).issue!;
  await command({ type: "commentIssue", issueId: issue.id, text: "one" });
  const all = await board();
  expect(all).toMatchObject({ revision: 2, issues: [{ id: issue.id, activityCount: 2 }] });
  expect(all.issues[0].description).toContain("read it in full with roder_issue");
  const one = (await roders.handleTool("roder_issue", { roderId: roder.id, issueId: issue.id }, thread)) as {
    revision: number;
    issue: Issue;
  };
  expect(one.revision).toBe(2);
  expect(one.issue.description).toBe(long);
  expect(one.issue.activity.map((entry) => entry.kind)).toEqual(["created", "comment"]);
  expect(
    (
      (await roders.handleTool("roder_issue", { roderId: roder.id, issueId: `#${issue.number}` }, thread)) as {
        issue: Issue;
      }
    ).issue.id,
  ).toBe(issue.id);
  await expect(roders.handleTool("roder_issue", { roderId: roder.id, issueId: "nope" }, thread)).rejects.toThrow(
    /not on this Roder's board/,
  );
  await roders.stop();
});

test("the tools act only for the calling thread's own Roder", async () => {
  const { roders, roder, thread } = await setup();
  await expect(
    roders.handleTool("roder_command", { commandId: "x", roderId: "someone-else", action: todo("x") }, thread),
  ).rejects.toThrow(`roderId must be this thread's Roder id, "${roder.id}"`);
  await expect(roders.handleTool("roder_issue", { roderId: "someone-else" }, thread)).rejects.toThrow(
    /this thread's Roder id/,
  );
  await expect(
    roders.handleTool("roder_command", { commandId: "x", roderId: roder.id, action: todo("x") }, { threadId: "other" }),
  ).rejects.toThrow(/owning Roder thread/);
  expect(await roders.contextForThread(roder.threadId)).toContain(`Your roderId is "${roder.id}"`);
  await roders.stop();
});

test("the tool description and schema list exactly the actions in the action table", () => {
  const types = roderActions.map((action) => action.type);
  expect(types).toEqual([
    "createIssue",
    "editIssue",
    "commentIssue",
    "linkIssuePullRequest",
    "unlinkIssuePullRequest",
    "askUser",
    "closeIssue",
    "writeFile",
    "restoreFile",
    "delegate",
    "messageWorker",
    "stopWorker",
    "releaseWorker",
    "setStatus",
  ]);
  const tool = roderAgentToolDefinitions.find((entry) => entry.name === "roder_command")!;
  expect(tool.description).toBe(roderCommandDescription());
  expect(roderAgentToolDefinitions.map((entry) => entry.name)).toContain("roder_issue");
  expect(roderAgentToolDefinitions.map((entry) => entry.name)).not.toContain("roder_memory_write");

  // The schema: one variant per table entry, with the table's fields and required fields.
  const parameters = tool.parameters as {
    required: string[];
    properties: { action: { anyOf: Record<string, unknown>[] } };
  };
  expect(parameters.required).toEqual(["commandId", "roderId", "action"]);
  const variants = parameters.properties.action.anyOf.filter((variant) => variant.type === "object") as {
    properties: Record<string, { const?: string }>;
    required: string[];
  }[];
  expect(variants.map((variant) => variant.properties.type.const)).toEqual(types);
  for (const [at, action] of roderActions.entries()) {
    expect(Object.keys(variants[at].properties).sort()).toEqual(
      ["type", ...action.fields.map((field) => field.name)].sort(),
    );
    expect(variants[at].required).toEqual([
      "type",
      ...action.fields.filter((field) => field.required).map((field) => field.name),
    ]);
  }

  // The description: its action list names exactly the table's actions, with their signatures.
  const catalog = tool.description.match(/^Actions \(\? = optional\): (.*)\.$/m)![1];
  expect(catalog.split("; ")).toEqual(roderActions.map(roderActionSignature));
  expect(catalog.split("; ").map((signature) => signature.split(" ")[0])).toEqual(types);
  for (const type of types) expect(tool.description).toContain(`\n${type}: `);
  expect(tool.description).toContain("restoreFile {path, version, expectedVersion}");

  // The parser accepts exactly the table's actions.
  expect(() => parseRoderAction({ type: "archiveWorker" })).toThrow(/Unknown action type "archiveWorker"/);
  expect(() => parseRoderAction({ type: "commentIssue", issueId: "1" })).toThrow(
    "Missing text. commentIssue takes commentIssue {issueId, text}",
  );
  expect(() => parseRoderAction({ type: "setStatus", status: "paused", extra: 1 })).toThrow(/Unknown field extra/);
});

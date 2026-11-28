import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { roderThreadInstructions } from "../electron/roder-agents/brief";
import { RoderAgentEditor } from "../src/components/roder-agents-page";
import type { RoderAgentDetail } from "../src/types/roder-agents";
import { roderWithBoard, todo } from "./helpers-roder-agent";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    search: _search,
    ...props
  }: ComponentProps<"a"> & { to: string; params: { threadId: string }; search?: unknown }) =>
    createElement("a", { ...props, href: to.replace("$threadId", params.threadId) }),
}));

/** Everything a fresh conversation must leave alone. */
async function kept(setup: Awaited<ReturnType<typeof roderWithBoard>>) {
  const { roders, roder, issues, detail } = setup;
  const { threadId: _threadId, previousThreadIds: _previous, files, ...state } = await detail();
  const contents = await Promise.all(
    files.map((file) => roders.handleRequest("desktop/roders/files/read", { id: roder.id, path: file.path })),
  );
  const { projects } = await issues.request("desktop/projects/list", {});
  const board = await issues.request("desktop/issues/list", { projectId: projects[0].id });
  return { state, files, contents, issues: board.issues };
}

async function prepared() {
  const setup = await roderWithBoard();
  const { roders, roder, command, write } = setup;
  await command(todo("Cut the release"));
  const asked = await command(todo("Pick a date"));
  await command({ type: "askUser", issueId: asked.issue!.id, question: "Friday or Monday?" });
  await write("AGENTS.md", "Never touch billing.", 1);
  await command({ type: "writeFile", path: "NOTES.md", content: "Release is on Friday.", expectedVersion: 1 });
  await roders.handleRequest("desktop/roders/update", {
    id: roder.id,
    enabled: true,
    maxRunsPerDay: 7,
    maxRunMinutes: 20,
    intervalMinutes: 0,
  });
  await roders.handleRequest("desktop/roders/schedule", {
    id: roder.id,
    at: Date.now() + 3_600_000,
    reason: "Check CI",
  });
  return setup;
}

test("the page's fresh conversation keeps files, issues and budgets and links the old thread", async () => {
  const setup = await prepared();
  const { roders, roder, issues, request, detail, turn } = setup;
  await roders.handleRequest("desktop/roders/run", { id: roder.id });
  await roders.onNotification("turn/completed", { threadId: roder.threadId, turn: { id: "turn-1" } });
  const before = await kept(setup);
  expect(before.state).toMatchObject({ enabled: true, maxRunsPerDay: 7, maxRunMinutes: 20, active: null });
  expect(before.state.runs).toHaveLength(1);
  expect(before.state.wakes).toHaveLength(1);
  request.mockClear();

  const moved = (await roders.handleRequest("desktop/roders/freshConversation", { id: roder.id })) as RoderAgentDetail;
  expect(moved.threadId).toBe("thread-2");
  expect(moved.previousThreadIds).toEqual(["thread-1"]);
  // The new thread starts in the same workspace, with the tools the host adds to every thread/start.
  expect(request).toHaveBeenCalledWith("thread/start", {
    workspaceId: "ws",
    ephemeral: false,
    developerInstructions: roderThreadInstructions,
  });
  // The old thread is only read, never changed.
  expect(request.mock.calls.map(([method]) => method)).toEqual(["thread/read", "thread/start"]);
  expect(await kept(setup)).toEqual(before);

  // The board follows the Roder to its new thread.
  expect((await issues.request("desktop/projects/list", {})).projects[0].roderThreadId).toBe("thread-2");

  // The new conversation starts over: brief, board and notes.
  const first = await turn();
  expect(first).toContain("You are Release, a Roder: ");
  expect(first).toContain("## The user's rules for you (AGENTS.md, version 2)\n");
  expect(first).toContain("- #1 todo, owner roder: Cut the release");
  expect(first).toContain("- #2 needs_you, owner user: Pick a date");
  expect(first).toContain("<notes>\nRelease is on Friday.\n</notes>");

  // A second one keeps both earlier threads, oldest first, across a restart.
  await roders.handleRequest("desktop/roders/freshConversation", { id: roder.id });
  expect((await detail()).previousThreadIds).toEqual(["thread-1", "thread-2"]);
  await roders.stop();
  const saved = JSON.parse(await readFile(join(setup.directory, "roders", "roders.json"), "utf8"));
  expect(saved.roders[0]).toMatchObject({ threadId: "thread-3", previousThreadIds: ["thread-1", "thread-2"] });
  const reopened = await roderWithBoard(setup.directory);
  expect(await reopened.detail()).toMatchObject({ threadId: "thread-3", previousThreadIds: ["thread-1", "thread-2"] });
  await reopened.roders.stop();
});

test("the freshConversation action moves the Roder and its tools to the new thread", async () => {
  const setup = await prepared();
  const { roders, roder, command, detail } = setup;
  const before = await kept(setup);

  const result = await command({ type: "freshConversation" });
  expect(result).toMatchObject({ action: "freshConversation", threadId: "thread-2", previousThreadId: "thread-1" });
  expect(result.summary).toMatch(/Started a fresh conversation in thread thread-2.*end your turn/);
  expect(await detail()).toMatchObject({ threadId: "thread-2", previousThreadIds: ["thread-1"] });
  expect(await kept(setup)).toEqual(before);

  // Tools answer the new thread and tell the old one where they went.
  const board = (await roders.handleTool("roder_issue", { roderId: roder.id }, { threadId: "thread-2" })) as {
    issues: unknown[];
  };
  expect(board.issues).toHaveLength(2);
  await expect(roders.handleTool("roder_issue", { roderId: roder.id }, { threadId: "thread-1" })).rejects.toThrow(
    /previous conversation of the Roder Release.*current thread/,
  );
  // A turn in the old thread is an ordinary turn now.
  const old = { threadId: "thread-1", input: [{ type: "text", text: "Still there?" }] };
  expect(await roders.turnStartParams(old)).toBe(old);
  // The Roder still acts as the project's Roder on its issues.
  const commented = await command({ type: "commentIssue", issueId: "1", text: "Carrying on" });
  expect(commented.issue!.recentActivity.at(-1)).toMatchObject({ actor: { type: "roder" }, text: "Carrying on" });
  await roders.stop();
});

test("a fresh conversation waits for a busy thread and replaces a missing one", async () => {
  const { roders, roder, request, engine, detail } = await roderWithBoard();
  await roders.handleRequest("desktop/roders/run", { id: roder.id });
  await expect(roders.handleRequest("desktop/roders/freshConversation", { id: roder.id })).rejects.toThrow(
    /Wait for the active run/,
  );
  await roders.onNotification("turn/completed", { threadId: roder.threadId, turn: { id: "turn-1" } });

  const idle = request.getMockImplementation()!;
  request.mockImplementation(async (method, params) =>
    method === "thread/read" ? { thread: { id: "thread-1", status: { type: "active" } } } : idle(method, params),
  );
  await expect(roders.handleRequest("desktop/roders/freshConversation", { id: roder.id })).rejects.toThrow(
    /Roder thread is busy/,
  );
  expect(engine.threads).toBe(1);
  expect(await detail()).toMatchObject({ threadId: "thread-1", previousThreadIds: [] });

  // A thread the engine no longer has is exactly what a fresh conversation recovers from.
  request.mockImplementation(async (method, params) =>
    method === "thread/read" ? { thread: null } : idle(method, params),
  );
  await roders.handleRequest("desktop/roders/freshConversation", { id: roder.id });
  expect(await detail()).toMatchObject({ threadId: "thread-2", previousThreadIds: ["thread-1"] });
  await roders.stop();
});

test("the editor offers a fresh conversation and links every previous thread", async () => {
  const setup = await roderWithBoard();
  const current = await setup.detail();
  const render = (agent: RoderAgentDetail) =>
    renderToStaticMarkup(
      createElement(RoderAgentEditor, {
        initial: agent,
        status: agent,
        busy: false,
        observedAt: 0,
        showThreadLink: false,
        perform: async (action) => action(),
      }),
    );
  const fresh = render(current);
  expect(fresh).toContain("Fresh conversation");
  expect(fresh).not.toContain("Previous conversations");

  const moved = render({ ...current, threadId: "thread-3", previousThreadIds: ["thread-1", "thread-2"] });
  expect(moved).toContain("Previous conversations");
  expect(moved).toMatch(/href="\/threads\/thread-1"[^>]*>Conversation 1</);
  expect(moved).toMatch(/href="\/threads\/thread-2"[^>]*>Conversation 2</);
  expect(moved).not.toContain("Conversation 3");
  await setup.roders.stop();
});

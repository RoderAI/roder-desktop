import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, vi } from "vitest";
import { IssuesService } from "../electron/issues/service";
import { createRoderAgentService } from "../electron/roder-agents/service";
import type { Issue } from "../src/types/issues";
import type { RoderAgentDetail, RoderFile } from "../src/types/roder-agents";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});

export type CommandResult = {
  revision: number;
  action: string;
  summary: string;
  issue?: Issue;
  file?: RoderFile;
  threadId?: string;
};

/**
 * A Roder named Release with an issue board, as the desktop sets one up. The
 * fake engine hands out thread ids thread-1, thread-2, ... and accepts turns
 * unless `engine.failTurns` is set. Pass `directory` to reopen saved state.
 */
export async function roderWithBoard(directory?: string) {
  directory ??= await mkdtemp(join(tmpdir(), "roder-agent-test-"));
  if (!directories.includes(directory)) directories.push(directory);
  const engine = { threads: 0, failTurns: false };
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async (method, params) => {
    if (method === "thread/start") return { thread: { id: `thread-${++engine.threads}` } };
    if (method === "thread/read")
      return { thread: { id: (params as { threadId: string }).threadId, status: { type: "idle" }, turns: [] } };
    if (method === "memory/query") return { results: [] };
    if (method === "turn/start") {
      if (engine.failTurns) throw new Error("engine refused the turn");
      return { turnId: "turn-1" };
    }
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
  const id = roder.id;
  const detail = () => roders.handleRequest("desktop/roders/read", { id }) as Promise<RoderAgentDetail>;
  /** A roder_command from the Roder's current thread. */
  const command = async (action: unknown) =>
    roders.handleTool(
      "roder_command",
      { commandId: randomUUID(), roderId: id, action },
      { threadId: (await detail()).threadId },
    ) as Promise<CommandResult>;
  /** The text of the turn the app starts when the user sends `message` in the Roder's thread. */
  const turn = async (message = "Hello") => {
    const params = (await roders.turnStartParams({
      threadId: (await detail()).threadId,
      input: [{ type: "text", text: message }],
    })) as { input: { text: string }[] };
    return params.input[0].text;
  };
  const write = (path: string, content: string, expectedVersion: number) =>
    roders.handleRequest("desktop/roders/files/write", { id, path, content, expectedVersion });
  return { directory, roders, roder, issues, request, engine, detail, command, turn, write };
}

export const todo = (title: string) => ({
  type: "createIssue",
  details: { title, status: "todo", doneCriteria: `${title} is done` },
});

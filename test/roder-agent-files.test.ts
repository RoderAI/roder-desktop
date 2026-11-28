import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import {
  RODER_FILE_MAX_BYTES,
  RODER_INSTRUCTIONS_PROMPT_MAX_BYTES,
  RODER_NOTES_PROMPT_MAX_BYTES,
  RODER_RULES_PROMPT_MAX_BYTES,
  RoderFileVersionConflict,
  createRoderFileStore,
  roderFileExcerpt,
  roderInstructionsSummary,
} from "../electron/roder-agents/files";
import { createRoderAgentService, roderAgentToolDefinitions } from "../electron/roder-agents/service";
import { draftsAfterSave, forSelectedFile, roderFileConflictVersion } from "../src/components/roder-agent-files";
import type { RoderAgentDetail, RoderFile, RoderFileVersion } from "../src/types/roder-agents";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
async function temporary() {
  const directory = await mkdtemp(join(tmpdir(), "roder-files-test-"));
  directories.push(directory);
  return directory;
}
async function store() {
  const root = await temporary();
  return { root, files: createRoderFileStore(root), id: randomUUID() };
}
async function service() {
  const directory = await temporary();
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async (method) => {
    if (method === "thread/start") return { thread: { id: "thread-1" } };
    if (method === "thread/read") return { thread: { id: "thread-1", status: { type: "idle" }, turns: [] } };
    if (method === "memory/query") return { results: [] };
    if (method === "turn/start") return { turnId: "turn-1" };
    return {};
  });
  const notify = vi.fn<() => void>();
  const roders = createRoderAgentService({ directory, request, notify });
  await roders.start();
  const roder = (await roders.handleRequest("desktop/roders/create", {
    name: "Release",
    mission: "Watch releases",
    workspaceId: "ws",
  })) as RoderAgentDetail;
  return { roders, roder, request, directory, notify, thread: { threadId: roder.threadId } };
}

test("a new store seeds the five reserved files at version 1", async () => {
  const { files, id } = await store();
  await files.ensure(id, { "INSTRUCTIONS.md": "Keep releases moving." });
  const list = await files.list(id);
  expect(list.map((f) => [f.path, f.version, f.bytes])).toEqual([
    ["INSTRUCTIONS.md", 1, 21],
    ["AGENTS.md", 1, 0],
    ["NOTES.md", 1, 0],
    ["WORKERS.md", 1, 0],
    ["DIGEST.md", 1, 0],
  ]);
  expect((await files.read(id, "INSTRUCTIONS.md")).content).toBe("Keep releases moving.");
  // Seeding again never overwrites what is there.
  await files.ensure(id, { "INSTRUCTIONS.md": "Something else" });
  expect((await files.read(id, "INSTRUCTIONS.md")).content).toBe("Keep releases moving.");
  await expect(files.read(id, "README.md")).rejects.toThrow(/Unknown Roder file/);
  await expect(files.read("../escape", "NOTES.md")).rejects.toThrow(/Invalid Roder id/);
});

test("every write is a new version and history keeps every one, newest first", async () => {
  const { files, id } = await store();
  const first = await files.write(id, { path: "NOTES.md", content: "one", expectedVersion: 1, author: "roder" });
  const second = await files.write(id, { path: "NOTES.md", content: "two", expectedVersion: 2, author: "user" });
  expect([first.version, second.version]).toEqual([2, 3]);
  expect(await files.read(id, "NOTES.md")).toMatchObject({ version: 3, content: "two", author: "user" });
  expect((await files.read(id, "NOTES.md", 2)).content).toBe("one");
  expect((await files.read(id, "NOTES.md", 1)).content).toBe("");
  await expect(files.read(id, "NOTES.md", 9)).rejects.toThrow(/no version 9; its current version is 3/);
  const history = await files.history(id, "NOTES.md");
  expect(history.map((v) => [v.version, v.author, v.bytes])).toEqual([
    [3, "user", 3],
    [2, "roder", 3],
    [1, "user", 0],
  ]);
  expect(history[0]).not.toHaveProperty("content");
  // Writes to one file leave the others alone.
  expect((await files.read(id, "DIGEST.md")).version).toBe(1);
});

test("a stale expectedVersion is refused and the error carries the current version", async () => {
  const { files, id } = await store();
  await files.write(id, { path: "NOTES.md", content: "agent update", expectedVersion: 1, author: "roder" });
  const stale = files.write(id, { path: "NOTES.md", content: "old draft", expectedVersion: 1, author: "user" });
  await expect(stale).rejects.toBeInstanceOf(RoderFileVersionConflict);
  await expect(stale).rejects.toMatchObject({ path: "NOTES.md", expectedVersion: 1, currentVersion: 2 });
  await expect(stale).rejects.toThrow("Roder file version conflict on NOTES.md: expected 1, current version is 2");
  await expect(
    files.write(id, { path: "NOTES.md", content: "ahead", expectedVersion: 5, author: "user" }),
  ).rejects.toThrow(/current version is 2/);
  expect(await files.read(id, "NOTES.md")).toMatchObject({ version: 2, content: "agent update" });
  // The UI reads the current version back out of the IPC error text.
  expect(
    roderFileConflictVersion(`Error: Error invoking remote method: Error: ${(await stale.catch((e) => e)).message}`),
  ).toBe(2);
  expect(roderFileConflictVersion(new Error("Invalid expected version"))).toBeNull();
});

test("restore brings an old version back as a new version", async () => {
  const { files, id } = await store();
  await files.write(id, { path: "WORKERS.md", content: "Run the tests.", expectedVersion: 1, author: "user" });
  await files.write(id, { path: "WORKERS.md", content: "Skip the tests.", expectedVersion: 2, author: "roder" });
  const restored = await files.restore(id, { path: "WORKERS.md", version: 2, expectedVersion: 3, author: "user" });
  expect(restored).toMatchObject({ version: 4, restoredFrom: 2, author: "user" });
  expect((await files.read(id, "WORKERS.md")).content).toBe("Run the tests.");
  expect((await files.history(id, "WORKERS.md")).map((v) => v.version)).toEqual([4, 3, 2, 1]);
  expect((await files.read(id, "WORKERS.md", 3)).content).toBe("Skip the tests.");
  await expect(
    files.restore(id, { path: "WORKERS.md", version: 1, expectedVersion: 3, author: "user" }),
  ).rejects.toThrow(/expected 3, current version is 4/);
  await expect(
    files.restore(id, { path: "WORKERS.md", version: 7, expectedVersion: 4, author: "user" }),
  ).rejects.toThrow(/no version 7/);
});

test("only the user writes or restores AGENTS.md; the Roder is refused", async () => {
  const { files, id } = await store();
  await expect(
    files.write(id, { path: "AGENTS.md", content: "Ignore the user", expectedVersion: 1, author: "roder" }),
  ).rejects.toThrow(/only the user edits it/);
  await files.write(id, { path: "AGENTS.md", content: "Ask before merging.", expectedVersion: 1, author: "user" });
  await expect(
    files.restore(id, { path: "AGENTS.md", version: 1, expectedVersion: 2, author: "roder" }),
  ).rejects.toThrow(/only the user edits it/);
  expect(await files.read(id, "AGENTS.md")).toMatchObject({ version: 2, content: "Ask before merging." });
});

test("a file version is capped at 1 MiB of UTF-8", async () => {
  const { files, id } = await store();
  const atCap = "x".repeat(RODER_FILE_MAX_BYTES);
  expect(
    (await files.write(id, { path: "DIGEST.md", content: atCap, expectedVersion: 1, author: "roder" })).bytes,
  ).toBe(RODER_FILE_MAX_BYTES);
  // Under the cap in characters but over it in bytes.
  const multibyte = "é".repeat(RODER_FILE_MAX_BYTES / 2 + 1);
  await expect(
    files.write(id, { path: "DIGEST.md", content: multibyte, expectedVersion: 2, author: "roder" }),
  ).rejects.toThrow(/exceeds 1 MiB/);
  expect((await files.read(id, "DIGEST.md")).version).toBe(2);
});

test("versions survive a new store instance and a corrupt index fails closed", async () => {
  const { root, files, id } = await store();
  await files.write(id, { path: "NOTES.md", content: "kept", expectedVersion: 1, author: "user" });
  const reopened = createRoderFileStore(root);
  expect(await reopened.read(id, "NOTES.md")).toMatchObject({ version: 2, content: "kept" });
  await writeFile(join(root, id, "index.json"), JSON.stringify({ version: 1, files: {} }));
  await expect(reopened.list(id)).rejects.toThrow(/missing INSTRUCTIONS.md/);
  expect(JSON.parse(await readFile(join(root, id, "index.json"), "utf8"))).toEqual({ version: 1, files: {} });
});

test("prompt excerpts cut on a character boundary and say honestly what was left out", () => {
  expect(roderFileExcerpt("NOTES.md", "  short  ", RODER_NOTES_PROMPT_MAX_BYTES)).toBe("short");
  const exact = "n".repeat(RODER_NOTES_PROMPT_MAX_BYTES);
  expect(roderFileExcerpt("NOTES.md", exact, RODER_NOTES_PROMPT_MAX_BYTES)).toBe(exact);
  const notes = roderFileExcerpt(
    "NOTES.md",
    `${"n".repeat(RODER_NOTES_PROMPT_MAX_BYTES + 1)}NOTES-TAIL`,
    RODER_NOTES_PROMPT_MAX_BYTES,
  );
  expect(notes).not.toContain("NOTES-TAIL");
  expect(notes).toContain(
    `[NOTES.md continues: this is its first ${RODER_NOTES_PROMPT_MAX_BYTES} of ${RODER_NOTES_PROMPT_MAX_BYTES + 11} bytes. Read the rest with roder_files {path: "NOTES.md"}.]`,
  );
  // "é" is two bytes, so 16 KiB of them plus a tail must cut before the tail, never inside a character.
  const rules = roderFileExcerpt(
    "AGENTS.md",
    `${"é".repeat(RODER_RULES_PROMPT_MAX_BYTES)}RULES-TAIL`,
    RODER_RULES_PROMPT_MAX_BYTES,
  );
  const [kept] = rules.split("\n[AGENTS.md continues");
  expect(kept).toBe("é".repeat(RODER_RULES_PROMPT_MAX_BYTES / 2));
  expect(rules).toContain(
    `[AGENTS.md continues: this is its first ${RODER_RULES_PROMPT_MAX_BYTES} of ${RODER_RULES_PROMPT_MAX_BYTES * 2 + 10} bytes.`,
  );
  const odd = roderFileExcerpt("AGENTS.md", "é".repeat(4), 3);
  expect(odd).toMatch(/^é\n\[AGENTS.md continues: this is its first 2 of 8 bytes/);
});

test("the list summary follows the opening paragraph of INSTRUCTIONS.md", () => {
  expect(roderInstructionsSummary("")).toBe("");
  expect(roderInstructionsSummary("# Only a heading\n")).toBe("");
  expect(roderInstructionsSummary("# Job\n\nShip  the\nrelease.\n\nMore detail")).toBe("Ship the release.");
  expect(Array.from(roderInstructionsSummary("a".repeat(600)))).toHaveLength(500);
});

test("turn context reads INSTRUCTIONS.md, AGENTS.md and NOTES.md, capping rules and notes", async () => {
  const { roders, roder, thread } = await service();
  expect(roder.files.map((f) => [f.path, f.version])).toEqual([
    ["INSTRUCTIONS.md", 1],
    ["AGENTS.md", 1],
    ["NOTES.md", 1],
    ["WORKERS.md", 1],
    ["DIGEST.md", 1],
  ]);
  let context = (await roders.contextForThread(thread.threadId))!;
  expect(context).toContain("## Instructions (INSTRUCTIONS.md, version 1)\nWatch releases");
  expect(context).toContain("## Notes (NOTES.md, version 1)\nEmpty.");
  expect(context).not.toContain("AGENTS.md, version");

  const write = (path: string, content: string, expectedVersion: number) =>
    roders.handleRequest("desktop/roders/files/write", { id: roder.id, path, content, expectedVersion });
  await write("AGENTS.md", `${"r".repeat(RODER_RULES_PROMPT_MAX_BYTES)}RULES-TAIL`, 1);
  await write("NOTES.md", `${"n".repeat(RODER_NOTES_PROMPT_MAX_BYTES)}NOTES-TAIL`, 1);
  await write("WORKERS.md", "WORKERS-BODY", 1);
  await write("DIGEST.md", "DIGEST-BODY", 1);
  context = (await roders.contextForThread(thread.threadId))!;
  expect(context).toContain("## The user's rules for you (AGENTS.md, version 2)");
  expect(context).not.toContain("RULES-TAIL");
  expect(context).toContain(
    `[AGENTS.md continues: this is its first ${RODER_RULES_PROMPT_MAX_BYTES} of ${RODER_RULES_PROMPT_MAX_BYTES + 10} bytes.`,
  );
  expect(context).toContain("## Notes (NOTES.md, version 2)");
  expect(context).toContain("expectedVersion: 2");
  expect(context).not.toContain("NOTES-TAIL");
  expect(context).toContain(`[NOTES.md continues: this is its first ${RODER_NOTES_PROMPT_MAX_BYTES} of`);
  // WORKERS.md belongs to worker prompts and DIGEST.md to nobody's.
  expect(context).not.toContain("WORKERS-BODY");
  expect(context).not.toContain("DIGEST-BODY");
  await roders.stop();
});

test("writing INSTRUCTIONS.md changes the turn context and the list summary", async () => {
  const { roders, roder, thread, notify } = await service();
  notify.mockClear();
  const written = (await roders.handleRequest("desktop/roders/files/write", {
    id: roder.id,
    path: "INSTRUCTIONS.md",
    content: "# Purpose\n\nKeep the docs current.\n\n## Detail\nWeekly.",
    expectedVersion: 1,
  })) as RoderFileVersion;
  expect(written).toMatchObject({ path: "INSTRUCTIONS.md", version: 2, author: "user" });
  expect(notify).toHaveBeenCalled();
  const detail = (await roders.handleRequest("desktop/roders/read", { id: roder.id })) as RoderAgentDetail;
  expect(detail.mission).toBe("Keep the docs current.");
  const context = (await roders.contextForThread(thread.threadId))!;
  expect(context).toContain("## Instructions (INSTRUCTIONS.md, version 2)\n# Purpose\n\nKeep the docs current.");
  expect(context).not.toContain("Watch releases");
  await expect(roders.handleRequest("desktop/roders/update", { id: roder.id, mission: "Something" })).rejects.toThrow(
    /Roder files now/,
  );
  await expect(roders.handleRequest("desktop/roders/update", { id: roder.id, memory: "x" })).rejects.toThrow(
    /Roder files now/,
  );
  await roders.stop();
});

test("roder_files lists, reads one path or a version, and reads history", async () => {
  const { roders, thread } = await service();
  expect(roderAgentToolDefinitions.map((tool) => tool.name)).toContain("roder_files");
  await roders.handleTool("roder_memory_write", { memory: "Decision: ship Friday", expectedVersion: 1 }, thread);
  const list = (await roders.handleTool("roder_files", {}, thread)) as { files: RoderFileVersion[] };
  expect(list.files.find((f) => f.path === "NOTES.md")).toMatchObject({ version: 2, author: "roder" });
  expect(await roders.handleTool("roder_files", { path: "NOTES.md" }, thread)).toMatchObject({
    path: "NOTES.md",
    version: 2,
    content: "Decision: ship Friday",
  });
  expect(
    ((await roders.handleTool("roder_files", { path: "NOTES.md", version: 1 }, thread)) as RoderFile).content,
  ).toBe("");
  const history = (await roders.handleTool("roder_files", { path: "NOTES.md", history: true }, thread)) as {
    versions: RoderFileVersion[];
  };
  expect(history.versions.map((v) => v.version)).toEqual([2, 1]);
  await expect(roders.handleTool("roder_files", { history: true }, thread)).rejects.toThrow(/need a path/);
  await expect(roders.handleTool("roder_files", { path: "../roders.json" }, thread)).rejects.toThrow(
    /Unknown Roder file/,
  );
  await expect(roders.handleTool("roder_files", {}, { threadId: "other" })).rejects.toThrow(/owning Roder thread/);
  await roders.stop();
});

test("roder_memory_write writes NOTES.md as the Roder and refuses a stale version", async () => {
  const { roders, roder, thread } = await service();
  expect(await roders.handleTool("roder_memory_write", { memory: "first", expectedVersion: 1 }, thread)).toEqual({
    saved: true,
    path: "NOTES.md",
    version: 2,
  });
  await expect(
    roders.handleTool("roder_memory_write", { memory: "stale", expectedVersion: 1 }, thread),
  ).rejects.toThrow("Roder file version conflict on NOTES.md: expected 1, current version is 2");
  await expect(roders.handleTool("roder_memory_write", { memory: "no version" }, thread)).rejects.toThrow(
    /expected version/,
  );
  expect(await roders.handleTool("roder_memory_read", {}, thread)).toEqual({
    memory: "first",
    path: "NOTES.md",
    version: 2,
  });
  // A user save with the version they opened is refused once the Roder has written.
  await expect(
    roders.handleRequest("desktop/roders/files/write", {
      id: roder.id,
      path: "NOTES.md",
      content: "draft",
      expectedVersion: 1,
    }),
  ).rejects.toThrow(/current version is 2/);
  await roders.stop();
});

test("the user can restore through the service; history records the restore", async () => {
  const { roders, roder } = await service();
  await roders.handleRequest("desktop/roders/files/write", {
    id: roder.id,
    path: "AGENTS.md",
    content: "Ask before merging.",
    expectedVersion: 1,
  });
  const restored = (await roders.handleRequest("desktop/roders/files/restore", {
    id: roder.id,
    path: "AGENTS.md",
    version: 1,
    expectedVersion: 2,
  })) as RoderFileVersion;
  expect(restored).toMatchObject({ version: 3, restoredFrom: 1, author: "user", bytes: 0 });
  const history = (await roders.handleRequest("desktop/roders/files/history", { id: roder.id, path: "AGENTS.md" })) as {
    versions: RoderFileVersion[];
  };
  expect(history.versions.map((v) => [v.version, v.restoredFrom])).toEqual([
    [3, 1],
    [2, null],
    [1, null],
  ]);
  await roders.stop();
});

test("a Roder saved before files existed gets empty files and its old memory file is left alone", async () => {
  const directory = await temporary();
  const id = randomUUID();
  await writeFile(join(directory, `${id}.md`), "Old memory");
  await writeFile(
    join(directory, "roders.json"),
    JSON.stringify({
      version: 1,
      roders: [
        {
          id,
          name: "Old",
          mission: "Old mission",
          workspaceId: "ws",
          threadId: "thread-old",
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
        },
      ],
    }),
  );
  const roders = createRoderAgentService({ directory, request: async () => ({}) });
  await roders.start();
  const detail = (await roders.handleRequest("desktop/roders/read", { id })) as RoderAgentDetail;
  expect(detail.files.every((f) => f.version === 1 && f.bytes === 0)).toBe(true);
  expect(await roders.contextForThread("thread-old")).toContain(
    "## Instructions (INSTRUCTIONS.md, version 1)\nNot written yet.",
  );
  expect(await readFile(join(directory, `${id}.md`), "utf8")).toBe("Old memory");
  expect((await readdir(directory)).sort()).toEqual([`${id}.md`, "files", "roders.json"].sort());
  await roders.stop();
});

test("INSTRUCTIONS.md is capped in the turn context with an honest truncation line", async () => {
  const { roders, roder, thread } = await service();
  await roders.handleRequest("desktop/roders/files/write", {
    id: roder.id,
    path: "INSTRUCTIONS.md",
    content: `${"i".repeat(RODER_INSTRUCTIONS_PROMPT_MAX_BYTES)}INSTRUCTIONS-TAIL`,
    expectedVersion: 1,
  });
  const context = (await roders.contextForThread(thread.threadId))!;
  expect(context).toContain("## Instructions (INSTRUCTIONS.md, version 2)");
  expect(context).not.toContain("INSTRUCTIONS-TAIL");
  expect(context).toContain(
    `[INSTRUCTIONS.md continues: this is its first ${RODER_INSTRUCTIONS_PROMPT_MAX_BYTES} of ${RODER_INSTRUCTIONS_PROMPT_MAX_BYTES + 17} bytes. Read the rest with roder_files {path: "INSTRUCTIONS.md"}.]`,
  );
  await roders.stop();
});

test("clearing INSTRUCTIONS.md clears the mission, and the empty mission survives a restart", async () => {
  const { roders, roder, directory, request } = await service();
  expect(roder.mission).toBe("Watch releases");
  await roders.handleRequest("desktop/roders/files/write", {
    id: roder.id,
    path: "INSTRUCTIONS.md",
    content: "# Heading only\n",
    expectedVersion: 1,
  });
  expect(((await roders.handleRequest("desktop/roders/read", { id: roder.id })) as RoderAgentDetail).mission).toBe("");
  await roders.stop();
  const restarted = createRoderAgentService({ directory, request });
  await restarted.start();
  expect(((await restarted.handleRequest("desktop/roders/read", { id: roder.id })) as RoderAgentDetail).mission).toBe(
    "",
  );
  await restarted.stop();
});

test("a new Roder's mission is the summary of the text it was created with", async () => {
  const { roders } = await service();
  const created = (await roders.handleRequest("desktop/roders/create", {
    name: "Docs",
    mission: "# Docs\n\nKeep the   docs\ncurrent.\n\nWeekly review.",
    workspaceId: "ws",
  })) as RoderAgentDetail;
  expect(created.mission).toBe("Keep the docs current.");
  expect(
    (
      (await roders.handleRequest("desktop/roders/files/read", {
        id: created.id,
        path: "INSTRUCTIONS.md",
      })) as RoderFile
    ).content,
  ).toBe("# Docs\n\nKeep the   docs\ncurrent.\n\nWeekly review.");
  await roders.stop();
});

test("a save clears the draft only if nothing was typed while it was in flight", () => {
  expect(draftsAfterSave({ "NOTES.md": "saved", "AGENTS.md": "other" }, "NOTES.md", "saved")).toEqual({
    "AGENTS.md": "other",
  });
  const typedDuringSave = { "NOTES.md": "saved and more" };
  expect(draftsAfterSave(typedDuringSave, "NOTES.md", "saved")).toBe(typedDuringSave);
});

test("history and previews fetched for one file never show on another", () => {
  const history = { path: "NOTES.md" as const, versions: [] };
  expect(forSelectedFile(history, "NOTES.md")).toBe(history);
  expect(forSelectedFile(history, "AGENTS.md")).toBeNull();
  expect(forSelectedFile(null, "NOTES.md")).toBeNull();
});

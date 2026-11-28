import { expect, test } from "vitest";
import { roderActionSignature, roderActions } from "../electron/roder-agents/actions";
import { roderGuideFile, roderGuideIndex, roderGuidePaths, roderGuides } from "../electron/roder-agents/guide";
import { roderAgentToolDefinitions } from "../electron/roder-agents/service";
import { issueStatuses } from "../src/types/issues";
import type { RoderFile } from "../src/types/roder-agents";
import { roderWithBoard } from "./helpers-roder-agent";

test("there are five guides and the index lists each", () => {
  expect(roderGuidePaths).toEqual([
    "guide/commands.md",
    "guide/lifecycle.md",
    "guide/failures.md",
    "guide/issues.md",
    "guide/reporting.md",
  ]);
  const index = roderGuideIndex().split("\n");
  expect(index).toHaveLength(5);
  roderGuides().forEach((guide, at) => expect(index[at]).toBe(`- ${guide.path}: ${guide.when}.`));
});

test("the commands guide lists exactly the actions in the action table", () => {
  const guide = roderGuideFile("guide/commands.md").content;
  const section = guide.slice(guide.indexOf("## Actions\n") + "## Actions\n".length, guide.indexOf("\n\n## Fields"));
  expect(section.split("\n")).toEqual(
    roderActions.map((action) => `- ${roderActionSignature(action)}: ${action.summary}`),
  );
  expect(guide).toContain(`Actions (? = optional): ${roderActions.map(roderActionSignature).join("; ")}.`);
  expect(guide).toContain(`Status values: ${issueStatuses.join(", ")}.`);
});

test("guides name Roder tools, never Zuse's", () => {
  for (const guide of roderGuides()) {
    expect(guide.body).not.toMatch(/zapper|Zapper|Zuse|chatId|inProgress|needsYou/);
    expect(guide.body.startsWith("# ")).toBe(true);
  }
  expect(() => roderGuideFile("guide/missing.md")).toThrow(
    /No guide at guide\/missing\.md; the guides are guide\/commands\.md/,
  );
});

test("roder_files lists and reads the guides", async () => {
  const { roders, roder } = await roderWithBoard();
  const thread = { threadId: roder.threadId };
  const tool = roderAgentToolDefinitions.find((entry) => entry.name === "roder_files")!;
  expect(tool.parameters.properties.path.enum).toEqual(expect.arrayContaining(roderGuidePaths));

  const listed = (await roders.handleTool("roder_files", {}, thread)) as {
    files: unknown[];
    guides: { path: string; readOnly: boolean; when: string }[];
  };
  expect(listed.files).toHaveLength(5);
  expect(listed.guides.map((guide) => guide.path)).toEqual(roderGuidePaths);
  expect(listed.guides.every((guide) => guide.readOnly && guide.when)).toBe(true);

  for (const guide of roderGuides())
    expect(await roders.handleTool("roder_files", { path: guide.path }, thread)).toEqual({
      path: guide.path,
      version: 0,
      readOnly: true,
      content: guide.body,
    });
  // The Roders page reads them through the same path.
  expect(
    await roders.handleRequest("desktop/roders/files/read", { id: roder.id, path: "guide/issues.md" }),
  ).toMatchObject({ readOnly: true, content: expect.stringContaining("# Writing issues") });
  await expect(roders.handleTool("roder_files", { path: "guide/nope.md" }, thread)).rejects.toThrow(/No guide at/);
  await expect(roders.handleTool("roder_files", { path: "guide/commands.md", version: 1 }, thread)).rejects.toThrow(
    /Guides have no versions/,
  );
  await expect(roders.handleTool("roder_files", { path: "guide/commands.md", history: true }, thread)).rejects.toThrow(
    /Guides have no versions/,
  );
  await roders.stop();
});

test("writes and restores under guide/ are refused for the Roder and the user", async () => {
  const { roders, roder, command } = await roderWithBoard();
  const readOnly = /guide\/commands\.md is read-only/;
  await expect(
    command({ type: "writeFile", path: "guide/commands.md", content: "mine now", expectedVersion: 0 }),
  ).rejects.toThrow(readOnly);
  await expect(
    command({ type: "restoreFile", path: "guide/commands.md", version: 0, expectedVersion: 0 }),
  ).rejects.toThrow(readOnly);
  await expect(
    roders.handleRequest("desktop/roders/files/write", {
      id: roder.id,
      path: "guide/commands.md",
      content: "mine now",
      expectedVersion: 0,
    }),
  ).rejects.toThrow(readOnly);
  await expect(
    roders.handleRequest("desktop/roders/files/restore", {
      id: roder.id,
      path: "guide/commands.md",
      version: 0,
      expectedVersion: 0,
    }),
  ).rejects.toThrow(readOnly);
  const guide = (await roders.handleTool(
    "roder_files",
    { path: "guide/commands.md" },
    { threadId: roder.threadId },
  )) as RoderFile;
  expect(guide.content).toBe(roderGuideFile("guide/commands.md").content);
  await roders.stop();
});

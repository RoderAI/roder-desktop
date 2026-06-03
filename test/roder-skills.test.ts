import { expect, test } from "vitest";
import {
  deleteSkillTokenAtCaret,
  enabledSkillsForCompletion,
  filterSkills,
  humanizedSkillName,
  matchingSkillCompletions,
  replaceSkillToken,
  skillTokenRanges,
  skillCompletionToken,
  skillSourceGroupLabel,
} from "../src/lib/roder-skills";
import type { SkillDescriptor } from "../src/types/roder";

test("labels skill source groups for desktop settings", () => {
  expect(skillSourceGroupLabel("builtIn")).toBe("Built in");
  expect(skillSourceGroupLabel("workspace")).toBe("Workspace");
  expect(skillSourceGroupLabel({ pluginId: "repo-tools" })).toBe("Plugin: repo-tools");
  expect(skillSourceGroupLabel({ importId: "workflow-a" })).toBe("Imported: workflow-a");
});

test("filters skills by searchable metadata", () => {
  const skills = [
    skill({ name: "commit", description: "Create a scoped git commit", source: "builtIn" }),
    skill({
      name: "ai-sdk",
      description: "Use streamText and generateText",
      shortDescription: "AI SDK helpers",
      canonicalPath: "/skills/ai-sdk/SKILL.md",
      source: "user",
    }),
  ];

  expect(filterSkills(skills, "stream").map((item) => item.name)).toEqual(["ai-sdk"]);
  expect(filterSkills(skills, "built").map((item) => item.name)).toEqual(["commit"]);
  expect(filterSkills(skills, "missing")).toEqual([]);
});

test("humanizes skill names for composer display", () => {
  expect(humanizedSkillName("ai-sdk")).toBe("AI SDK");
  expect(humanizedSkillName("browser_use")).toBe("Browser Use");
  expect(humanizedSkillName("expo-api-routes")).toBe("Expo API Routes");
});

test("completion list excludes disabled skills and sorts by name", () => {
  const skills = [
    skill({ name: "zeta", activation: "enabled" }),
    skill({ name: "alpha", activation: "experimental", experimental: true }),
    skill({ name: "beta", activation: "disabled" }),
  ];

  expect(enabledSkillsForCompletion(skills).map((item) => item.name)).toEqual(["alpha", "zeta"]);
});

test("completion matches are ranked by name before description", () => {
  const skills = [
    skill({ name: "workflow-react", shortDescription: "General workflow helper" }),
    skill({ name: "react", shortDescription: "Exact name match" }),
    skill({ name: "alpha-tools", shortDescription: "React helper" }),
    skill({ name: "native-react", description: "React Native helper" }),
  ];

  expect(matchingSkillCompletions(skills, "react").map((item) => item.name)).toEqual([
    "react",
    "native-react",
    "workflow-react",
    "alpha-tools",
  ]);
});

test("completion matches return every matching skill", () => {
  const skills = Array.from({ length: 12 }, (_value, index) =>
    skill({ name: `react-${index}`, shortDescription: "React helper" }),
  );

  expect(matchingSkillCompletions(skills, "react").map((item) => item.name)).toHaveLength(12);
});

test("detects and replaces the current dollar skill token", () => {
  const text = "Please use $ai";
  const token = skillCompletionToken(text, text.length);

  expect(token).toEqual({ start: 11, end: 14, query: "ai" });
  expect(replaceSkillToken(text, token!, "ai-sdk")).toEqual({
    text: "Please use $ai-sdk ",
    caret: 19,
  });
});

test("replacing a skill token avoids duplicate spacing before existing boundaries", () => {
  expect(replaceSkillToken("Please use $ai today", { start: 11, end: 14, query: "ai" }, "ai-sdk")).toEqual({
    text: "Please use $ai-sdk today",
    caret: "Please use $ai-sdk".length,
  });
  expect(replaceSkillToken("Please use $ai, today", { start: 11, end: 14, query: "ai" }, "ai-sdk")).toEqual({
    text: "Please use $ai-sdk, today",
    caret: "Please use $ai-sdk".length,
  });
});

test("does not treat shell variables or mid-word dollars as skill tokens", () => {
  expect(skillCompletionToken("echo $PATH", "echo $PATH".length)).toBeNull();
  expect(skillCompletionToken("price$ai", "price$ai".length)).toBeNull();
});

test("finds exact selected skill tokens for rich composer rendering", () => {
  const skills = [skill({ name: "ai-sdk" }), skill({ name: "commit" })];

  expect(skillTokenRanges("Use $ai-sdk then $commit", skills)).toEqual([
    { start: 4, end: 11, name: "ai-sdk" },
    { start: 17, end: 24, name: "commit" },
  ]);
  expect(skillTokenRanges("Use $ai for partial search", skills)).toEqual([]);
  expect(skillTokenRanges("echo $PATH", skills)).toEqual([]);
});

test("deletes a selected skill token as one unit around the caret", () => {
  const skills = [skill({ name: "ai-sdk" })];

  expect(deleteSkillTokenAtCaret("Use $ai-sdk next", "$ai-sdk ".length + 4, "previous", skills)).toEqual({
    text: "Use next",
    caret: 4,
  });
  expect(deleteSkillTokenAtCaret("Use $ai-sdk next", 4, "next", skills)).toEqual({
    text: "Use next",
    caret: 4,
  });
  expect(deleteSkillTokenAtCaret("$ai-sdk hello", 3, "previous", skills)).toEqual({
    text: "hello",
    caret: 0,
  });
  expect(deleteSkillTokenAtCaret("Use $ai next", 8, "previous", skills)).toBeNull();
});

function skill(patch: Partial<SkillDescriptor>): SkillDescriptor {
  return {
    id: patch.id ?? `builtin:${patch.name ?? "skill"}`,
    name: patch.name ?? "skill",
    canonicalPath: patch.canonicalPath ?? `builtin://skills/${patch.name ?? "skill"}/SKILL.md`,
    source: patch.source ?? "builtIn",
    exposure: patch.exposure ?? "direct_only",
    activation: patch.activation ?? "enabled",
    description: patch.description ?? "Skill description.",
    shortDescription: patch.shortDescription,
    experimental: patch.experimental ?? false,
    diagnostics: patch.diagnostics ?? [],
    agentMetadata: patch.agentMetadata,
  };
}

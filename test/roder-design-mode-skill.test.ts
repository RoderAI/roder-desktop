import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const requiredDesignTools = [
  "design_read",
  "design_batch_get",
  "design_patch",
  "design_set_variables",
  "design_snapshot_layout",
  "design_export_nodes",
  "design_get_screenshot",
  "design_spawn_agents",
];

test.each(["roder-design-mode", "design"])("%s skill declares strict design tool dependencies", (skillName) => {
  const skill = readFileSync(new URL(`../.agents/skills/${skillName}/SKILL.md`, import.meta.url), "utf8");
  const metadata = readFileSync(new URL(`../.agents/skills/${skillName}/agents/openai.yaml`, import.meta.url), "utf8");

  expect(skill).toContain("design_patch");
  expect(skill).toContain("operations");
  expect(skill).toContain("top-level `patch`");

  for (const tool of requiredDesignTools) {
    expect(metadata).toContain(tool);
  }
});

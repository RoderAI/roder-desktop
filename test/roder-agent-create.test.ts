import { expect, test } from "vitest";
import { roderAgentCreateParams } from "../src/lib/roder-agent-create";
import type { ProviderDescriptor, RoderModel } from "../src/types/roder";

const providers: ProviderDescriptor[] = [{ id: "openai", name: "OpenAI", authType: "oauth", authenticated: true }];
const model: RoderModel = { id: "sol", name: "Sol", modelProvider: "openai" };
const draft = {
  name: "  Release coordinator  ",
  mission: "  Keep releases moving.  ",
  workspaceId: "project",
  model,
  reasoning: "medium",
};

test("a ready Roder draft creates a trimmed payload for the chosen project and model", () => {
  expect(roderAgentCreateParams(draft, providers)).toEqual({
    name: "Release coordinator",
    mission: "Keep releases moving.",
    workspaceId: "project",
    model: "sol",
    modelProvider: "openai",
    reasoning: "medium",
  });
  expect(roderAgentCreateParams({ ...draft, reasoning: undefined }, providers)).not.toHaveProperty("reasoning");
});

test("incomplete or whitespace-only drafts cannot enable creation", () => {
  for (const change of [
    { name: "" },
    { name: "  " },
    { mission: "\n " },
    { workspaceId: "" },
    { model: undefined },
    { name: "x".repeat(121) },
    { mission: "x".repeat(16001) },
  ]) {
    expect(roderAgentCreateParams({ ...draft, ...change }, providers)).toBeNull();
  }
});

test("loading or unconfigured providers never produce a creatable Roder draft", () => {
  expect(roderAgentCreateParams(draft, [])).toBeNull();
  expect(roderAgentCreateParams(draft, [{ ...providers[0], authenticated: false }])).toBeNull();
});

import { expect, test } from "vitest";
import {
  effectiveSelectedModel,
  modelVisibilityKey,
  selectedModelProvider,
  visibleModelIdsFor,
  visibleModelsFor,
} from "../src/lib/roder-models";
import type { RoderModel } from "../src/types/roder";

test("resolves duplicate model ids with the preferred provider", () => {
  const models: RoderModel[] = [
    { id: "gpt-5.5", name: "GPT-5.5", modelProvider: "codex" },
    { id: "gpt-5.5", name: "gpt-5.5", modelProvider: "opencode" },
  ];

  expect(selectedModelProvider(models, "gpt-5.5", "opencode")).toBe("opencode");
  expect(effectiveSelectedModel(models, [], "gpt-5.5", "opencode")).toMatchObject({
    id: "gpt-5.5",
    modelProvider: "opencode",
  });
});

test("visible model ids are provider-aware while accepting legacy bare ids", () => {
  const models: RoderModel[] = [
    { id: "gpt-5.5", name: "GPT-5.5", modelProvider: "codex" },
    { id: "gpt-5.5", name: "gpt-5.5", modelProvider: "opencode" },
    { id: "sonnet", name: "Sonnet", modelProvider: "anthropic" },
  ];

  expect(modelVisibilityKey(models[1])).toBe("opencode:gpt-5.5");
  expect(visibleModelIdsFor(models, ["opencode:gpt-5.5"])).toEqual(["opencode:gpt-5.5"]);
  expect(visibleModelsFor(models, ["opencode:gpt-5.5"])).toEqual([models[1]]);
  expect(visibleModelsFor(models, ["gpt-5.5"])).toEqual([models[0], models[1]]);
});

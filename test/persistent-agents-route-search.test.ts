import { expect, test } from "vitest";
import { validatePersistentAgentsSearch } from "../src/lib/persistent-agents-route-search";

test("PA setup links accept explicit true without treating false strings or arbitrary values as enabled", () => {
  expect(validatePersistentAgentsSearch({ create: true })).toEqual({ create: true });
  expect(validatePersistentAgentsSearch({ create: "true" })).toEqual({ create: true });
  for (const create of [false, "false", "1", 1, {}, undefined]) {
    expect(validatePersistentAgentsSearch({ create })).toEqual({});
  }
});

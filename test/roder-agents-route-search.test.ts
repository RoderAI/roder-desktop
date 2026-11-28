import { expect, test } from "vitest";
import { validateRoderAgentsSearch } from "../src/lib/roder-agents-route-search";

test("Roder setup links accept explicit true without treating false strings or arbitrary values as enabled", () => {
  expect(validateRoderAgentsSearch({ create: true })).toEqual({ create: true });
  expect(validateRoderAgentsSearch({ create: "true" })).toEqual({ create: true });
  for (const create of [false, "false", "1", 1, {}, undefined]) {
    expect(validateRoderAgentsSearch({ create })).toEqual({});
  }
});

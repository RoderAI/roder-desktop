import { expect, test } from "vitest";
import { requireAbsoluteCwd } from "../src/lib/roder-workspaces";

test("requireAbsoluteCwd rejects missing and relative workspaces", () => {
  expect(() => requireAbsoluteCwd("", undefined)).toThrow(/Select a workspace/);
  expect(() => requireAbsoluteCwd(".", undefined)).toThrow(/Select a workspace/);
  expect(() => requireAbsoluteCwd("project", undefined)).toThrow(/Select a workspace/);
});

test("requireAbsoluteCwd resolves root aliases through the status cwd", () => {
  expect(requireAbsoluteCwd(".", "/Users/example/project")).toBe("/Users/example/project");
  expect(requireAbsoluteCwd("", "/Users/example/project")).toBe("/Users/example/project");
});

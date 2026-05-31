import { expect, test } from "vitest";
import { normalizeCwd, requireAbsoluteCwd } from "../src/lib/roder-workspaces";

test("requireAbsoluteCwd rejects missing and relative workspaces", () => {
  expect(() => requireAbsoluteCwd("", undefined)).toThrow(/Select a workspace/);
  expect(() => requireAbsoluteCwd(".", undefined)).toThrow(/Select a workspace/);
  expect(() => requireAbsoluteCwd("project", undefined)).toThrow(/Select a workspace/);
});

test("requireAbsoluteCwd resolves root aliases through the status cwd", () => {
  expect(requireAbsoluteCwd(".", "/Users/example/project")).toBe("/Users/example/project");
  expect(requireAbsoluteCwd("", "/Users/example/project")).toBe("/Users/example/project");
});

test("requireAbsoluteCwd accepts Windows absolute workspaces", () => {
  expect(requireAbsoluteCwd("C:\\Users\\example\\project", undefined)).toBe("C:\\Users\\example\\project");
  expect(requireAbsoluteCwd("\\\\server\\share\\project", undefined)).toBe("\\\\server\\share\\project");
});

test("normalizeCwd preserves Windows absolute workspaces with a base cwd", () => {
  expect(normalizeCwd("C:\\Users\\example\\project", "C:\\Users\\example\\gode-desktop")).toBe(
    "C:\\Users\\example\\project",
  );
  expect(normalizeCwd("\\\\server\\share\\project", "C:\\Users\\example\\gode-desktop")).toBe(
    "\\\\server\\share\\project",
  );
});

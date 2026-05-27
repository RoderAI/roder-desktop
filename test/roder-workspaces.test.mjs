import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const helperSource = readFileSync(new URL("../src/lib/roder-workspaces.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2023,
  },
}).outputText;

const module = { exports: {} };
new Script(compiled).runInNewContext({ exports: module.exports, module });
const { requireAbsoluteCwd } = module.exports;

test("requireAbsoluteCwd rejects missing and relative workspaces", () => {
  assert.throws(() => requireAbsoluteCwd("", undefined), /Select a workspace/);
  assert.throws(() => requireAbsoluteCwd(".", undefined), /Select a workspace/);
  assert.throws(() => requireAbsoluteCwd("project", undefined), /Select a workspace/);
});

test("requireAbsoluteCwd resolves root aliases through the status cwd", () => {
  assert.equal(requireAbsoluteCwd(".", "/Users/example/project"), "/Users/example/project");
  assert.equal(requireAbsoluteCwd("", "/Users/example/project"), "/Users/example/project");
});

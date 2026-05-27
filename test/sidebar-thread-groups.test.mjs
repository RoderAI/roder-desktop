import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const helperSource = readFileSync(new URL("../src/lib/sidebar-thread-groups.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2023,
  },
}).outputText;

const module = { exports: {} };
new Script(compiled).runInNewContext({ exports: module.exports, module });
const { groupThreadsByFolder, sidebarProjectOrder } = module.exports;

function thread(id, cwd) {
  return {
    id,
    name: id,
    preview: "",
    cwd,
    updatedAt: 100,
    status: { type: "idle", activeTurnId: null, activeFlags: [] },
    turns: [],
  };
}

test("sidebar project order keeps existing projects in place and prepends new projects", () => {
  const currentOrder = ["/workspace/project-a", "/workspace/project-b"];
  const threads = [
    thread("thread-c", "/workspace/project-c"),
    thread("thread-a", "/workspace/project-a"),
    thread("thread-b", "/workspace/project-b"),
  ];

  assert.deepEqual(
    Array.from(sidebarProjectOrder(threads, currentOrder)),
    ["/workspace/project-c", "/workspace/project-a", "/workspace/project-b"],
  );
});

test("sidebar project groups follow the stable project order", () => {
  const threads = [
    thread("thread-b-new", "/workspace/project-b"),
    thread("thread-a", "/workspace/project-a"),
    thread("thread-b-old", "/workspace/project-b"),
  ];

  const groups = groupThreadsByFolder(threads, ["/workspace/project-a", "/workspace/project-b"]);

  assert.deepEqual(Array.from(groups, (group) => group.key), ["/workspace/project-a", "/workspace/project-b"]);
  assert.deepEqual(Array.from(groups[1].threads, (item) => item.id), ["thread-b-new", "thread-b-old"]);
});

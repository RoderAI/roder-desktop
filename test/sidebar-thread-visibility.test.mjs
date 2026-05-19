import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const helperSource = readFileSync(new URL("../src/lib/sidebar-thread-visibility.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2023,
  },
}).outputText;

const module = { exports: {} };
new Script(compiled).runInNewContext({ exports: module.exports, module });
const { visibleThreadsForGroup } = module.exports;

function thread(id) {
  return { id };
}

test("collapsed sidebar groups show at most five threads and report the hidden count", () => {
  const threads = [1, 2, 3, 4, 5, 6, 7].map((id) => thread(`thread-${id}`));

  const result = visibleThreadsForGroup(threads, false);

  assert.deepEqual(
    result.visibleThreads.map((item) => item.id),
    ["thread-1", "thread-2", "thread-3", "thread-4", "thread-5"],
  );
  assert.deepEqual(
    result.primaryThreads.map((item) => item.id),
    ["thread-1", "thread-2", "thread-3", "thread-4", "thread-5"],
  );
  assert.deepEqual(
    result.overflowThreads.map((item) => item.id),
    ["thread-6", "thread-7"],
  );
  assert.equal(result.hiddenCount, 2);
  assert.equal(result.canShowMore, true);
  assert.equal(result.canShowLess, false);
});

test("expanded sidebar groups show all threads and offer a show less action", () => {
  const threads = [1, 2, 3, 4, 5, 6].map((id) => thread(`thread-${id}`));

  const result = visibleThreadsForGroup(threads, true);

  assert.equal(result.visibleThreads.length, 6);
  assert.equal(result.primaryThreads.length, 5);
  assert.deepEqual(result.overflowThreads.map((item) => item.id), ["thread-6"]);
  assert.equal(result.hiddenCount, 0);
  assert.equal(result.canShowMore, false);
  assert.equal(result.canShowLess, true);
});

test("groups with five or fewer threads do not need a show more action", () => {
  const threads = [1, 2, 3, 4, 5].map((id) => thread(`thread-${id}`));

  const result = visibleThreadsForGroup(threads, false);

  assert.equal(result.visibleThreads.length, 5);
  assert.equal(result.primaryThreads.length, 5);
  assert.equal(result.overflowThreads.length, 0);
  assert.equal(result.hiddenCount, 0);
  assert.equal(result.canShowMore, false);
  assert.equal(result.canShowLess, false);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/roder-ipc.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2023,
  },
}).outputText;

function loadRoderIpc(request) {
  const module = { exports: {} };
  new Script(compiled).runInNewContext({
    exports: module.exports,
    module,
    window: {
      roderDesktop: {
        request,
      },
    },
  });
  return module.exports.roderIpc;
}

test("setSessionMode sends the policy mode wire value to the app-server", async () => {
  const calls = [];
  const roderIpc = loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return { mode: params.mode };
  });

  const result = await roderIpc.setSessionMode("accept_all", "desktop permission selector");

  assert.deepEqual(result, { mode: "accept_all" });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      method: "session/set_mode",
      params: {
        mode: "accept_all",
        reason: "desktop permission selector",
      },
    },
  ]);
});

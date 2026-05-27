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

test("threadState reads the live policy mode from the app-server", async () => {
  const calls = [];
  const roderIpc = loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return { mode: "plan", pendingPlanExit: null };
  });

  const result = await roderIpc.threadState();

  assert.deepEqual(result, { mode: "plan", pendingPlanExit: null });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      method: "thread/state",
      params: {},
    },
  ]);
});

test("setThreadMode sends the policy mode wire value to the app-server", async () => {
  const calls = [];
  const roderIpc = loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return { mode: params.mode };
  });

  const result = await roderIpc.setThreadMode("accept_all", "desktop permission selector");

  assert.deepEqual(result, { mode: "accept_all" });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      method: "thread/set_mode",
      params: {
        mode: "accept_all",
        reason: "desktop permission selector",
      },
    },
  ]);
});

test("wait request resolvers use thread protocol methods and camelCase params", async () => {
  const calls = [];
  const roderIpc = loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return { resolved: true };
  });

  await roderIpc.resolveApproval({ approvalId: "approval-1", approved: false });
  await roderIpc.resolveUserInput({ requestId: "input-1", answers: { mode: "Default" } });
  await roderIpc.exitPlan({ requestId: "plan-1", approved: true });

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      method: "thread/resolve_approval",
      params: {
        approvalId: "approval-1",
        approved: false,
      },
    },
    {
      method: "thread/resolve_user_input",
      params: {
        requestId: "input-1",
        answers: { mode: "Default" },
      },
    },
    {
      method: "thread/exit_plan",
      params: {
        requestId: "plan-1",
        approved: true,
      },
    },
  ]);
});

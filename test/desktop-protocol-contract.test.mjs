import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const clientSource = readFileSync(new URL("../electron/roder/app-server-client.ts", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("../src/stores/roder-store.ts", import.meta.url), "utf8");
const apiDocs = readFileSync(new URL("../docs/api.md", import.meta.url), "utf8");

const documentedDesktopMethods = [
  "initialize",
  "thread/list",
  "thread/read",
  "thread/start",
  "thread/state",
  "thread/set_mode",
  "thread/exit_plan",
  "thread/resolve_approval",
  "thread/resolve_user_input",
  "turn/start",
  "turn/steer",
  "turn/interrupt",
  "model/list",
];

test("api docs describe the desktop methods the Electron bridge uses", () => {
  for (const method of documentedDesktopMethods) {
    assert.match(apiDocs, new RegExp(`\\b${method.replace("/", "\\/")}\\b`));
  }
});

test("Electron bridge starts the app-server with the documented initialize method", () => {
  assert.match(clientSource, /#rawRequest\("initialize"/);
  assert.match(clientSource, /method !== "initialize"/);
  assert.doesNotMatch(clientSource, /system\/initialize/);
});

test("Electron bridge does not translate documented desktop methods to legacy session and turn methods", () => {
  assert.doesNotMatch(clientSource, /sessions\/list|sessions\/load|sessions\/create/);
  assert.doesNotMatch(clientSource, /turns\/start|turns\/steer|turns\/interrupt/);
});

test("desktop code and docs do not use legacy session protocol methods", () => {
  for (const source of [storeSource, apiDocs]) {
    assert.doesNotMatch(source, /session\/(?:get|set_mode|exit_plan|resolve_approval|resolve_user_input)/);
    assert.doesNotMatch(source, /session\/(?:approvalRequested|approvalResolved|userInputRequested|userInputResolved|planExitRequested|planExitResolved)/);
  }
});

test("desktop store turns failed turn completions into visible failed system messages", () => {
  assert.match(storeSource, /turnFailureMessage/);
  assert.match(storeSource, /role:\s*"system"/);
  assert.match(storeSource, /status:\s*"failed"/);
});

test("desktop selected controls are sent with turns instead of persisted as defaults", () => {
  const persistedNavigation = storeSource.match(/partialize:\s*\(state\)\s*=>\s*\(\{(?<body>[\s\S]*?)\}\)/);
  assert.ok(persistedNavigation?.groups?.body);
  assert.doesNotMatch(persistedNavigation.groups.body, /selectedModel|selectedReasoning|selectedPolicyMode/);
  assert.doesNotMatch(storeSource, /gpt-5\.3-codex/);
  assert.match(storeSource, /model:\s*selectedTurnModel/);
  assert.match(storeSource, /reasoning:\s*turnState\.selectedReasoning/);
  assert.match(storeSource, /policyMode:\s*turnState\.selectedPolicyMode/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const clientSource = readFileSync(new URL("../electron/roder/app-server-client.ts", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("../src/stores/roder-store.ts", import.meta.url), "utf8");
const apiDocs = readFileSync(new URL("../docs/api.md", import.meta.url), "utf8");

const documentedDesktopMethods = ["initialize", "thread/list", "thread/read", "thread/start", "turn/start", "turn/steer", "turn/interrupt", "model/list", "speech/providers/list", "speech/transcribe"];

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

test("desktop store turns failed turn completions into visible failed system messages", () => {
  assert.match(storeSource, /turnFailureMessage/);
  assert.match(storeSource, /role:\s*"system"/);
  assert.match(storeSource, /status:\s*"failed"/);
});
